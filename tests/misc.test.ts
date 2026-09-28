import { describe, expect, it } from 'vitest'
import { checkIn, tripProgress } from '@core/progress'
import { aggregate, blacklistHit, rankForParty, type Rating } from '@core/ratings'
import { cityOf, footprint, provinceOf } from '@core/footprint'
import { partyOnDay } from '@core/party'
import { adult, elder, kid, party, stop, trip } from './fixtures'

describe('进度', () => {
  const t = trip(party([adult()]), [
    [stop('sight', 60, { id: 'x1', priority: 1 }), stop('sight', 90, { id: 'x2', priority: 3 }), stop('sight', 60, { id: 'x3', priority: 2 }), stop('lodging', 0, { id: 'x4' })],
    [stop('sight', 60, { id: 'y1' })],
  ])

  it('未开始 / 已结束', () => {
    expect(tripProgress(t, new Date(2026, 8, 30, 10)).dayIndex).toBe(-1)
    expect(tripProgress(t, new Date(2026, 9, 5, 10)).dayIndex).toBe(2)
  })

  it('按时进行不给砍站建议', () => {
    const p = tripProgress(t, new Date(2026, 9, 1, 9, 10))
    expect(p).toMatchObject({ dayIndex: 0, behindMin: 10, suggestSkip: [] })
    expect(p.next?.id).toBe('x1')
  })

  it('落后一小时以上：先砍「可去」，必去不动', () => {
    const t2 = checkIn(t, 'x1', '10:30')
    const p = tripProgress(t2, new Date(2026, 9, 1, 11, 20))
    expect(p.next?.id).toBe('x2')
    expect(p.behindMin).toBe(90) // x1 晚到 90 分，大于已过 x2 计划时间的 80 分
    expect(p.suggestSkip.map(s => s.id)).toEqual(['x2'])
    expect(p.done).toBe(1)
  })

  it('跳过也算进度，不修改原行程', () => {
    const t2 = checkIn(t, 'x2', '10:00', 'skipped')
    expect(tripProgress(t2, new Date(2026, 9, 1, 9)).skipped).toBe(1)
    expect(t.days[0].stops[1].status).toBeUndefined()
  })
})

describe('红黑榜', () => {
  const r = (x: Partial<Rating>): Rating => ({ id: Math.random().toString(36), kind: 'food', name: '某饭店', city: '大理', verdict: 'red', by: 'a', at: 1, ...x })

  it('同一个地方合并，名字里的空格括号不影响对齐，多数意见为准', () => {
    const list = aggregate([r({}), r({ name: '某饭店 ', verdict: 'black', at: 5 }), r({ name: '某饭店（古城店）', verdict: 'black' })])
    expect(list.length).toBe(2)
    const main = list.find(v => v.name === '某饭店')!
    expect(main).toMatchObject({ red: 1, black: 1, verdict: 'mixed', latest: 5 })
  })

  it('高德 id 优先于名字', () => {
    const list = aggregate([r({ name: 'A', poi: { lng: 0, lat: 0, amapId: 'B0FF' } }), r({ name: 'A 店', poi: { lng: 0, lat: 0, amapId: 'B0FF' }, verdict: 'red' })])
    expect(list.length).toBe(1)
    expect(list[0].red).toBe(2)
  })

  it('带老人时，老人相关的排前面；其余先黑后红', () => {
    const list = aggregate([
      r({ name: '甲', verdict: 'red', at: 9 }),
      r({ name: '乙', verdict: 'black', at: 3 }),
      r({ name: '丙', verdict: 'black', fit: ['elder'], note: '全是台阶', at: 2 }),
    ])
    const ranked = rankForParty(list, partyOnDay(party([adult(), elder(70)]), 0))
    expect(ranked.map(v => v.name)).toEqual(['丙', '乙', '甲'])
    const noElder = rankForParty(list, partyOnDay(party([adult(), kid(5)]), 0))
    expect(noElder.map(v => v.name)).toEqual(['乙', '丙', '甲'])
  })

  it('行程点命中黑榜', () => {
    const list = aggregate([r({ verdict: 'black' })])
    expect(blacklistHit({ kind: 'food', name: '某饭店' }, '大理', list)?.black).toBe(1)
    expect(blacklistHit({ kind: 'sight', name: '某饭店' }, '大理', list)).toBeUndefined()
    expect(blacklistHit({ kind: 'drive', name: '某饭店' }, '大理', list)).toBeUndefined()
  })
})

describe('足迹', () => {
  it('行政区划码归省市，直辖市按省算', () => {
    expect(provinceOf('532901')).toBe('530000')
    expect(cityOf('532901')).toBe('532900')
    expect(cityOf('110105')).toBe('110000')
  })

  it('只算打过卡的；同一次旅程多个点算一次；记最早日期', () => {
    const p = party([adult()])
    const done = (adcode: string, name = adcode) => stop('sight', 60, { name, status: 'done', poi: { lng: 100, lat: 25, adcode } })
    const t1 = { ...trip(p, [[done('532901'), done('532922')], [done('530102'), stop('sight', 60, { poi: { lng: 1, lat: 1, adcode: '110105' } })]], '2026-05-01'), id: 'a' }
    const t2 = { ...trip(p, [[done('532901')]], '2025-02-03'), id: 'b' }
    const f = footprint([t1, t2])
    expect([...f.provinces.keys()]).toEqual(['530000'])
    expect(f.provinces.get('530000')).toEqual({ code: '530000', first: '2025-02-03', trips: 2 })
    expect(f.cities.get('532900')?.trips).toBe(2)
    expect(f.cities.get('530100')).toEqual({ code: '530100', first: '2026-05-02', trips: 1 })
    expect(f.points.length).toBe(4)
  })
})
