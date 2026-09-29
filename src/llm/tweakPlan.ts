// 「写一句要求再排」：大模型只负责把一句话翻译成排程引擎能执行的调整（几点出发、排松点、哪个点挪到哪天、不去、必去、加一个、在哪吃饭），
// 排还是交给排程引擎（core/planner.ts），车程、午睡、每天游玩上限照样守住。做不到的要求如实列出来。
import { z } from 'zod'
import type { DayTweak, PlanPlace, Poi, Trip } from '@core/types'
import { callStructured, type LlmConfig, type StructuredCall, type StructuredResult, type Usage } from './client'

const HM = /^([01]?\d|2[0-3]):[0-5]\d$/

export const TweaksSchema = z.object({
  understood: z.string().describe('用一句话复述你理解的要求，30 字以内'),
  startTimes: z.array(z.object({ day: z.number().int().describe('第几天，从 1 起'), time: z.string().describe('出发时刻 HH:MM') })).catch([]).describe('某天几点出发'),
  lighter: z.array(z.number().int()).catch([]).describe('要排松一点的天（从 1 起）'),
  pins: z.array(z.object({ place: z.string().describe('现有地点的名字，照抄'), day: z.number().int().describe('挪到第几天，从 1 起') })).catch([]).describe('把某个现有地点放到指定的那天'),
  drop: z.array(z.string()).catch([]).describe('不去了的现有地点（名字照抄）'),
  must: z.array(z.string()).catch([]).describe('一定要去的现有地点（名字照抄）'),
  add: z.array(z.object({
    name: z.string().describe('要新加的地方，用高德地图上能搜到的正式名称'),
    city: z.string().describe('所在城市'),
    kind: z.enum(['sight', 'food', 'lodging']),
    day: z.number().int().nullable().describe('放在第几天（从 1 起），没说填 null'),
  })).catch([]).describe('要新加的地方'),
  meals: z.array(z.object({
    day: z.number().int().describe('第几天，从 1 起'),
    meal: z.enum(['lunch', 'dinner']),
    near: z.string().describe('在哪附近吃，用高德能搜到的地名，例如「双廊古镇」「洱海公园」'),
  })).catch([]).describe('某天的午饭或晚饭要在哪附近吃'),
  unsupported: z.array(z.string()).catch([]).describe('做不到或超出排程能力的要求，原话简述'),
})
export type Tweaks = z.infer<typeof TweaksSchema>

export function buildTweakPrompt(trip: Trip, places: PlanPlace[], request: string): { system: string; user: string } {
  const where = (p: PlanPlace) => {
    const d = trip.days.findIndex(day => day.stops.some(s => s.name === p.name))
    return d >= 0 ? `第 ${d + 1} 天` : '没排进去'
  }
  const system = [
    '你帮一个家庭调整已经排好的行程。用户写一句要求，你只把它翻译成下面这些调整，不自己排时间：',
    '- startTimes：某天几点出发；lighter：哪几天排松一点（少排、不赶）',
    '- pins：把现有的某个地方挪到第几天；drop：不去了的现有地方；must：一定要去的现有地方（名字都照抄下面的清单）',
    '- add：要新加的地方（高德能搜到的正式名称）；meals：某天午饭或晚饭要在哪附近吃',
    '- unsupported：超出这些调整、做不到的要求（例如「换一辆车」「便宜点」），原话简述',
    '规则：没提到的就不要动；天数从 1 起，不能超过行程天数；时间用 24 小时 HH:MM。',
  ].join('\n')
  const user = [
    `行程一共 ${trip.days.length} 天。`,
    '现在的安排：', ...trip.days.map((d, i) => `- 第 ${i + 1} 天（${d.startTime ?? '09:00'} 出发）：${d.stops.filter(s => s.kind === 'sight' || s.kind === 'food').map(s => s.name).join('、') || '空'}`),
    '要去的地方清单：', ...places.map(p => `- ${p.name}（${p.kind === 'sight' ? '景点' : p.kind === 'food' ? '吃饭' : '住处'}，${where(p)}${p.must ? '，必去' : ''}）`),
    '', `用户的要求：${request.trim()}`,
  ].join('\n')
  return { system, user }
}

type Caller = <S extends z.ZodType>(cfg: LlmConfig, req: StructuredCall<S>) => Promise<StructuredResult<z.infer<S>>>

