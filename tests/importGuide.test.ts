import { describe, expect, it } from 'vitest'
// @ts-expect-error 服务端是纯 .mjs，没有类型声明
import { allowed, extractText } from '../server/api-server.mjs'
import { buildGuidePrompt, extractGuide, resolveGuide, type Guide, type SearchHit } from '../src/llm/importGuide'
import { findUrl } from '../src/llm/fetchGuide'
import { namesMatch } from '../src/geo/groundDay'
import { seedTrip } from '../src/data/seed'

const t = seedTrip()

describe('取正文服务', () => {
  it('只认攻略平台（含子域名、短链接域名），别的一律拒绝', () => {
    for (const u of ['https://you.ctrip.com/travels/1.html', 'http://xhslink.com/a/b', 'https://xhslink.cn/o/4uxq0HahLcY', 'https://www.xiaohongshu.com/explore/1', 'https://mp.weixin.qq.com/s/x', 'https://m.mafengwo.cn/i/1.html'])
      expect(allowed(u)).toBe(true)
    for (const u of ['http://127.0.0.1:22/', 'https://evil.com/ctrip.com', 'https://ctrip.com.evil.com/', 'file:///etc/passwd', 'https://weixin.qq.com.cn/', 'not a url'])
      expect(allowed(u)).toBe(false)
  })

  it('携程：从正文专区截到页脚，导航、页脚不进来；行内链接不把中文拆开', () => {
    const html = `<html><head><title>大理五天</title></head><body><nav>酒店 机票 火车票</nav>
      <div class="yj_content"><p>第1天 <a href="#">大理古城</a>慢慢逛</p><p>第2天 环洱海，去了<b>双廊</b></p>${'<p>很长的正文。</p>'.repeat(80)}</div>
      <div class="footer">关于我们 联系我们</div></body></html>`
    const r = extractText(html, 'https://you.ctrip.com/travels/1.html')
    expect(r.title).toBe('大理五天')
    expect(r.text).toContain('第1天 大理古城慢慢逛')
    expect(r.text).toContain('去了双廊')
    expect(r.text).not.toContain('机票')
    expect(r.text).not.toContain('联系我们')
    expect(r.partial).toBe(false)
  })

  it('小红书：笔记在页面自带的初始数据里；公众号：取 js_content', () => {
    const note = { note: { noteDetailMap: { x: { note: { title: '丽江亲子 3 天', desc: '第一天 束河古镇\n第二天 玉龙雪山蓝月谷'.repeat(20), user: { desc: '短' } } } } } }
    const xhs = `<html><script>window.__INITIAL_STATE__=${JSON.stringify(note).replace('"短"', 'undefined')}</script></html>`
    const a = extractText(xhs, 'https://www.xiaohongshu.com/explore/1')
    expect(a.text.startsWith('丽江亲子 3 天')).toBe(true)
    expect(a.title).toBe('丽江亲子 3 天') // 用笔记自己的标题，不是笼统的「小红书」
    expect(a.text).toContain('玉龙雪山蓝月谷')
    const wx = `<html><meta property="og:title" content="滇西北自驾"><div id="js_content"><p>D1 昆明到大理</p>${'<p>内容</p>'.repeat(200)}</div><script>var a=1</script></html>`
    const b = extractText(wx, 'https://mp.weixin.qq.com/s/x')
    expect(b.title).toBe('滇西北自驾')
    expect(b.text).toContain('D1 昆明到大理')
  })

  it('只拿到几句话（要登录才能看全文）标成 partial', () => {
    const r = extractText('<html><body><p>当前内容因权限无法查看</p><p>App内打开</p></body></html>', 'https://www.xiaohongshu.com/explore/1')
    expect(r.partial).toBe(true)
  })
})

