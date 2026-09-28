// 流程二「只知道大概去哪」：按地区、天数、玩法、全体同行人的限制，让大模型凭自己的知识出 2–3 个具体方案。
// 挑一个方案后，地点走和导入攻略同一条路：高德核实（resolveGuide）→ 排程引擎（core/planner.ts）→ 规则检查。
// 没有联网搜索：信息可能不是最新的（新开的、关了的它不知道），所以核实地点这一步不能省。
import { z } from 'zod'
import { deriveConstraints } from '@core/constraints'
import { partyOnDay } from '@core/party'
import { STYLES } from '@core/trips'
import type { Trip } from '@core/types'
import { callStructured, type LlmConfig, type StructuredCall, type StructuredResult, type Usage } from './client'
import type { Guide } from './importGuide'
import { describeLimits, describeMembers } from './routePrompt'

export const ProposalsSchema = z.object({
  regionCities: z.array(z.string()).describe('这个地区包含的主要城市 / 片区，例如滇西北：大理、丽江、香格里拉、怒江。先列出来，下面每天的 city 都要是其中之一'),
  proposals: z.array(z.object({
    title: z.string().describe('方案名，10 字以内，例如「大理慢游 + 洱海骑行」'),
    pitch: z.string().describe('一句话说这个方案的特点，30 字以内'),
    fit: z.string().describe('为什么适合这群人，40 字以内，要具体到人'),
    days: z.array(z.object({
      day: z.number().int().describe('第几天，从 1 起'),
      city: z.string().describe('这天主要在哪个城市 / 片区'),
      places: z.array(z.object({
        name: z.string().describe('高德地图上能搜到的正式名称'),
        city: z.string().describe('所在城市'),
        kind: z.enum(['sight', 'food', 'lodging']).describe('sight 景点或体验；food 有名的具体餐厅；lodging 具体住处（一般不用给）'),
        durationMin: z.number().int().nullable().describe('建议玩多久（分钟），按这群人的节奏估；餐厅填 null'),
        note: z.string().describe('推荐理由，15 字以内'),
      })).describe('这天去的地方：上午、下午都要有安排，景点 2–4 个，可以加 1 家有名的餐厅'),
    })),
    skipped: z.array(z.object({
      name: z.string(),
      reason: z.string().describe('为什么不适合这群人，20 字以内'),
    })).describe('这个地区很热门、但故意没放进来的地方（最多 3 个）'),
  })).describe('2 到 3 个方案，彼此要有明显区别（路线、节奏或玩法不同）'),
})
export type Proposals = z.infer<typeof ProposalsSchema>
export type Proposal = Proposals['proposals'][number]

export interface RecommendInput {
  trip: Trip
  region: string
  /** 另外的要求，例如「想看雪山」「少走路」 */
  wishes?: string
}

const MODE_CN = { selfDrive: '自驾', tour: '跟团', transit: '公共交通' } as const