export async function readTweaks(cfg: LlmConfig, trip: Trip, places: PlanPlace[], request: string, caller: Caller = callStructured): Promise<{ tweaks: Tweaks; usage: Usage }> {
  const { system, user } = buildTweakPrompt(trip, places, request)
  const r = await caller(cfg, { system, user, schema: TweaksSchema, effort: 'low' })
  return { tweaks: r.data, usage: r.usage }
}

export interface Resolved { name: string; poi: Poi; area?: string }

export interface Applied {
  places: PlanPlace[]
  tweaks: DayTweak[]
  /** 给人看的：这次按要求改了什么 */
  done: string[]
  /** 做不到的（模型说的、名字对不上的、高德没找到的） */
  skipped: string[]
}

/**
 * 把调整落到排程引擎的输入上：地点清单改 day / must / 删掉 / 新加，按天的调整合并进已有的（后说的覆盖先说的）。
 * find 负责在高德里找地方（新加的点、吃饭的地方），找不到返回 null。
 */
export async function applyTweaks(t: Tweaks, places: PlanPlace[], prev: DayTweak[], days: number, find: (name: string, city?: string) => Promise<Resolved | null>, newId: (p: string) => string, match: (q: string, found: string) => boolean): Promise<Applied> {
  const done: string[] = []
  const skipped: string[] = [...t.unsupported.map(u => `做不到：${u}`)]
  const okDay = (d: number) => d >= 1 && d <= days
  const byName = (n: string) => places.find(p => p.name === n) ?? places.find(p => match(n, p.name))
  let list = places.map(p => ({ ...p }))
  const at = (n: string) => { const p = byName(n); return p ? list.find(x => x.id === p.id) : undefined }

  for (const n of t.drop) { const p = at(n); if (p) { list = list.filter(x => x.id !== p.id); done.push(`不去${p.name}`) } else skipped.push(`清单里没有「${n}」，没法去掉`) }
  for (const n of t.must) { const p = at(n); if (p) { p.must = true; done.push(`${p.name}改成必去`) } else skipped.push(`清单里没有「${n}」`) }
  for (const pin of t.pins) {
    const p = at(pin.place)
    if (!p) { skipped.push(`清单里没有「${pin.place}」`); continue }
    if (!okDay(pin.day)) { skipped.push(`没有第 ${pin.day} 天`); continue }
    p.day = pin.day - 1; p.prefDay = undefined
    done.push(`${p.name}放到第 ${pin.day} 天`)
  }
  for (const a of t.add) {
    const r = await find(a.name, a.city)
    if (!r) { skipped.push(`高德里没找到「${a.name}」`); continue }
    if (list.some(x => x.poi.amapId && x.poi.amapId === r.poi.amapId)) { skipped.push(`${r.name}已经在清单里了`); continue }
    const day = a.day != null && okDay(a.day) ? a.day - 1 : undefined
    list.push({ id: newId('p'), name: r.name, kind: a.kind, poi: r.poi, area: r.area, ...(day != null ? { day } : {}), must: true })
    done.push(`加上${r.name}${day != null ? `（第 ${day + 1} 天）` : ''}`)
  }

  const tweaks = prev.map(x => ({ ...x }))
  const tw = (d: number) => { let x = tweaks.find(y => y.day === d); if (!x) { x = { day: d }; tweaks.push(x) } return x }
  for (const s of t.startTimes) {
    if (!okDay(s.day) || !HM.test(s.time)) { skipped.push(`第 ${s.day} 天 ${s.time} 出发看不懂`); continue }
    tw(s.day - 1).start = s.time.padStart(5, '0')
    done.push(`第 ${s.day} 天 ${s.time.padStart(5, '0')} 出发`)
  }
  for (const d of t.lighter) { if (okDay(d)) { tw(d - 1).lighter = true; done.push(`第 ${d} 天排松一点`) } }
  for (const m of t.meals) {
    if (!okDay(m.day)) continue
    const r = await find(m.near)
    if (!r) { skipped.push(`高德里没找到「${m.near}」，第 ${m.day} 天${m.meal === 'lunch' ? '午饭' : '晚饭'}照旧`); continue }
    tw(m.day - 1)[m.meal === 'lunch' ? 'lunchNear' : 'dinnerNear'] = { name: r.name, poi: r.poi }
    done.push(`第 ${m.day} 天${m.meal === 'lunch' ? '午饭' : '晚饭'}在${r.name}附近`)
  }
  return { places: list, tweaks: tweaks.sort((a, b) => a.day - b.day), done, skipped }
}
