import { describe, expect, it } from 'vitest'
import { applyHighlights, buildHighlightsPrompt, HighlightsSchema, searchArea, searchPlayTips, type Highlights } from '../src/llm/highlights'
import { parseLooseJson } from '../src/llm/client'
import { carryHighlights } from '../src/ui/Highlights'
import { docToTrip, tripToDoc } from '../src/sync/tripDoc'
import { seedTrip } from '../src/data/seed'

const t = seedTrip()
const sightNames = t.days.flatMap(d => d.stops).filter(s => s.kind === 'sight').map(s => s.name)

describe('这趟的亮点', () => {
  it('提示词：要具体能照着做、别写空话、结合同行者；带上每天的行程和参考攻略', () => {
    const { system, user } = buildHighlightsPrompt(t, [{ title: '双廊看日落', url: 'https://x', site: 'Trip.com', content: '玉几岛' }])
    expect(system).toContain('不要写「风景优美」「值得一去」这种空话')
    expect(system).toContain('family')
    expect(system).toContain('不写具体钟点')
    expect(system).toContain('超出这群人限制的')
    expect(system).toContain('不凑条数')
    expect(system).toContain('必须是行程里排到了的地方')
    expect(user).toContain('76 岁老人')
    expect(user).toContain(`第 1 天：`)
    expect(user).toContain('[1] 双廊看日落')
  })

  const refs = [1, 2, 3].map(i => ({ title: `攻略${i}`, url: `https://x/${i}`, site: `站${i}`, content: sightNames.join('、') }))
  it('写回：按名字对上站点（全名或一个包含另一个）；只有两个字相同不算；清单外的不写', () => {
    const h: Highlights = {
      trip: [],
      stops: [
        { name: sightNames[0], how: '从东门进，先上城楼', when: '17:30 以后', tip: null, family: '推车走北门坡道' },
        { name: sightNames[1].slice(0, 2), how: '坐游船', when: null, tip: '提前一天预约', family: null },
        { name: '不存在的地方', how: '随便', when: null, tip: null, family: null },
        { name: sightNames[3].slice(0, 2) + '服务区', how: '在服务区吃饭', when: null, tip: null, family: null },
        { name: sightNames[2], how: '  ', when: null, tip: null, family: null },
      ],
    }
    const out = applyHighlights(t, h, refs)
    const stops = out.days.flatMap(d => d.stops)
    // 具体钟点写回时换成模糊时段
    expect(stops.find(s => s.name === sightNames[0])!.highlight).toEqual({ how: '从东门进，先上城楼', when: '傍晚', family: '推车走北门坡道' })
    expect(stops.find(s => s.name === sightNames[1])!.highlight).toEqual({ how: '坐游船', tip: '提前一天预约' })
    expect(stops.find(s => s.name === sightNames[2])!.highlight).toBeUndefined()
    expect(stops.find(s => s.name === sightNames[3])!.highlight).toBeUndefined()
  })

  it('整趟亮点不硬凑：对不上行程里的地方、没有网上出处的都不要，一个地方一条，按行程先后排，附出处', () => {
    const h: Highlights = {
      trip: [
        { text: '后面那个地方的亮点', stop: sightNames[3], refs: [2] },
        { text: '整趟的笼统话', stop: null, refs: [1] },
        { text: '没出处的', stop: sightNames[1], refs: [] },
        { text: '编号越界的', stop: sightNames[2], refs: [9] },
        { text: '清单外的', stop: '不存在的地方', refs: [1] },
        { text: '第一个地方的亮点', stop: sightNames[0], refs: [1, 3, 1] },
        { text: '第一个地方又一条', stop: sightNames[0], refs: [3] },
      ],
      stops: [],
    }
    const out = applyHighlights(t, h, refs)
    const stops = out.days.flatMap(d => d.stops)
    expect(out.highlights!.map(x => x.text)).toEqual(['第一个地方的亮点', '后面那个地方的亮点'])
    expect(out.highlights![0].stopId).toBe(stops.find(s => s.name === sightNames[0])!.id)
    expect(out.highlights![0].refs).toEqual([{ title: '攻略1', url: 'https://x/1', site: '站1' }, { title: '攻略3', url: 'https://x/3', site: '站3' }])
  })

  it('出处得说到这个地方：搜的就是它，或正文提到了它；别处的帖子不算', () => {
    const other = [{ title: '上海奉贤南桥', url: 'https://y', site: '头条', content: '贤城好玩', about: '别的地方' }]
    const out = applyHighlights(t, { trip: [{ text: 'x', stop: sightNames[0], refs: [1] }], stops: [] }, other)
    expect(out.highlights).toEqual([])
    const mine = [{ title: '攻略', url: 'https://z', site: '携程', content: '', about: sightNames[0] }]
    expect(applyHighlights(t, { trip: [{ text: 'x', stop: sightNames[0], refs: [1] }], stops: [] }, mine).highlights).toHaveLength(1)
  })

  it('搜的时候带上地名：区县优先，直辖市的区用城市名，名字里有了就不带', () => {
    expect(searchArea('南桥', { city: '成都市', district: '都江堰市' })).toBe('都江堰')
    expect(searchArea('都江堰景区', { city: '成都市', district: '都江堰市' })).toBe('')
    expect(searchArea('天坛', { city: '北京市', district: '东城区' })).toBe('北京')
    expect(searchArea('南桥', null)).toBe('')
  })

  it('没有网上攻略（没填智谱 Key）：提示词要求不写整趟亮点，写了也不收', () => {
    expect(buildHighlightsPrompt(t).system).toContain('trip 给 []')
    const out = applyHighlights(t, { trip: [{ text: '凭空写的', stop: sightNames[0], refs: [1] }], stops: [] }, [])
    expect(out.highlights).toEqual([])
  })

  it('次要字段漏写不让整次失败', () => {
    const got = parseLooseJson(JSON.stringify({ trip: [{ text: 'x' }], stops: [{ name: 'a', how: 'b' }] }), HighlightsSchema)
    expect(got.trip[0].stop).toBeNull()
    expect(got.trip[0].refs).toEqual([])
    expect(got.stops[0]).toMatchObject({ when: null, tip: null, family: null })
  })

  it('重新排程后站点换了：玩法按名字接过来，亮点指向新站点', () => {
    const withH = applyHighlights(t, { trip: [{ text: '看日落', stop: sightNames[0], refs: [1] }], stops: [{ name: sightNames[0], how: '上城楼', when: null, tip: null, family: null }] }, refs)
    const replanned = { ...t, days: t.days.map(d => ({ ...d, stops: d.stops.map(s => ({ ...s, id: s.id + '-new' })) })) }
    const out = carryHighlights(withH, replanned)
    const s = out.days.flatMap(d => d.stops).find(x => x.name === sightNames[0])!
    expect(s.highlight?.how).toBe('上城楼')
    expect(out.highlights![0].stopId).toBe(s.id)
    // 重排后这个地方不在行程里了：亮点也不要了
    const gone = { ...t, days: t.days.map(d => ({ ...d, stops: d.stops.filter(x => x.name !== sightNames[0]) })) }
    expect(carryHighlights(withH, gone).highlights ?? []).toEqual([])
  })

  it('跟着同步文档走：亮点、站点玩法往返不丢', () => {
    const withH = applyHighlights(t, { trip: [{ text: '看日落', stop: sightNames[0], refs: [1] }], stops: [{ name: sightNames[0], how: '上城楼', when: null, tip: null, family: null }] }, refs)
    const back = docToTrip(tripToDoc(withH, [], 1, 'x')).trip
    expect(back.highlights).toEqual(withH.highlights)
    expect(back.days.flatMap(d => d.stops).find(s => s.name === sightNames[0])!.highlight?.how).toBe('上城楼')
  })

  it('联网搜推荐：行程里排到的地方各搜一次（有上限，停留久的优先），摘要记下搜的是哪个地方', async () => {
    const qs: string[] = []
    const f = (async (_u: string, init: RequestInit) => { const b = JSON.parse(String(init.body)); qs.push(b.search_query); return { ok: true, status: 200, json: async () => ({ search_result: [{ title: b.search_query, link: 'https://hk.trip.com/' + qs.length, content: b.search_query }] }) } }) as unknown as typeof fetch
    const r = await searchPlayTips(t, 'k', 3, f)
    expect(qs).toHaveLength(3)
    expect(qs.every(q => q.endsWith('推荐 好评 怎么玩 攻略'))).toBe(true)
    expect(r.yuan).toBeCloseTo(0.15)
    expect(r.refs.every(x => sightNames.some(n => x.about && n.startsWith(x.about)))).toBe(true)
    const all = await searchPlayTips(t, 'k', 99, f)
    expect(all.refs.length).toBe(new Set(sightNames.map(n => n.replace(/（吃完接着逛）$/, ''))).size)
  })
})
