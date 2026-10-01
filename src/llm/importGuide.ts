// 导入攻略：一篇游记正文 → 大模型提炼路线与地点（标出与这群同行者冲突的地方）→ 高德核实 → 排程引擎的输入（PlanPlace）。
// 正文来自用户粘贴，或服务器按用户贴的链接代取（server/api-server.mjs）。只提炼原文里有的，不编。
import { distanceKm } from '@core/geo'
import { z } from 'zod'
import { deriveConstraints } from '@core/constraints'
import { bestTimeOf } from '@core/timeOfDay'
import { partyOnDay } from '@core/party'
import type { PlanPlace, Trip } from '@core/types'
import { callStructured, cut, type LlmConfig, type StructuredCall, type StructuredResult, type Usage } from './client'
import { describeLimits, describeMembers } from './routePrompt'

export const GuideSchema = z.object({
  title: z.string().describe('这篇攻略的标题，没有就概括一个'),
  days: z.number().int().nullable().describe('原文行程一共几天；看不出填 null'),
  summary: z.string().describe('一两句话说这篇的路线，例如「丽江进大理出，环洱海 + 雪山」'),
  places: z.array(z.object({
    name: z.string().describe('地点在高德地图上能搜到的正式名称，例如「崇圣寺三塔文化旅游区」「玉龙雪山」'),
    city: z.string().describe('所在城市，例如「大理」「丽江」'),
    kind: z.enum(['sight', 'food', 'lodging']).describe('sight 景点或体验；food 有名字的具体餐厅；lodging 有名字的具体住处'),
    day: z.number().int().nullable().describe('原文安排在第几天（从 1 起）；没说填 null'),
    durationMin: z.number().int().nullable().catch(null).describe('建议停留多久（分钟）：原文说了按原文，没说按一般游客估；大景区里的小景点一般 15–40 分钟'),
    area: z.string().nullable().catch(null).describe('它属于哪个大景区（例如伏龙观、宝瓶口属于「都江堰景区」，上清宫、天师洞属于「青城山前山」）；本身就是一个独立景点填 null'),
    note: z.string().describe('原文怎么说这个地方，20 字以内'),
    bestTime: z.enum(['morning', 'day', 'evening']).nullable().optional().catch(null).describe('最佳时段：看夜景、夜市、灯光、日落的写 evening；看日出、赶早市、要趁早人少的写 morning；白天都行写 day'),
    avoid: z.string().nullable().describe('明显不适合这群人时写原因（20 字以内）：超过他们的限制（海拔、步行、驾驶）、刺激项目、禁止带宠物等。例如「海拔 4680 米，超过外婆的上限」；没有填 null'),
    caution: z.string().nullable().describe('能去但要留意的小事（20 字以内），例如「石板路推车不方便」；没有填 null'),
  })),
  tips: z.array(z.string()).describe('原文里的实用提醒（预约、避坑、交通），最多 5 条，每条 30 字以内'),
})
export type Guide = z.infer<typeof GuideSchema>

/** 正文最多送这么多字：一篇长游记的行程部分足够了，也控制花费 */
const MAX_CHARS = 12000

export function buildGuidePrompt(trip: Trip, text: string): { system: string; user: string } {
  // 整趟里会同行的每个人都算上（中途加入的外婆也要照顾到），限制按最严的
  const everyone = { ...trip.party, members: trip.party.members.map(m => ({ ...m, days: undefined })), pets: trip.party.pets.map(p => ({ ...p, days: undefined })) }
  const c = deriveConstraints(partyOnDay(everyone, 0))
  const system = [
    '你从一篇旅行攻略 / 游记的正文里提炼行程，给一个家庭做参考。',
    '规则：',
    '1. 只提取原文里实际去过或推荐的地方，不要自己补充原文没有的地点。',
    '2. 跳过机场、火车站、汽车站这类交通点，跳过「古城里随便逛逛」这种没有具体地点的说法。',
    '3. 吃饭、住宿只收有具体名字的店；「小吃街」「夜市」算景点。',
    '4. 同一个地方原文提了多次只收一次；name 用高德地图上能搜到的正式名称。',
    '5. 对照下面这群同行者的限制判断：只有真的超出限制或明显不适合（海拔超上限、步行远超上限、骑马漂流这类刺激项目、禁止带宠物）才写 avoid；',
    '   能去只是要留意的（推车不方便、要防晒、人多）写 caution；两者都没有就都填 null。大部分地方应该两个都是 null，不要泛泛地写「注意安全」「宠物牵绳」。',
    '6. 原文按天写了就填 day；没分天就填 null。',
    '7. 大景区里的小景点（园中园、景区里的一个个点）照样一个个列出来，但都要填 area（所属大景区的正式名称），durationMin 按在园里看这一处的时间估。',
  ].join('\n')
  const user = [
    `同行者：${describeMembers(everyone, 0)}`,
    '他们的限制：', ...describeLimits(c).map(l => '- ' + l),
    '', '攻略正文：', cut(text, MAX_CHARS),
  ].join('\n')
  return { system, user }
}

