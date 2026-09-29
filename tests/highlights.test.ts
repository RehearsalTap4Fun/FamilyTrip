import { describe, expect, it } from 'vitest'
import { applyHighlights, buildHighlightsPrompt, HighlightsSchema, searchPlayTips, type Highlights } from '../src/llm/highlights'
import { parseLooseJson } from '../src/llm/client'
import { carryHighlights } from '../src/ui/Highlights'
import { docToTrip, tripToDoc } from '../src/sync/tripDoc'
import { namesMatch } from '../src/geo/groundDay'
import { seedTrip } from '../src/data/seed'

const t = seedTrip()
const sightNames = t.days.flatMap(d => d.stops).filter(s => s.kind === 'sight').map(s => s.name)

describe('这趟的亮点', () => {
  it('提示词：要具体能照着做、别写空话、结合同行者；带上每天的行程和参考攻略', () => {
    const { system, user } = buildHighlightsPrompt(t, [{ title: '双廊看日落', url: 'https://x', site: 'Trip.com', content: '玉几岛' }])
    expect(system).toContain('不要写「风景优美」「值得一去」这种空话')
    expect(system).toContain('family')
    expect(system).toContain('超出这群人限制的地方')
    expect(user).toContain('76 岁老人')
    expect(user).toContain(`第 1 天：`)
    expect(user).toContain('[1] 双廊看日落')
  })

  it('写回：按名字对上站点（全名或一个包含另一个）；只有两个字相同不算；清单外的不写；整趟亮点最多 5 条，能指向站点', () => {
    const h: Highlights = {
      trip: [...Array.from({ length: 6 }, (_, i) => ({ text: `亮点${i}`, stop: i === 0 ? sightNames[0] : null }))],
      stops: [
        { name: sightNames[0], how: '从东门进，先上城楼', when: '17:30 以后', tip: null, family: '推车走北门坡道' },
        { name: sightNames[1].slice(0, 2), how: '坐游船', when: null, tip: '提前一天预约', family: null },
        { name: '不存在的地方', how: '随便', when: null, tip: null, family: null },
        { name: sightNames[3].slice(0, 2) + '服务区', how: '在服务区吃饭', when: null, tip: null, family: null },
        { name: sightNames[2], how: '  ', when: null, tip: null, family: null },
      ],
    }
    const out = applyHighlights(t, h, namesMatch)
    const stops = out.days.flatMap(d => d.stops)
    expect(stops.find(s => s.name === sightNames[0])!.highlight).toEqual({ how: '从东门进，先上城楼', when: '17:30 以后', family: '推车走北门坡道' })
    expect(stops.find(s => s.name === sightNames[1])!.highlight).toEqual({ how: '坐游船', tip: '提前一天预约' })
    expect(stops.find(s => s.name === sightNames[2])!.highlight).toBeUndefined()
    expect(stops.find(s => s.name === sightNames[3])!.highlight).toBeUndefined()
    expect(out.highlights).toHaveLength(5)
    expect(out.highlights![0].stopId).toBe(stops.find(s => s.name === sightNames[0])!.id)
  })

  it('次要字段漏写不让整次失败', () => {
    const got = parseLooseJson(JSON.stringify({ trip: [{ text: 'x' }], stops: [{ name: 'a', how: 'b' }] }), HighlightsSchema)
    expect(got.trip[0].stop).toBeNull()
    expect(got.stops[0]).toMatchObject({ when: null, tip: null, family: null })
  })

  it('重新排程后站点换了：玩法按名字接过来，亮点指向新站点', () => {
    const withH = applyHighlights(t, { trip: [{ text: '看日落', stop: sightNames[0] }], stops: [{ name: sightNames[0], how: '上城楼', when: null, tip: null, family: null }] }, namesMatch)
    const replanned = { ...t, days: t.days.map(d => ({ ...d, stops: d.stops.map(s => ({ ...s, id: s.id + '-new' })) })) }
    const out = carryHighlights(withH, replanned)
    const s = out.days.flatMap(d => d.stops).find(x => x.name === sightNames[0])!
    expect(s.highlight?.how).toBe('上城楼')
    expect(out.highlights![0].stopId).toBe(s.id)
  })

  it('跟着同步文档走：亮点、站点玩法往返不丢', () => {
    const withH = applyHighlights(t, { trip: [{ text: '看日落', stop: null }], stops: [{ name: sightNames[0], how: '上城楼', when: null, tip: null, family: null }] }, namesMatch)
    const back = docToTrip(tripToDoc(withH, [], 1, 'x')).trip
    expect(back.highlights).toEqual([{ text: '看日落' }])
    expect(back.days.flatMap(d => d.stops).find(s => s.name === sightNames[0])!.highlight?.how).toBe('上城楼')
  })

  it('联网搜玩法：停留最久的三个景点各搜一次', async () => {
    const qs: string[] = []
    const f = (async (_u: string, init: RequestInit) => { const b = JSON.parse(String(init.body)); qs.push(b.search_query); return { ok: true, status: 200, json: async () => ({ search_result: [{ title: b.search_query, link: 'https://hk.trip.com/' + qs.length, content: b.search_query }] }) } }) as unknown as typeof fetch
    const r = await searchPlayTips(t, 'k', 3, f)
    expect(qs).toHaveLength(3)
    expect(qs.every(q => q.endsWith('怎么玩 攻略 亲子'))).toBe(true)
    expect(r.yuan).toBeCloseTo(0.15)
  })
})
