import { describe, expect, it } from 'vitest'
import { backfillDay, checkIn, checkInPlanned, plannedStart, setArrival, tripProgress } from '@core/progress'
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

  it('打卡默认按计划时间记，不按点的那一刻；之后能改成实际到达时间', () => {
    // 第二站计划 10:00 开始（第一站 9:00 起玩 60 分）
    expect(plannedStart(t, 0, 'x2')).toBe('10:00')
    const t2 = checkInPlanned(checkInPlanned(t, 0, 'x1'), 0, 'x2')
    expect(t2.days[0].stops[1]).toMatchObject({ status: 'done', actualStart: '10:00' })
    // 10:30 才想起来把前两站补点上：按计划记，不会被当成晚到了（按点击时刻记，第一站就成了晚 90 分）
    expect(tripProgress(t2, new Date(2026, 9, 1, 10, 30)).behindMin).toBe(0)
    const t3 = setArrival(t2, 'x2', '10:40')
    expect(t3.days[0].stops[1].actualStart).toBe('10:40')
    expect(tripProgress(t3, new Date(2026, 9, 1, 11, 0)).behindMin).toBe(40)
    // 没打卡的站改不了到达时间；跳过不记时间
    expect(setArrival(t, 'x3', '11:00').days[0].stops[2].actualStart).toBeUndefined()
    expect(checkInPlanned(t, 0, 'x3', 'skipped').days[0].stops[2].actualStart).toBeUndefined()
    expect(() => setArrival(t2, 'x2', '25:99')).toThrow()
  })

  it('按计划补打卡：已打卡、已跳过的不动；看今天只补计划时间过了的，之前的日子整天补', () => {
    // 第一天：x1 9:00 打过卡、x2 跳过了（跳过的不占时间），x3 就是 10:00 开始、住处 11:00
    const t1 = checkIn(checkIn(t, 'x1', '09:20'), 'x2', '10:00', 'skipped')
    const today = backfillDay(t1, 0, 10 * 60 + 30)
    expect(today.ids).toEqual(['x3'])
    const st = today.trip.days[0].stops
    expect(st.map(s => [s.id, s.status, s.actualStart])).toEqual([['x1', 'done', '09:20'], ['x2', 'skipped', undefined], ['x3', 'done', '10:00'], ['x4', undefined, undefined]])
    const past = backfillDay(t1, 0)
    expect(past.ids).toEqual(['x3', 'x4'])
    expect(past.trip.days[0].stops[3]).toMatchObject({ status: 'done', actualStart: '11:00' })
    // 都打过了：什么也不补，原样返回
    expect(backfillDay(past.trip, 0)).toEqual({ trip: past.trip, ids: [] })
    expect(t.days[0].stops[2].status).toBeUndefined() // 不改原行程
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

describe('打卡时记红黑榜', () => {
  it('吃住玩能记，开车、回家不能；理由必须写', async () => {
    const { ratingFromStop, stopRatingKind, aggregate } = await import('@core/ratings')
    const o = { id: 'r1', at: 1, by: '我', tripId: 't1', city: '大理', fit: ['toddler' as const] }
    const sight = { kind: 'sight' as const, name: '喜洲古镇', poi: { lng: 100.13, lat: 25.85, amapId: 'B1' } }
    const r = ratingFromStop(sight, 'red', '  推车全程能走，粑粑好吃 ', o)
    expect(r).toMatchObject({ kind: 'sight', name: '喜洲古镇', verdict: 'red', note: '推车全程能走，粑粑好吃', city: '大理', tripId: 't1', fit: ['toddler'] })
    expect(ratingFromStop(sight, 'black', '   ', o)).toBeNull()
    expect(ratingFromStop({ kind: 'drive', name: '开车' }, 'black', '堵', o)).toBeNull()
    expect(ratingFromStop({ kind: 'lodging', name: '回到家', home: true }, 'red', '到家了', o)).toBeNull()
    expect(stopRatingKind({ kind: 'rest' })).toBe('sight')
    // 按高德 id 和别处记的同一个地方合并
    expect(aggregate([r!, { ...r!, id: 'r2', name: '喜洲古镇景区', note: '人少' }])).toHaveLength(1)
  })
})

describe('地图册「今天」页按景点分段上色', () => {
  it('开往景点的路算那一段；景点后没再开车前的吃饭算这一段；最后一段留住处', async () => {
    const { sightSegments } = await import('../src/ui/format')
    const k = (...ks: string[]) => ks.map(kind => ({ kind }))
    // 开车 → A → 午饭 → 开车 → 服务区 → 开车 → B → 晚饭 → 开车 → 住处
    expect(sightSegments(k('drive', 'sight', 'food', 'drive', 'rest', 'drive', 'sight', 'food', 'drive', 'lodging'))).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 1, 1])
    // 三个景点、中间不开车（同一片步行）：各自一段
    expect(sightSegments(k('sight', 'sight', 'food', 'sight', 'lodging'))).toEqual([0, 1, 1, 2, 2])
    // 一整天在路上：一段
    expect(sightSegments(k('drive', 'rest', 'drive', 'lodging'))).toEqual([0, 0, 0, 0])
  })
})
