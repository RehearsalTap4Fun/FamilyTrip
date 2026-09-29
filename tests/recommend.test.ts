import { describe, expect, it } from 'vitest'
import { buildRecommendPrompt, keepInRegion, proposalToGuide, recommend, type Proposal } from '../src/llm/recommend'
import { resolveGuide } from '../src/llm/importGuide'
import { namesMatch } from '../src/geo/groundDay'
import { seedTrip } from '../src/data/seed'
import type { Trip } from '@core/types'

const t: Trip = { ...seedTrip(), plan: { flow: 'region', styles: ['family', 'scenic'], region: '滇西北', origin: '昆明' } }

const proposal = (title: string): Proposal => ({
  title, pitch: '大理进丽江出', fit: '都是平路，外婆和朵朵都走得动',
  days: [
    { day: 1, city: '大理', places: [{ name: '大理古城', city: '', kind: 'sight', durationMin: 150, note: '慢逛' }, { name: '崇圣寺三塔', city: '大理', kind: 'sight', durationMin: null, note: '拍倒影' }] },
    { day: 2, city: '丽江', places: [{ name: '束河古镇', city: '丽江', kind: 'sight', durationMin: 120, note: '人少' }] },
  ],
  sources: [],
  skipped: [{ name: '玉龙雪山冰川公园', reason: '海拔 4506 米，超过外婆的上限' }],
})

const system0 = () => buildRecommendPrompt({ trip: t, region: '滇西北' }).system

describe('AI 推荐方案', () => {
  it('次要字段漏了（建议时长、参考出处、没放进来的）不让整个推荐失败；格式说明里仍然要求填', async () => {
    const { ProposalsSchema } = await import('../src/llm/recommend')
    const { parseLooseJson, jsonShape } = await import('../src/llm/client')
    const raw = { regionCities: ['大理'], proposals: [{ title: 'x', pitch: 'p', fit: 'f', days: [{ day: 1, city: '大理', places: [{ name: '大理古城', city: '大理', kind: 'sight', note: '' }] }] }] }
    const got = parseLooseJson(JSON.stringify(raw), ProposalsSchema)
    expect(got.proposals[0]).toMatchObject({ sources: [], skipped: [] })
    expect(got.proposals[0].days[0].places[0].durationMin).toBeNull()
    const shape = jsonShape(ProposalsSchema)
    expect(shape).toContain('"sources"')
    expect(shape).toContain('"durationMin"')
  })

  it('提示词带上地区、天数、出行方式、玩法、整趟所有同行者和他们的限制', () => {
    const { system, user } = buildRecommendPrompt({ trip: t, region: '滇西北', wishes: '想看雪山' })
    expect(system).toContain('2 到 3 个')
    expect(system).toContain('只推荐你确定存在、仍在开放的地方')
    expect(system).toContain('skipped')
    expect(user).toContain('地区：滇西北')
    expect(system).toContain('出发地只是起点、不是目的地')
    expect(system).toContain('regionCities')
    expect(user).toContain(`${t.days.length} 天，出行方式：自驾，从昆明出发`)
    expect(user).toContain('亲子游学（主）')
    expect(user).toContain('76 岁老人') // 外婆第二天才加入，也要算上
    expect(user).toContain('海拔不超过')
    expect(user).toContain('另外的要求：想看雪山')
  })

  it('最多取三个方案；用中等思考深度', async () => {
    let effort = ''
    const r = await recommend({ provider: 'deepseek', apiKey: 'k' }, { trip: t, region: '滇西北' }, (async (_c: unknown, req: { effort?: string }) => {
      effort = req.effort ?? ''
      return { data: { regionCities: ['大理', '丽江'], proposals: ['一', '二', '三', '四'].map(proposal) }, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, usd: 0.005 }, model: 'm' }
    }) as never)
    expect(effort).toBe('medium')
    expect(r.proposals.map(p => p.title)).toEqual(['一', '二', '三'])
  })

  it('被出发地带跑的方案丢掉：大半天不在地区里、或在出发地游玩；全被丢就原样交回', () => {
    const at = (title: string, cities: string[]): Proposal => ({ ...proposal(title), days: cities.map((city, i) => ({ day: i + 1, city, places: [{ name: city + '的点', city, kind: 'sight', durationMin: null, note: '' }] })) })
    const got = keepInRegion({ regionCities: ['大理', '丽江市', '香格里拉'], proposals: [
      at('好', ['昆明→大理', '大理', '丽江']), at('楚雄', ['昆明', '楚雄', '楚雄']), at('在昆明玩', ['昆明', '大理', '丽江']),
    ] }, '昆明')
    expect(got.map(p => p.title)).toEqual(['好'])
    expect(keepInRegion({ regionCities: ['大理'], proposals: [at('都不行', ['昆明', '楚雄'])] }, '昆明').map(p => p.title)).toEqual(['都不行'])
  })

  it('方案转成导入攻略的格式：分天成了「想在哪天」，没写城市的用当天的城市', async () => {
    const g = proposalToGuide(proposal('x'), 3)
    expect(g.days).toBe(2)
    expect(g.places[0]).toMatchObject({ name: '大理古城', city: '大理', day: 1, durationMin: 150 })
    expect(system0()).toContain('上午、下午都要有安排')
    const seen: string[] = []
    const r = await resolveGuide(g, 3, async (k, city) => { seen.push(`${city}/${k}`); return [{ name: k, area: city ?? '', poi: { lng: 100, lat: 26 + seen.length / 100, amapId: k } }] }, namesMatch)
    expect(seen[0]).toBe('大理/大理古城')
    expect(r.places.map(p => [p.name, p.prefDay])).toEqual([['大理古城', 0], ['崇圣寺三塔', 0], ['束河古镇', 1]])
    expect(r.places.every(p => p.day === undefined)).toBe(true)
  })
})
