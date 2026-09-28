// 让 AI 重排这一天：大模型出草案 → 合并回行程（沿用原站的坐标、标签、打卡状态）→ 规则层检查 → 有问题就带着问题再修，最多两轮。
// 采不采用由用户决定：这里只返回候选行程和前后对比，不写入状态。
import { z } from 'zod'
import { deriveConstraints, foodNeeds } from '@core/constraints'
import { partyOnDay } from '@core/party'
import type { PlaceVerdict } from '@core/ratings'
import { fmtHM, scheduleDay } from '@core/schedule'
import type { Stop, StopKind, Trip } from '@core/types'
import { checkDay, TAG_LABEL, type Issue } from '@core/validate'
import { callStructured, type LlmConfig, type StructuredCall, type StructuredResult, type Usage } from './client'
import { describeLimits, describeMembers } from './routePrompt'
import type { GroundReport, Grounder } from '../geo/groundDay'

const KINDS = ['sight', 'food', 'rest', 'lodging', 'drive', 'transit'] as const
const KIND_CN: Record<StopKind, string> = { sight: '景点', food: '吃饭', rest: '休息', lodging: '住宿', drive: '开车', transit: '换乘' }

// 结构化输出能约束的写法：不用正则和数值范围，范围在合并时夹
export const DayDraftSchema = z.object({
  stops: z.array(z.object({
    ref: z.string().nullable().describe('沿用现有站点时填它的 ref；新加的站填 null'),
    kind: z.enum(KINDS),
    name: z.string(),
    durationMin: z.number().int().describe('停留分钟；开车段是这段车程'),
    driveMin: z.number().int().nullable().describe('从上一站开过来的分钟；开车段自己填 null'),
    start: z.string().nullable().describe('固定开始时刻 HH:MM；没有固定时刻填 null'),
    priority: z.number().int().describe('1 必去 2 想去 3 可去'),
    why: z.string().describe('一句话理由，20 字以内'),
  })),
  summary: z.string().describe('这样排的要点，一两句'),
})
export type DayDraft = z.infer<typeof DayDraftSchema>

export interface ReplanInput {
  trip: Trip
  dayIndex: number
  /** 已按这群人排好序的红黑榜，只取黑榜进提示词 */
  places?: PlaceVerdict[]
  wishes?: string
}

const serious = (xs: Issue[]) => xs.filter(i => i.level !== 'tip')

function stopLine(s: Stop, start: string): string {
  const bits = [
    `ref=${s.id}`, KIND_CN[s.kind], s.name, `${start} 开始`, `${s.kind === 'drive' ? '车程' : '停留'} ${s.durationMin} 分`,
    s.kind !== 'drive' && s.driveMin ? `开过来 ${s.driveMin} 分` : '',
    s.walkKm ? `步行 ${s.walkKm} km` : '', s.altitudeM != null ? `海拔 ${s.altitudeM} m` : '',
    s.start ? `固定 ${s.start}` : '', s.priority ? `优先级 ${s.priority}` : '',
    s.tags?.length ? `具备：${s.tags.map(t => TAG_LABEL[t]).join('、')}` : '',
    s.status === 'done' ? '【已打卡，不能动】' : s.status === 'skipped' ? '【已跳过】' : '',
  ]
  return '- ' + bits.filter(Boolean).join('，')
}

