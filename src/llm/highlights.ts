// 这趟的亮点介绍：整趟亮点 + 每个景点「怎么玩最好」（最受推崇的玩法、最佳时段、避坑、对这群人的提醒）。
// 整趟亮点不硬凑条数：先对行程里排到的每个地方上网搜推荐和好评，网上真有人推荐、夸的才写成亮点，附出处，按行程先后排。
// 没填智谱 Key（搜不了）就只写各站「怎么玩」，不写整趟亮点。
import { z } from 'zod'
import { deriveConstraints } from '@core/constraints'
import { partyOnDay } from '@core/party'
import { fmtHM, scheduleDay } from '@core/schedule'
import type { Stop, StopHighlight, Trip, TripHighlight } from '@core/types'
import { callStructured, type LlmConfig, type StructuredCall, type StructuredResult, type Usage } from './client'
import { describeLimits, describeMembers } from './routePrompt'
import { pickRefs, zhipuSearch, type WebRef } from './webSearch'

const nul = <T extends z.ZodType>(t: T) => t.nullable().catch(null)

export const HighlightsSchema = z.object({
  trip: z.array(z.object({
    text: z.string().describe('一句亮点，30 字以内，具体到做什么，例如「傍晚在双廊玉几岛看洱海日落」'),
    stop: nul(z.string()).describe('这句说的是行程里哪个地方（名字照抄行程）'),
    refs: z.array(z.number().int()).catch([]).describe('网上哪几篇推荐、好评了这件事（填参考攻略的编号，如 [2, 5]）'),
  })).catch([]).describe('网上攻略里推荐、好评的，并且这趟真的排到了的事；没有就给 []，不凑数'),
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
    ...(refs.length ? [
      '5. 下面有网上搜到的攻略摘要（带编号）。how、when、tip 优先采用里面多次提到的玩法；摘要可能过时，拿不准的不要用。',
      '6. trip（这趟的亮点）只写攻略摘要里有人推荐、夸过的事，而且必须是行程里排到了的地方：stop 照抄那个地方的名字，refs 填说到它的摘要编号。摘要里没人推荐的地方不写；不要写整趟的笼统话；不凑条数，一个地方最多一条。要和这趟排的时段对得上：下午去的不写「早上八点」，白天去的不写夜景。',
      '7. 超出这群人限制的（海拔、步行太远）不当亮点，只在那个地方的 family 里提醒。',
    ] : ['5. 没有网上攻略可参考：trip 给 []（亮点要有网上的推荐作依据，不凭空写），只写各地方的 how、when、tip、family。']),
  ].join('\n')
  const user = [
    `同行者：${describeMembers(everyone, 0)}`,
    '他们的限制：', ...describeLimits(c).map(l => '- ' + l),
    '', '行程：',
    ...trip.days.map((d, i) => { const sl = scheduleDay(d); return `- 第 ${i + 1} 天：${sl.filter(x => x.stop.kind === 'sight' || x.stop.kind === 'food').map(x => `${x.stop.name}（${fmtHM(x.start)} 起${x.stop.kind === 'food' ? '，吃饭' : `，玩 ${x.stop.durationMin} 分`}）`).join('、') || '休整'}` }),
    ...(refs.length ? ['', '网上搜到的攻略（摘要）：', ...refs.map((r, i) => `[${i + 1}] ${r.title}（${r.site}）${r.about ? `——搜的是「${r.about}」` : ''}\n${r.content}`)] : []),
  ].join('\n')
  return { system, user }
}

/** 行程里排到的地方（去掉「吃完接着逛」的后半段、按先后、不重复） */
function placesInOrder(trip: Trip): { name: string; s: Stop }[] {
  const seen = new Set<string>()
  const out: { name: string; s: Stop }[] = []
  for (const { s } of sightsOf(trip)) {
    if (s.kind !== 'sight' || s.suggested) continue
    const name = s.name.replace(/（吃完接着逛）$/, '')
    if (seen.has(name)) continue
    seen.add(name); out.push({ name, s })
  }
  return out
}

/** 搜的时候带上的地名：区县优先（都江堰市），直辖市的区用城市名；名字里已经有了就不带 */
export function searchArea(name: string, r: { city: string; district: string } | null | undefined): string {
  if (!r) return ''
  const short = (x: string) => x.replace(/(特别行政区|自治州|自治县|地区|新区|市|区|县|州|盟)$/, '')
  const area = /区$/.test(r.district) || !r.district ? r.city : r.district
  return area && !name.includes(short(area)) ? short(area) : ''
}

/**
 * 填了智谱 Key：行程里排到的每个地方各搜一次推荐、好评（最多 max 个，停留久的优先），搜到的摘要记下是搜哪个地方的。
 * areaOf 给了就带上地名一起搜（按坐标问高德在哪个区县）
 */
export async function searchPlayTips(trip: Trip, key: string, max = 8, fetchImpl: typeof fetch = fetch, areaOf?: (s: Stop) => Promise<{ city: string; district: string } | null>): Promise<{ refs: WebRef[]; yuan: number }> {
  const places = placesInOrder(trip)
  const keep = new Set([...places].sort((a, b) => b.s.durationMin - a.s.durationMin).slice(0, max).map(p => p.name))
  const main = places.filter(p => keep.has(p.name))
  const got = await Promise.allSettled(main.map(async ({ name, s }) => {
    const area = areaOf ? searchArea(name, await areaOf(s).catch(() => null)) : ''
    const list = await zhipuSearch(`${area ? area + ' ' : ''}${name} 推荐 好评 怎么玩 攻略`, key, 'search_pro_sogou', fetchImpl)
    // 摘要里得真提到这个地方（名字去掉「景区」「公园」这类后缀也算）
    const core = name.replace(/(景区|风景区|风景名胜区|公园|基地)$/, '').slice(0, 6)
    return pickRefs([list.filter(r => (r.title + r.content).includes(core))], name, 2).map(r => ({ ...r, about: name }))
  }))
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
 * 只有两个字相同不算（实测把服务区的安排对到了「大理古城 人民路」上）。
 * 整趟亮点：对不上行程里的地方、没有网上出处的都不要；一个地方一条；按行程先后排
 */
export function applyHighlights(trip: Trip, h: Highlights, refs: WebRef[] = []): Trip {
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
  const order = new Map(all.map((s, i) => [s.id, i]))
  const used = new Set<string>()
  const highlights: TripHighlight[] = []
  for (const x of h.trip) {
    const s = x.stop ? find(x.stop) : undefined
    // 出处得说到这个地方：搜的就是它，或者正文里提到了它
    const says = (r: WebRef) => !!s && (r.about === s.name.replace(/（吃完接着逛）$/, '') || (r.title + r.content).includes(s.name.replace(/（吃完接着逛）$/, '').slice(0, 6)))
    const src = [...new Set(x.refs)].map(i => refs[i - 1]).filter((r): r is WebRef => !!r && says(r))
    if (!x.text.trim() || !s || !src.length || used.has(s.id)) continue
    used.add(s.id)
    // 出处最多两篇，同一个网站只列一篇
    const uniq = src.filter((r, i) => src.findIndex(y => y.site === r.site) === i)
    highlights.push({ text: x.text.trim(), stopId: s.id, refs: uniq.slice(0, 2).map(r => ({ title: r.title, url: r.url, site: r.site })) })
  }
  highlights.sort((a, b) => order.get(a.stopId!)! - order.get(b.stopId!)!)
  return {
    ...trip,
    highlights,
    days: trip.days.map(d => ({ ...d, stops: d.stops.map(s => (per.has(s.id) ? { ...s, highlight: per.get(s.id) } : s)) })),
  }
}