export async function extractGuide(cfg: LlmConfig, trip: Trip, text: string, caller: <S extends z.ZodType>(cfg: LlmConfig, req: StructuredCall<S>) => Promise<StructuredResult<z.infer<S>>> = callStructured): Promise<{ guide: Guide; usage: Usage }> {
  const { system, user } = buildGuidePrompt(trip, text)
  const r = await caller(cfg, { system, user, schema: GuideSchema, effort: 'low' })
  return { guide: r.data, usage: r.usage }
}

/** 核实后的一个地点：排程引擎的输入，外加原文说法、「不适合」和「要留意」，给人勾选时看 */
export interface ImportedPlace extends PlanPlace { note: string; avoid?: string; caution?: string; /** 合并成一站时，园区里包含的小景点（按原文顺序） */ parts?: string[] }

export interface SearchHit { name: string; area: string; poi: PlanPlace['poi']; type?: string; photo?: string }

/** 一趟的地方离「这趟在哪一带」超过这么远就不认（多半搜到了外地同名的） */
const REGION_KM = 500

/** 高德里这些分类不是玩的地方（「马久邑」会搜到「马久邑村村委会」、「离堆公园」会搜到「离堆公园站」公交站）：同名时排到后面 */
const NOT_PLACE = /^(政府机构|公司企业|商务住宅|金融保险|科教文化服务;学校|公共设施;公共厕所|交通设施服务;(停车场|公交车站|地铁站|火车站|长途汽车站|港口码头))/
const rank = (h: SearchHit) => (h.type && NOT_PLACE.test(h.type) ? 1 : 0)

/**
 * 逐个在高德里找：先在它所在的城市找，找不到再带上城市名搜一次；名字要对得上（两个连着的字相同）。
 * 原文按天写、而且天数和这趟一样，就把原文的日子记成「想在哪天」（只是偏好，排程放不下或那天空了会挪）；否则交给排程引擎自己分天。
 */
