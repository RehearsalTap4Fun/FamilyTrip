import { describe, expect, it } from 'vitest'
import { pickRefs, searchGuides, searchQueries, zhipuSearch, type WebRef } from '../src/llm/webSearch'
import { buildRecommendPrompt } from '../src/llm/recommend'
import { seedTrip } from '../src/data/seed'
import type { Trip } from '@core/types'

const t: Trip = { ...seedTrip(), plan: { flow: 'region', styles: ['family'], region: '滇西北' } }
const ref = (url: string, title: string, content = '大理古城 洱海 亲子'.repeat(20)): WebRef => ({ url, title, site: '', content })

describe('半个 emoji', () => {
  it('截断不切开 emoji；发出去之前去掉落单的半个字符，请求体能被严格的 JSON 解析器读', async () => {
    const { cleanText, cut } = await import('../src/llm/client')
    const s = '好'.repeat(599) + '🏔️雪山'
    expect(s.slice(0, 600).endsWith('\ud83c')).toBe(true) // 按 UTF-16 截就会切开
    expect(cut(s, 600)).toBe('好'.repeat(599) + '🏔')
    const broken = '看日落\ud83d' + '还有\udc4d单独的后半'
    expect(cleanText(broken)).toBe('看日落还有单独的后半')
    expect(cleanText('🏔️🐼完整的不动')).toBe('🏔️🐼完整的不动')
    // 严格解析器（DeepSeek）会拒绝落单代理项的转义；清理后序列化里不再有
    expect(JSON.stringify(cleanText(broken))).not.toMatch(/\\ud[89a-f]/i)
  })

  it('网上搜到的摘要带 emoji 被截断时也不会留下半个', () => {
    const got = pickRefs([[{ url: 'https://hk.trip.com/1', title: '滇西北🏔️亲子', site: '', content: '滇'.repeat(599) + '🐼熊猫' }]], '滇西北')
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(got[0].content)).toBe(false)
  })
})

describe('联网搜攻略', () => {
  it('搜索词带上地区、天数、同行特点、自驾和玩法', () => {
    const [a, b] = searchQueries(t, '滇西北')
    expect(a).toBe(`滇西北 ${t.days.length}天 带老人小孩 带狗 自驾 攻略`)
    expect(b).toBe('滇西北 亲子游学 游记 行程')
  })

  it('合并：去重、丢内容农场、攻略站排前面、去掉高亮标签、摘要截短', () => {
    const got = pickRefs([
      [ref('https://www.hjiayou.com/1', '农场文'), ref('https://blog.example.com/a', '个人博客滇西北'), ref('https://hk.trip.com/moments/1?x=1', '滇西北親子遊', '<em>滇西北</em>' + '好'.repeat(900))],
      [ref('https://hk.trip.com/moments/1?x=2', '滇西北親子遊'), ref('https://www.mafengwo.cn/i/2', '大理带娃三天')],
    ], '滇西北')
    expect(got.map(r => r.title)).toEqual(['滇西北親子遊', '大理带娃三天', '个人博客滇西北'])
    expect(got[0].content.startsWith('滇西北好')).toBe(true)
    expect(got[0].content.length).toBe(600)
  })

  it('解析智谱返回；Key 无效给可读的提示', async () => {
    const ok = (async () => ({ ok: true, status: 200, json: async () => ({ search_result: [{ title: 't', link: 'https://a.com/1', content: 'c', media: '新浪', publish_date: '2026-05-01' }, { title: 'no link', content: 'x' }] }) })) as unknown as typeof fetch
    expect(await zhipuSearch('q', 'k', 'search_pro_sogou', ok)).toEqual([{ title: 't', url: 'https://a.com/1', site: '新浪', content: 'c', date: '2026-05-01' }])
    const bad = (async () => ({ ok: false, status: 401, json: async () => ({ error: { message: '令牌已过期或验证不正确' } }) })) as unknown as typeof fetch
    await expect(zhipuSearch('q', 'k', 'search_pro_sogou', bad)).rejects.toThrow('中间有个点')
  })

  it('两组词 × 两个引擎；有一路失败照样出结果，全失败才报错；报花费', async () => {
    let n = 0
    const half = (async (_u: string, init: RequestInit) => {
      const me = ++n
      const body = JSON.parse(String(init.body))
      if (body.search_engine === 'search_pro_quark') throw new Error('net')
      return { ok: true, status: 200, json: async () => ({ search_result: [{ title: body.search_query, link: 'https://hk.trip.com/' + me, content: '滇西北' }] }) }
    }) as unknown as typeof fetch
    const r = await searchGuides(t, '滇西北', 'k', half)
    expect(n).toBe(4)
    expect(r.refs).toHaveLength(2)
    expect(r.cost).toBeCloseTo(0.2)
    const down = (async () => { throw new Error('net') }) as unknown as typeof fetch
    await expect(searchGuides(t, '滇西北', 'k', down)).rejects.toThrow('连不上智谱搜索')
  })

  it('推荐提示词带上编号的参考攻略，要求注明出处、别用不存在的', () => {
    const { system, user } = buildRecommendPrompt({ trip: t, region: '滇西北', refs: [ref('https://hk.trip.com/1', '滇西北親子遊', '住在洱海边')] })
    expect(system).toContain('在 sources 里写这个方案主要参考了哪几篇')
    expect(system).toContain('可能过时或夸大')
    expect(user).toContain('[1] 滇西北親子遊')
    expect(user).toContain('住在洱海边')
    expect(buildRecommendPrompt({ trip: t, region: '滇西北' }).user).not.toContain('网上搜到的攻略')
  })
})