export function buildDayPrompt({ trip, dayIndex, places = [], wishes }: ReplanInput): { system: string; user: string } {
  const day = trip.days[dayIndex]
  const dp = partyOnDay(trip.party, dayIndex)
  const c = deriveConstraints(dp)
  const slots = new Map(scheduleDay(day, { includeSkipped: true }).map(s => [s.stop.id, fmtHM(s.start)]))
  const issues = serious(checkDay(trip, dayIndex))
  const f = foodNeeds(dp)
  const system = [
    '你是一个家庭自驾行程的调度助手。用户给你某一天现有的站点和这群同行者的硬约束，你重新安排这一天，让它满足约束、少折腾。',
    '规则：',
    '1. 已打卡的站原样放在最前面，ref 照填，不改顺序和时长。',
    '2. 优先沿用现有站点（ref 填原来的 ref，name 照抄）。可以调换顺序、删掉「可去」「想去」的站、改停留时长、改「开过来」的分钟数。',
    '3. 需要时可以新加站（ref 填 null）：连续开车太久就把开车段拆成两段、中间夹一个服务区休息（kind=rest，至少 20 分钟；服务区必须夹在两段开车之间，不要放在还没开车的时候）；中午有小孩要睡就留出午睡（回住处 rest 或在车上）。新站 name 用高德地图上能搜到的正式名称。',
    '4. 当天最后一站是住宿（kind=lodging，durationMin=0）。',
    '5. 硬约束必须遵守，宁可少去一个地方也不要超。「必去」的站尽量保留。',
    '6. 开车段（kind=drive）的 durationMin 是这段车程，driveMin 填 null；其他站的 driveMin 是从上一站开过来的车程，顺序变了就按距离重新估。',
    '7. 除非门票或预约有固定时间，start 填 null，由系统按顺序排时刻。',
    '8. why 用一句大白话说为什么这样排（20 字以内）；summary 用一两句说整体改了什么。',
  ].join('\n')
  const lines = [
    `第 ${dayIndex + 1} 天，出行方式：${{ selfDrive: '自驾', tour: '跟团', transit: '公共交通' }[trip.party.mode]}，出发 ${day.startTime ?? '09:00'}。`,
    `同行：${describeMembers(trip.party, dayIndex)}`,
    '硬约束：', ...describeLimits(c).map(l => '- ' + l),
    ...(f.size ? [`- 吃饭的地方要有：${[...f.keys()].map(t => TAG_LABEL[t]).join('、')}`] : []),
    ...c.blockers.map(b => `- 注意：${b.message}`),
    '', '现在的安排：', ...day.stops.map(s => stopLine(s, slots.get(s.id) ?? '')),
  ]
  if (issues.length) lines.push('', '现在检查出的问题：', ...issues.map(i => `- ${i.message}`))
  const black = places.filter(p => p.verdict === 'black')
  if (black.length) lines.push('', '我们自己踩过的雷，不要安排：', ...black.slice(0, 20).map(p => `- ${p.name}${p.notes[0] ? `（${p.notes[0]}）` : ''}`))
  if (wishes?.trim()) lines.push('', `另外的要求：${wishes.trim()}`)
  return { system, user: lines.join('\n') }
}

const HM = /^([01]?\d|2[0-3]):[0-5]\d$/
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)))

/** 草案合并回行程：沿用的站保留 id、坐标、标签、打卡状态、名称；新站生成 id。已打卡的站不让模型动。 */
export function mergeDraft(trip: Trip, dayIndex: number, draft: DayDraft, newId: () => string): Trip {
  const day = trip.days[dayIndex]
  const byId = new Map(day.stops.map(s => [s.id, s]))
  const used = new Set<string>()
  const out: Stop[] = []
  for (const d of draft.stops) {
    const base = d.ref ? byId.get(d.ref) : undefined
    if (base && used.has(base.id)) continue
    if (base) {
      used.add(base.id)
      if (base.status === 'done') { out.push(base); continue }
      out.push({
        ...base,
        durationMin: base.kind === 'lodging' ? 0 : clamp(d.durationMin, 0, 720),
        driveMin: base.kind === 'drive' || d.driveMin == null ? (base.kind === 'drive' ? undefined : base.driveMin) : clamp(d.driveMin, 0, 600) || undefined,
        start: d.start && HM.test(d.start) ? d.start : undefined,
        priority: ([1, 2, 3] as const).find(p => p === d.priority) ?? base.priority,
        why: d.why.slice(0, 40) || base.why,
      })
    } else {
      out.push({
        id: newId(), kind: d.kind, name: d.name.trim() || KIND_CN[d.kind], status: 'planned',
        durationMin: d.kind === 'lodging' ? 0 : clamp(d.durationMin, 0, 720),
        driveMin: d.kind === 'drive' || d.driveMin == null ? undefined : clamp(d.driveMin, 0, 600) || undefined,
        start: d.start && HM.test(d.start) ? d.start : undefined,
        priority: ([1, 2, 3] as const).find(p => p === d.priority) ?? 2,
        why: d.why.slice(0, 40) || undefined,
      })
    }
  }
  // 模型漏掉的已打卡站补回最前面，保证打过卡的记录不丢
  const doneMissing = day.stops.filter(s => s.status === 'done' && !used.has(s.id))
  const stops = [...doneMissing, ...out]
  return { ...trip, days: trip.days.map((x, i) => (i === dayIndex ? { ...x, stops } : x)) }
}

