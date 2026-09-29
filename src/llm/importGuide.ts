// 导入攻略：一篇游记正文 → 大模型提炼路线与地点（标出与这群同行者冲突的地方）→ 高德核实 → 排程引擎的输入（PlanPlace）。
// 正文来自用户粘贴，或服务器按用户贴的链接代取（server/api-server.mjs）。只提炼原文里有的，不编。
import { z } from 'zod'
import { deriveConstraints } from '@core/constraints'
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
    durationMin: z.number().int().nullable().describe('原文说玩多久（分钟）；没说填 null'),
    note: z.string().describe('原文怎么说这个地方，20 字以内'),
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
export interface ImportedPlace extends PlanPlace { note: string; avoid?: string; caution?: string }

export interface SearchHit { name: string; area: string; poi: PlanPlace['poi']; type?: string }

/** 高德里这些分类不是玩的地方（「马久邑」会搜到「马久邑村村委会」、「离堆公园」会搜到「离堆公园站」公交站）：同名时排到后面 */
const NOT_PLACE = /^(政府机构|公司企业|商务住宅|金融保险|科教文化服务;学校|公共设施;公共厕所|交通设施服务;(停车场|公交车站|地铁站|火车站|长途汽车站|港口码头))/
const rank = (h: SearchHit) => (h.type && NOT_PLACE.test(h.type) ? 1 : 0)

/**
 * 逐个在高德里找：先在它所在的城市找，找不到再带上城市名搜一次；名字要对得上（两个连着的字相同）。
 * 原文按天写、而且天数不超过这趟行程，就把原文的日子记成「想在哪天」（只是偏好，排程放不下或那天空了会挪）；否则交给排程引擎自己分天。
 */
export async function resolveGuide(guide: Guide, tripDays: number, search: (keyword: string, city?: string) => Promise<SearchHit[]>, match: (q: string, found: string) => boolean, onProgress?: (i: number, n: number, name: string) => void): Promise<{ places: ImportedPlace[]; missing: string[] }> {
  const places: ImportedPlace[] = []
  const missing: string[] = []
  const keepDays = guide.days != null && guide.days <= tripDays
  const seen = new Set<string>()
  for (const [i, p] of guide.places.entries()) {
    onProgress?.(i + 1, guide.places.length, p.name)
    const pickHit = (list: SearchHit[]) => list.filter(h => match(p.name, h.name)).sort((a, b) => rank(a) - rank(b))[0]
    let hit = pickHit(await search(p.name, p.city))
    if (!hit && p.city && !p.name.includes(p.city)) hit = pickHit(await search(p.city + p.name, p.city))
    if (!hit) { missing.push(p.name); continue }
    const key = hit.poi.amapId ?? `${hit.poi.lng},${hit.poi.lat}`
    if (seen.has(key)) continue
    seen.add(key)
    places.push({
      id: 'g' + (i + 1) + '-' + key,
      name: hit.name, kind: p.kind, poi: hit.poi, area: hit.area,
      ...(keepDays && p.day != null && p.day >= 1 ? { prefDay: Math.min(tripDays, p.day) - 1 } : {}),
      ...(p.durationMin && p.durationMin > 0 ? { durationMin: Math.min(480, p.durationMin) } : {}),
      note: p.note, ...(p.avoid ? { avoid: p.avoid } : {}), ...(p.caution ? { caution: p.caution } : {}),
    })
  }
  return { places, missing }
}