export async function resolveGuide(guide: Guide, tripDays: number, searchRaw: (keyword: string, city?: string) => Promise<SearchHit[]>, match: (q: string, found: string) => boolean, onProgress?: (i: number, n: number, name: string) => void): Promise<{ places: ImportedPlace[]; missing: string[] }> {
  // 同一个词只搜一次：下面先整体搜一轮认地区，逐个核实时直接用缓存
  const memo = new Map<string, Promise<SearchHit[]>>()
  const search0 = (k: string, city?: string) => { const key = k + '\u0001' + (city ?? ''); if (!memo.has(key)) memo.set(key, searchRaw(k, city)); return memo.get(key)! }
  const places: ImportedPlace[] = []
  const missing: string[] = []
  // 先认这趟在哪一带：所有地方各搜一次，取第一个对得上的结果的坐标中位数；之后离这一带 500 公里以外的结果都不认。
  // 北海道的「音乐盒堂」「缆车」被对到了上海五原路、北京八达岭（2026-09-30 用户反馈）：高德不认「札幌」，就全国搜同名的
  const firstHits: { lng: number; lat: number }[] = []
  for (const p of guide.places) {
    const q = p.area && p.kind === 'sight' ? p.area : p.name
    const list = await search0(q, p.city).catch(() => [] as SearchHit[])
    const h = list.find(x => match(q, x.name)) ?? list.find(x => x.poi.gid)
    if (h) firstHits.push(h.poi)
  }
  const med = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : NaN }
  const center = firstHits.length >= 3 ? { lng: med(firstHits.map(p => p.lng)), lat: med(firstHits.map(p => p.lat)) } : undefined
  const near = (h: SearchHit) => !center || distanceKm(center, h.poi) <= REGION_KM
  const search = async (k: string, city?: string) => (await search0(k, city)).filter(near)
  // 原文天数和这趟一样才沿用它的分天；原文是一日游、这趟有两天，照搬等于全挤在第一天（2026-09-29 都江堰青城山那篇就是这样）
  const keepDays = guide.days != null && guide.days === tripDays
  const seen = new Set<string>()
  // 同一个大景区里的小景点合成一站：园区一口气逛完，时长加起来（15–40 分一处），说明里写园内顺序
  const groups = new Map<string, Guide['places']>()
  for (const p of guide.places) if (p.kind === 'sight' && p.area) groups.set(p.area, [...(groups.get(p.area) ?? []), p])
  const merged = new Set<Guide['places'][number]>()
  for (const [area, list] of groups) {
    if (list.length < 2) continue
    list.forEach(p => merged.add(p))
    onProgress?.(0, guide.places.length, area)
    const city = list[0].city
    let hit: SearchHit | undefined = (await search(area, city)).filter(h => match(area, h.name)).sort((a, b) => rank(a) - rank(b))[0]
    if (!hit) for (const p of list) { hit = (await search(p.name, p.city)).find(h => match(p.name, h.name)); if (hit) break }
    if (!hit) { missing.push(area); continue }
    const key = hit.poi.amapId ?? `${hit.poi.lng},${hit.poi.lat}`
    if (seen.has(key)) continue
    seen.add(key)
    const minutes = list.reduce((a, p) => a + Math.min(90, Math.max(10, p.durationMin ?? 30)), 0)
    const day = list.map(p => p.day).find(d => d != null)
    places.push({
      id: 'ga-' + key, name: hit.name, kind: 'sight', poi: hit.poi, area: hit.area, ...(hit.photo ? { photo: hit.photo } : {}),
      ...(keepDays && day != null && day >= 1 ? { prefDay: Math.min(tripDays, day) - 1 } : {}),
      durationMin: Math.min(300, Math.max(60, Math.round(minutes / 10) * 10)),
      why: '园内按这个顺序：' + list.map(p => p.name.replace(area, '').replace(/^[-·\s]+/, '') || p.name).join(' → '),
      note: `含 ${list.length} 处：${list.map(p => p.name.replace(area, '').replace(/^[-·\s]+/, '') || p.name).join('、')}`,
      parts: list.map(p => p.name),
      // 园区里有要晚上看的（例如古城夜景），整个园区按晚上排
      ...(list.map(p => bestTimeOf(p.bestTime, p.note)).find(Boolean) ? { bestTime: list.map(p => bestTimeOf(p.bestTime, p.note)).find(Boolean) } : {}),
      ...(list.find(p => p.avoid)?.avoid ? { avoid: list.find(p => p.avoid)!.avoid! } : {}),
      ...(list.find(p => p.caution)?.caution ? { caution: list.find(p => p.caution)!.caution! } : {}),
    })
  }
  for (const [i, p] of guide.places.entries()) {
    if (merged.has(p)) continue
    onProgress?.(i + 1, guide.places.length, p.name)
    const pickHit = (list: SearchHit[]) => list.filter(h => match(p.name, h.name)).sort((a, b) => rank(a) - rank(b))[0]
    let got: SearchHit[] = await search(p.name, p.city)
    let hit: SearchHit | undefined = pickHit(got)
    if (!hit && p.city && !p.name.includes(p.city)) { const more = await search(p.city + p.name, p.city); hit = pickHit(more); got = [...got, ...more] }
    // 国外的地方 Google 常给英文、日文名（白色恋人公园 → Shiroi Koibito Park）：字对不上时信 Google 的第一个（上面已经限在这一带），名字用原文的中文
    let foreign = false
    if (!hit) { hit = got.find(h => h.poi.gid); foreign = !!hit }
    if (!hit) { missing.push(p.name); continue }
    const key = hit.poi.amapId ?? `${hit.poi.lng},${hit.poi.lat}`
    if (seen.has(key)) continue
    seen.add(key)
    places.push({
      id: 'g' + (i + 1) + '-' + key,
      name: foreign ? p.name : hit.name, kind: p.kind, poi: hit.poi, area: foreign ? [hit.area, hit.name].filter(Boolean).join(' · ') : hit.area, ...(hit.photo ? { photo: hit.photo } : {}),
      ...(keepDays && p.day != null && p.day >= 1 ? { prefDay: Math.min(tripDays, p.day) - 1 } : {}),
      ...(p.durationMin && p.durationMin > 0 ? { durationMin: Math.min(480, p.durationMin) } : {}),
      note: p.note, ...(p.avoid ? { avoid: p.avoid } : {}), ...(p.caution ? { caution: p.caution } : {}),
      ...(p.kind === 'sight' && bestTimeOf(p.bestTime, p.note) ? { bestTime: bestTimeOf(p.bestTime, p.note) } : {}),
    })
  }
  return { places, missing }
}