describe('导入攻略', () => {
  it('分享文案里找出链接', () => {
    expect(findUrl('丽江3天2夜攻略 http://xhslink.com/a/AbC123，复制打开小红书')).toBe('http://xhslink.com/a/AbC123')
    expect(findUrl('没有链接')).toBeNull()
  })

  it('提示词带上同行者和限制，要求只提原文里的地方、给顾虑', () => {
    const { system, user } = buildGuidePrompt(t, '第1天 玉龙雪山冰川公园'.repeat(2000))
    expect(system).toContain('不要自己补充原文没有的地点')
    expect(system).toContain('avoid')
    expect(system).toContain('大部分地方应该两个都是 null')
    expect(user).toContain('76 岁老人')
    expect(user).toContain('海拔不超过')
    expect(user.length).toBeLessThan(13000) // 正文截断
  })

  it('交给大模型用低思考深度；结构照 schema', async () => {
    let effort = ''
    const guide: Guide = { title: 'x', days: 2, summary: 's', places: [], tips: [] }
    const r = await extractGuide({ provider: 'deepseek', apiKey: 'k' }, t, '正文', (async (_c: unknown, req: { effort?: string }) => { effort = req.effort ?? ''; return { data: guide, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, usd: 0.001 }, model: 'm' } }) as never)
    expect(effort).toBe('low')
    expect(r.guide.title).toBe('x')
  })

  const guide = (days: number | null): Guide => ({
    title: '大理丽江', days, summary: '丽江进大理出', tips: ['雪山要提前预约'],
    places: [
      { name: '束河古镇', city: '丽江', kind: 'sight', day: 1, durationMin: 120, note: '人少', avoid: null, caution: null },
      { name: '玉龙雪山冰川公园', city: '丽江', kind: 'sight', day: 2, durationMin: null, note: '坐索道', avoid: '海拔 4506 米，外婆不适合', caution: null },
      { name: '三塔', city: '大理', kind: 'sight', day: 3, durationMin: null, note: '倒影好看', avoid: null, caution: null },
      { name: '不存在的地方', city: '大理', kind: 'sight', day: null, durationMin: null, note: '', avoid: null, caution: null },
      { name: '束河古镇', city: '丽江', kind: 'sight', day: 3, durationMin: null, note: '又去', avoid: null, caution: null },
    ],
  })
  const P = (lng: number, lat: number, id: string) => ({ lng, lat, adcode: '530000', amapId: id })
  const search = async (k: string): Promise<SearchHit[]> => {
    if (k.includes('束河')) return [{ name: '束河古镇', area: '丽江', poi: P(100.2, 26.9, 'A') }]
    if (k.includes('冰川')) return [{ name: '玉龙雪山冰川公园', area: '丽江', poi: P(100.2, 27.1, 'B') }]
    if (k === '大理三塔') return [{ name: '崇圣寺三塔文化旅游区', area: '大理', poi: P(100.1, 25.7, 'C') }]
    return [{ name: '毫不相干的店', area: '大理', poi: P(100, 25, 'Z') }]
  }

  it('高德核实：名字对不上不认；找不到再带城市名搜；同一个地方只收一次；顾虑带上', async () => {
    const r = await resolveGuide(guide(3), 4, search, namesMatch)
    expect(r.places.map(p => p.name)).toEqual(['束河古镇', '玉龙雪山冰川公园', '崇圣寺三塔文化旅游区'])
    expect(r.missing).toEqual(['不存在的地方'])
    expect(r.places[1].avoid).toContain('4506')
    expect(r.places[0]).toMatchObject({ prefDay: 0, durationMin: 120 })
    expect(r.places[0].day).toBeUndefined() // 原文的分天只是偏好，不是指定
  })

  it('同名时村委会、公司这类排到后面', async () => {
    const g: Guide = { title: 'x', days: null, summary: '', tips: [], places: [{ name: '马久邑', city: '大理', kind: 'sight', day: null, durationMin: null, note: '', avoid: null, caution: null }] }
    const r = await resolveGuide(g, 3, async () => [
      { name: '马久邑村村委会', area: '大理', poi: P(1, 1, 'gov'), type: '政府机构及社会团体;政府机关;乡镇级政府及事业单位' },
      { name: '马久邑', area: '大理', poi: P(1, 1, 'spot'), type: '风景名胜;风景名胜;风景名胜' },
    ], namesMatch)
    expect(r.places[0].poi.amapId).toBe('spot')
  })

  it('原文天数不超过这趟才记下原文分天（作偏好）；超了交给排程引擎分', async () => {
    expect((await resolveGuide(guide(3), 4, search, namesMatch)).places.map(p => p.prefDay)).toEqual([0, 1, 2])
    expect((await resolveGuide(guide(5), 3, search, namesMatch)).places.every(p => p.prefDay === undefined)).toBe(true)
    expect((await resolveGuide(guide(null), 3, search, namesMatch)).places.every(p => p.prefDay === undefined)).toBe(true)
  })
})
