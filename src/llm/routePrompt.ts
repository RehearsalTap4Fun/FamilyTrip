// 路线推荐 = LLM 出草案 + 规则层校验 + 把问题喂回去修。
// 这里只管「说什么、收什么」，不发请求；调用方自带 key 直连 Claude / DeepSeek。
import { z } from 'zod'
import { deriveConstraints, foodNeeds, type Constraints } from '@core/constraints'
import { partyOnDay, kidBand } from '@core/party'
import type { PlaceVerdict } from '@core/ratings'
import { fmtHM } from '@core/schedule'
import type { Day, Party, Tag } from '@core/types'
import { TAG_LABEL, type Issue } from '@core/validate'

const TAGS = Object.keys(TAG_LABEL) as [Tag, ...Tag[]]

const StopSchema = z.object({
  kind: z.enum(['sight', 'food', 'lodging', 'drive', 'transit', 'rest']),
  name: z.string().min(1),
  start: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  durationMin: z.number().int().min(0).max(24 * 60),
  walkKm: z.number().min(0).max(50).optional(),
  driveMin: z.number().int().min(0).max(24 * 60).optional(),
  altitudeM: z.number().int().optional(),
  tags: z.array(z.enum(TAGS)).optional(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  why: z.string().optional(),
})

export const DraftSchema = z.object({
  days: z.array(z.object({
    startTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
    stops: z.array(StopSchema).min(1),
  })).min(1),
})

export type Draft = z.infer<typeof DraftSchema>

export interface RouteRequest {
  destination: string
  days: number
  party: Party
  /** 自由描述：想看海、不想太赶…… */
  wishes?: string
  /** 目的地相关的红黑榜，已经按这群人排好序 */
  places?: PlaceVerdict[]
}

const MODE_LABEL: Record<Party['mode'], string> = { selfDrive: '自驾', tour: '跟团', transit: '公共交通（高铁 / 飞机 + 打车）' }

export function describeMembers(party: Party, day: number): string {
  const dp = partyOnDay(party, day)
  const people = dp.members.map(m => {
    if (m.role === 'kid') return `${m.age ?? '?'} 岁小孩`
    if (m.role === 'elder') return `${m.age ?? '65+'} 岁老人${m.mobility && m.mobility !== 'normal' ? `（${{ slow: '走得慢', cane: '拄拐', wheelchair: '坐轮椅' }[m.mobility]}）` : ''}`
    return `成人${m.driver ? '（可开车）' : ''}`
  })
  const pets = dp.pets.map(p => `${{ small: '小型', medium: '中型', large: '大型' }[p.size]}${{ dog: '犬', cat: '猫', other: '宠物' }[p.kind]}`)
  return [...people, ...pets].join('、')
}

export function describeLimits(c: Constraints): string[] {
  const lines = [
    `每天在外不超过 ${c.activeMin.value / 60} 小时`,
    `每天步行不超过 ${c.walkKm.value} 公里`,
    `${fmtHM(c.endBy.value)} 前回到住处`,
  ]
  if (Number.isFinite(c.driveMin.value)) lines.push(`每天驾驶不超过 ${c.driveMin.value / 60} 小时，连续驾驶 ${c.driveBreakMin.value} 分钟内要停 15 分钟以上`)
  if (Number.isFinite(c.altitudeM.value)) lines.push(`海拔不超过 ${c.altitudeM.value} 米`)
  if (c.nap) lines.push(`${fmtHM(c.nap.from)}–${fmtHM(c.nap.to)} 安排午睡（回酒店、车上或能休息的地方）`)
  const tagList = (m: Map<Tag, string[]>) => [...m.keys()].map(t => TAG_LABEL[t]).join('、')
  if (c.needs.size) lines.push(`景点尽量满足：${tagList(c.needs)}`)
  if (c.lodgingNeeds.size) lines.push(`住宿必须满足：${tagList(c.lodgingNeeds)}`)
  for (const [tag, r] of c.avoid) lines.push(`避开${TAG_LABEL[tag]}的地方，除非有${TAG_LABEL[r.unless]}`)
  return lines
}

/** 动态人数时，找出成员组合发生变化的日子，分段描述 */
function segments(party: Party, days: number): { from: number; to: number }[] {
  const sig = (d: number) => {
    const p = partyOnDay(party, d)
    return [...p.members.map(m => m.id), ...p.pets.map(x => x.id)].join(',')
  }
  const out: { from: number; to: number }[] = []
  for (let d = 0; d < days; d++) {
    const last = out[out.length - 1]
    if (last && sig(last.from) === sig(d)) last.to = d
    else out.push({ from: d, to: d })
  }
  return out
}

export function buildRoutePrompt(req: RouteRequest): { system: string; user: string } {
  const system = [
    '你是国内旅行路线规划助手。只输出 JSON，不要输出其他文字。',
    'JSON 结构：{"days":[{"startTime":"09:00","stops":[{"kind":"sight|food|lodging|drive|transit|rest","name":"","start":"HH:MM","durationMin":0,"walkKm":0,"driveMin":0,"altitudeM":0,"tags":[],"priority":1,"why":""}]}]}',
    `tags 只能取：${TAGS.map(t => `${t}(${TAG_LABEL[t]})`).join('、')}。只标你确定具备的。`,
    'driveMin 写在到达这一站之前的路上驾驶分钟数；长途段单独成 drive 站点。每天最后一站是 lodging。',
    'priority：1 必去、2 想去、3 可去。name 用高德地图上能搜到的正式名称。',
    '硬约束必须遵守，宁可少排景点也不要超。',
  ].join('\n')

  const lines: string[] = [
    `目的地：${req.destination}，共 ${req.days} 天，出行方式：${MODE_LABEL[req.party.mode]}。`,
  ]
  for (const seg of segments(req.party, req.days)) {
    const dp = partyOnDay(req.party, seg.from)
    const c = deriveConstraints(dp)
    const range = seg.from === seg.to ? `第 ${seg.from + 1} 天` : `第 ${seg.from + 1}–${seg.to + 1} 天`
    lines.push('', `${range}同行：${describeMembers(req.party, seg.from)}`)
    lines.push('硬约束：', ...describeLimits(c).map(l => '- ' + l))
    const f = foodNeeds(dp)
    if (f.size) lines.push(`- 吃饭的地方要有：${[...f.keys()].map(t => TAG_LABEL[t]).join('、')}`)
    for (const b of c.blockers) lines.push(`- 注意：${b.message}`)
  }
  if (req.party.members.some(m => m.role === 'kid' && kidBand(m.age) === 'toddler')) {
    lines.push('', '有 1–3 岁小孩：景点间尽量短途，优先有母婴室的地方。')
  }
  const black = (req.places ?? []).filter(p => p.verdict === 'black')
  const red = (req.places ?? []).filter(p => p.verdict === 'red')
  if (black.length) lines.push('', '我们自己踩过的雷，不要安排：', ...black.slice(0, 20).map(p => `- ${p.name}${p.notes[0] ? `（${p.notes[0]}）` : ''}`))
  if (red.length) lines.push('', '我们去过觉得好的，顺路可以再安排：', ...red.slice(0, 20).map(p => `- ${p.name}`))
  if (req.wishes) lines.push('', `其他想法：${req.wishes}`)

  return { system, user: lines.join('\n') }
}

/** 规则层没通过时的追问：只列 error / warn，tip 不打扰模型 */
export function buildRepairPrompt(issues: Issue[], draft: Draft): string {
  const serious = issues.filter(i => i.level !== 'tip')
  const list = serious.map(i => {
    const stop = i.stopId ? `（${i.stopId}）` : ''
    return `- 第 ${i.day + 1} 天${stop}：${i.message}`
  })
  return [
    '上一版行程有这些问题，请只改有问题的那几天，其余天原样保留，仍然只输出完整 JSON：',
    ...list,
    '',
    '上一版：',
    JSON.stringify(draft),
  ].join('\n')
}

export function parseDraft(text: string): { ok: true; draft: Draft } | { ok: false; error: string } {
  // 模型偶尔会包一层 ```json
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const body = (m ? m[1] : text).trim()
  let raw: unknown
  try { raw = JSON.parse(body) } catch (e) { return { ok: false, error: '不是合法 JSON：' + (e instanceof Error ? e.message : String(e)) } }
  const r = DraftSchema.safeParse(raw)
  if (!r.success) return { ok: false, error: r.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('；') }
  return { ok: true, draft: r.data }
}

/** 草案转成行程日，补上 id；stop id 形如 d1s3，repair 提示里直接可读 */
export function draftToDays(d: Draft): Day[] {
  return d.days.map((day, di) => ({
    startTime: day.startTime,
    stops: day.stops.map((s, si) => ({ ...s, id: `d${di + 1}s${si + 1}`, status: 'planned' as const })),
  }))
}
