// 这趟的亮点介绍：整趟 3–5 句亮点 + 每个景点「怎么玩最好」（最受推崇的玩法、最佳时段、避坑、对这群人的提醒）。
// 大模型按这趟的景点和同行者写；填了智谱 Key 就先对停留最久的几个景点各搜一次玩法攻略作参考。要具体、能照着做，拿不准就留空。
import { z } from 'zod'
import { deriveConstraints } from '@core/constraints'
import { partyOnDay } from '@core/party'
import type { Stop, StopHighlight, Trip, TripHighlight } from '@core/types'
import { callStructured, type LlmConfig, type StructuredCall, type StructuredResult, type Usage } from './client'
import { describeLimits, describeMembers } from './routePrompt'
import { pickRefs, zhipuSearch, type WebRef } from './webSearch'

const nul = <T extends z.ZodType>(t: T) => t.nullable().catch(null)

export const HighlightsSchema = z.object({
  trip: z.array(z.object({
    text: z.string().describe('一句亮点，30 字以内，具体到做什么，例如「傍晚在双廊玉几岛看洱海日落」'),
    stop: nul(z.string()).describe('这句说的是哪个地方（名字照抄清单）；说整趟的填 null'),
  })).catch([]).describe('这趟最值得期待的 3–5 件事'),
  stops: z.array(z.object({
    name: z.string().describe('地方的名字，照抄清单'),
    how: z.string().describe('这里最受推崇的玩法，一句能照着做的话，40 字以内；不要写「风景优美」这种空话'),
    when: nul(z.string()).describe('最佳时段，例如「17:30 以后看日落」「早上 9 点前人少」；没有讲究填 null'),
    tip: nul(z.string()).describe('避坑、预约、穿着，30 字以内；没有填 null'),
    family: nul(z.string()).describe('对这群同行者的提醒（老人、小孩、宠物），30 字以内；没有填 null'),
  })).catch([]),
})
export type Highlights = z.infer<typeof HighlightsSchema>

const sightsOf = (t: Trip) => t.days.flatMap((d, i) => d.stops.filter(s => s.kind === 'sight' || s.kind === 'food').map(s => ({ s, day: i })))

export function buildHighlightsPrompt(trip: Trip, refs: WebRef[] = []): { system: string; user: string } {
  const everyone = { ...trip.party, members: trip.party.members.map(m => ({ ...m, days: undefined })), pets: trip.party.pets.map(p => ({ ...p, days: undefined })) }
  const c = deriveConstraints(partyOnDay(everyone, 0))
  const system = [
    '你给一个家庭写这趟行程的亮点介绍，让他们出发前就知道每个地方怎么玩最好。',
    '规则：',
    '1. 写具体、能照着做的玩法：去哪个角落、做什么、吃什么、从哪条路走（例如「骑电动车走洱海西线，从才村到喜洲，沿途麦田」），不要写「风景优美」「值得一去」这种空话。',
    '2. 最佳时段只在真有讲究时写（日出日落、避开旅行团、演出场次）。',
    '3. 结合这群同行者的情况写 family：老人走不了的台阶有没有替代路线、小孩能玩什么、狗能不能进。',
    '4. 拿不准的就填 null，不要编；只写清单里的地方，名字一字不差地照抄。每个地方单独一条，内容只写这个地方本身，不要把别处（路上的服务区、别的景点）的安排写进来。',
    '5. trip 里写 3–5 件这趟最值得期待的事，尽量分布在不同的天；超出这群人限制的地方（海拔、步行太远）不要当亮点推荐，只在它自己的 family 里提醒。',
    ...(refs.length ? ['6. 下面有网上搜到的玩法攻略摘要，优先采用里面多次提到的玩法；摘要可能过时，拿不准的不要用。'] : []),
  ].join('\n')
  const user = [
    `同行者：${describeMembers(everyone, 0)}`,
    '他们的限制：', ...describeLimits(c).map(l => '- ' + l),
    '', '行程：',
    ...trip.days.map((d, i) => `- 第 ${i + 1} 天：${d.stops.filter(s => s.kind === 'sight' || s.kind === 'food').map(s => `${s.name}（${s.kind === 'food' ? '吃饭' : `玩 ${s.durationMin} 分`}）`).join('、') || '休整'}`),
    ...(refs.length ? ['', '网上搜到的玩法攻略（摘要）：', ...refs.map((r, i) => `[${i + 1}] ${r.title}（${r.site}）\n${r.content}`)] : []),
  ].join('\n')
  return { system, user }
}

/** 填了智谱 Key：停留最久的几个景点各搜一次「怎么玩」 */
export async function searchPlayTips(trip: Trip, key: string, top = 3, fetchImpl: typeof fetch = fetch): Promise<{ refs: WebRef[]; yuan: number }> {
  const main = sightsOf(trip).filter(x => x.s.kind === 'sight').sort((a, b) => b.s.durationMin - a.s.durationMin).slice(0, top).map(x => x.s.name)
  const got = await Promise.allSettled(main.map(n => zhipuSearch(`${n} 怎么玩 攻略 亲子`, key, 'search_pro_sogou', fetchImpl).then(list => pickRefs([list], n, 3))))
  const refs = got.flatMap(g => (g.status === 'fulfilled' ? g.value : []))
  return { refs, yuan: main.length * 0.05 }
}

type Caller = <S extends z.ZodType>(cfg: LlmConfig, req: StructuredCall<S>) => Promise<StructuredResult<z.infer<S>>>

export async function writeHighlights(cfg: LlmConfig, trip: Trip, refs: WebRef[] = [], caller: Caller = callStructured): Promise<{ h: Highlights; usage: Usage }> {
  const { system, user } = buildHighlightsPrompt(trip, refs)
  const r = await caller(cfg, { system, user, schema: HighlightsSchema, effort: 'low' })
  return { h: r.data, usage: r.usage }
}

/**
 * 写回行程：按名字对上站点——先全名，再一个包含另一个（「三塔」↔「崇圣寺三塔」）；
 * 只有两个字相同不算（实测把服务区的安排对到了「大理古城 人民路」上）。整趟亮点最多 5 条
 */
export function applyHighlights(trip: Trip, h: Highlights, _match?: (q: string, found: string) => boolean): Trip {
  const all = sightsOf(trip).map(x => x.s)
  const norm = (x: string) => x.replace(/[\s·()（）]/g, '')
  const find = (name: string): Stop | undefined => {
    const n = norm(name)
    if (n.length < 2) return undefined
    return all.find(s => s.name === name) ?? all.find(s => norm(s.name) === n) ?? all.find(s => norm(s.name).includes(n) || n.includes(norm(s.name)))
  }
  const per = new Map<string, StopHighlight>()
  for (const x of h.stops) {
    const s = find(x.name)
    if (!s || !x.how.trim()) continue
    per.set(s.id, { how: x.how.trim(), ...(x.when ? { when: x.when } : {}), ...(x.tip ? { tip: x.tip } : {}), ...(x.family ? { family: x.family } : {}) })
  }
  const highlights: TripHighlight[] = h.trip.filter(x => x.text.trim()).slice(0, 5).map(x => {
    const s = x.stop ? find(x.stop) : undefined
    return { text: x.text.trim(), ...(s ? { stopId: s.id } : {}) }
  })
  return {
    ...trip,
    highlights,
    days: trip.days.map(d => ({ ...d, stops: d.stops.map(s => (per.has(s.id) ? { ...s, highlight: per.get(s.id) } : s)) })),
  }
}