export interface ReplanResult {
  trip: Trip
  summary: string
  before: Issue[]
  after: Issue[]
  /** 一共问了模型几次（含修复） */
  attempts: number
  usage: Usage
  model: string
  /** 交回的这一版按高德落地的情况；没开落地（没填高德 Key）时为空 */
  ground?: GroundReport
  /** 落地失败的原因（高德出错时照样交回，只是车程没核实） */
  groundError?: string
}

type Caller = <S extends z.ZodType>(cfg: LlmConfig, req: StructuredCall<S>) => Promise<StructuredResult<z.infer<S>>>

/** 越小越好：必改算 100 分、留意算 1 分 */
const score = (xs: Issue[]) => xs.reduce((a, i) => a + (i.level === 'error' ? 100 : 1), 0)

export async function replanDay(cfg: LlmConfig, input: ReplanInput, opts: { caller?: Caller; newId?: () => string; maxRepairs?: number; ground?: Grounder } = {}): Promise<ReplanResult> {
  const caller = opts.caller ?? callStructured
  const newId = opts.newId ?? (() => 'ai' + Math.random().toString(36).slice(2, 8))
  const { system, user } = buildDayPrompt(input)
  const before = serious(checkDay(input.trip, input.dayIndex))
  const total: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0 }
  let best: { trip: Trip; issues: Issue[]; summary: string; ground?: GroundReport } | null = null
  let groundError: string | undefined
  let model = ''
  let prompt = user
  const rounds = 1 + (opts.maxRepairs ?? 2)
  let attempts = 0
  for (let r = 0; r < rounds; r++) {
    attempts++
    let res
    try {
      res = await caller(cfg, { system, user: prompt, schema: DayDraftSchema, effort: 'medium' })
    } catch (e) {
      // 修复轮出错（格式不对、限流）不作废前面的结果，交回已有的最好一版
      if (best) break
      throw e
    }
    model = res.model
    for (const k of ['input', 'output', 'cacheRead', 'cacheWrite', 'usd'] as const) total[k] += res.usage[k]
    let trip = mergeDraft(input.trip, input.dayIndex, res.data, newId)
    // 先落地再检查：新站按高德定位、车程按真实路线重算，规则层看到的才是真实驾驶时长
    let ground: GroundReport | undefined
    if (opts.ground && !groundError) {
      try { ({ trip, report: ground } = await opts.ground(trip, input.dayIndex)) } catch (e) { groundError = e instanceof Error ? e.message : String(e) }
    }
    const issues = serious(checkDay(trip, input.dayIndex))
    if (!best || score(issues) < score(best.issues)) best = { trip, issues, summary: res.data.summary, ground }
    // 一个问题都没有了才提前停；否则带着问题再修，直到用完轮数（交回问题最少的那一版）
    if (issues.length === 0) break
    prompt = [user, '', '你上一版排出来还有这些问题，请改掉，仍然输出完整的这一天：', ...issues.map(i => `- ${i.message}`),
      ...(ground?.legs.length ? ['', '高德地图实测的车程（按这个排，不要自己估）：', ...ground.legs.map(l => `- ${l.from} → ${l.to}：开车 ${l.minutes} 分（${l.km} km）`)] : []),
      ...(ground?.unlocated.length ? ['', `这些站在高德上搜不到或离路线太远，换成能搜到的正式地名：${ground.unlocated.join('、')}`] : []),
      '', '上一版：', JSON.stringify(res.data)].join('\n')
  }
  return { trip: best!.trip, summary: best!.summary, before, after: best!.issues, attempts, usage: total, model, ground: best!.ground, groundError }
}