export function buildRecommendPrompt({ trip, region, wishes }: RecommendInput): { system: string; user: string } {
  // 整趟里会同行的每个人都算上，限制按最严的
  const everyone = { ...trip.party, members: trip.party.members.map(m => ({ ...m, days: undefined })), pets: trip.party.pets.map(p => ({ ...p, days: undefined })) }
  const c = deriveConstraints(partyOnDay(everyone, 0))
  const styles = trip.plan?.styles ?? []
  const system = [
    '你是熟悉中国各地的家庭旅行规划师。按用户给的地区、天数和同行者，推荐 2 到 3 个具体可行的方案。',
    '规则：',
    '1. 每个方案按天列出去的地方，天数和用户给的一致。每天上午、下午都要有安排（有午睡就是午睡后），给出每个地方建议玩多久（durationMin），一天的景点时长加起来接近「每天在外上限减去两顿饭约 2 小时」，但不要超；要符合同行者的限制（海拔、步行、驾驶时长）。',
    '2. 同一天的地方要在一片区域里，天与天之间顺路，不要来回折返；自驾时相邻两天的城市之间开车不要超过同行者的每天驾驶上限。',
    '3. 地名用高德地图上能搜到的正式名称；只推荐你确定存在、仍在开放的地方，拿不准的不要写。',
    '4. 这个地区很热门、但不适合这群人的地方放进 skipped，写清楚原因（例如海拔超了老人的上限、要徒步很久）。',
    '5. 方案之间要有明显区别：路线不同、节奏不同，或者侧重的玩法不同。',
    '6. 住宿一般不用给（排程时会在当晚附近推荐）；餐厅只给当地真有名、适合带老人小孩的。',
    '7. 先在 regionCities 里列出这个地区包含的主要城市 / 片区。每个方案每天的 city 都必须是其中之一，不能换成别的地区。',
    '8. 出发地只是起点、不是目的地：不要在出发地安排游玩；第一天从出发地出发、当天到达这个地区（路远就把第一天当赶路日，只在到达的城市排一两个点）。不要安排返程那天，除非用户要求。',
    '9. 地区里个别地方超出了同行者的限制（例如海拔），就只把那些地方放进 skipped，同一个城市里不超的照样可以去（例如古城海拔没超，就不要因为附近的雪山超了而不去这个城市）。',
  ].join('\n')
  const user = [
    `地区：${region}（方案都要在这个地区里）`,
    `天数：${trip.days.length} 天，出行方式：${MODE_CN[trip.party.mode]}${trip.plan?.origin ? `，从${trip.plan.origin}出发` : ''}`,
    `同行者：${describeMembers(everyone, 0)}`,
    '他们的限制：', ...describeLimits(c).map(l => '- ' + l),
    ...(styles.length ? ['想怎么玩：' + styles.map((s, i) => `${STYLES[s].label}${styles.length > 1 ? (i === 0 ? '（主）' : '（辅）') : ''}：偏向${STYLES[s].seek}`).join('；')] : []),
    ...(wishes?.trim() ? [`另外的要求：${wishes.trim()}`] : []),
  ].join('\n')
  return { system, user }
}

type Caller = <S extends z.ZodType>(cfg: LlmConfig, req: StructuredCall<S>) => Promise<StructuredResult<z.infer<S>>>

export async function recommend(cfg: LlmConfig, input: RecommendInput, caller: Caller = callStructured): Promise<{ proposals: Proposal[]; usage: Usage }> {
  const { system, user } = buildRecommendPrompt(input)
  const r = await caller(cfg, { system, user, schema: ProposalsSchema, effort: 'medium' })
  return { proposals: keepInRegion(r.data, input.trip.plan?.origin).slice(0, 3), usage: r.usage }
}

/** 模型常被出发地带跑（「滇西北」给出昆明、楚雄的方案）：一半以上的天不在它自己列的地区城市里、或在出发地游玩的方案丢掉；全被丢掉就原样交回，让人自己看 */
export function keepInRegion(p: Proposals, origin?: string): Proposal[] {
  const cities = p.regionCities.map(c => c.replace(/(市|州|县|地区|片区)$/, '')).filter(c => c.length >= 2)
  const inRegion = (city: string) => cities.some(c => city.includes(c) || c.includes(city.replace(/(市|州|县)$/, '')))
  const atOrigin = (city: string) => !!origin && city.replace(/[→\-—].*$/, '').includes(origin.replace(/(市|州|县)$/, '')) && !inRegion(city.replace(/^.*[→\-—]/, ''))
  const ok = p.proposals.filter(x => {
    if (!cities.length || !x.days.length) return true
    const good = x.days.filter(d => inRegion(d.city)).length
    return good * 2 >= x.days.length && !x.days.some(d => atOrigin(d.city) && d.places.some(pl => pl.kind === 'sight'))
  })
  return ok.length ? ok : p.proposals
}

/** 一个方案转成导入攻略的格式，后面直接复用高德核实；方案里的分天记成「想在哪天」（软偏好） */
export function proposalToGuide(p: Proposal, tripDays: number): Guide {
  return {
    title: p.title,
    days: Math.min(tripDays, Math.max(1, ...p.days.map(d => d.day))),
    summary: p.pitch,
    tips: [],
    places: p.days.flatMap(d => d.places.map(pl => ({
      name: pl.name, city: pl.city || d.city, kind: pl.kind, day: d.day, durationMin: pl.kind === 'sight' ? pl.durationMin ?? null : null, note: pl.note, avoid: null, caution: null,
    }))),
  }
}
