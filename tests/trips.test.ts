import { describe, expect, it } from 'vitest'
import { addDays, carryParty, pickStyles, skeletonTrip, sortTrips, tripStatus } from '@core/trips'
import { currentTrip, defaultState, migrate, nowOf, restoreSamples, withTrip } from '../src/store/state'
import { seedTrip } from '../src/data/seed'
import type { Trip } from '@core/types'

const at = (d: string) => new Date(`${d}T12:00`)
const t = (id: string, startDate: string, n: number): Trip => ({ id, title: id, startDate, party: { mode: 'selfDrive', members: [], pets: [] }, days: Array.from({ length: n }, () => ({ stops: [] })) })

describe('多个行程：状态与排序', () => {
  it('按日期判断：出发前计划中、最后一天当天仍在进行、之后去过的', () => {
    const x = t('x', '2026-10-01', 5)
    expect(tripStatus(x, at('2026-09-30'))).toBe('planning')
    expect(tripStatus(x, at('2026-10-01'))).toBe('ongoing')
    expect(tripStatus(x, at('2026-10-05'))).toBe('ongoing')
    expect(tripStatus(x, at('2026-10-06'))).toBe('done')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
  })

  it('进行中在前；计划中由近到远；去过的由近到远', () => {
    const list = [t('old', '2024-02-01', 2), t('far', '2027-01-20', 3), t('now', '2026-09-27', 4), t('soon', '2026-10-01', 3), t('last', '2025-07-01', 3)]
    expect(sortTrips(list, at('2026-09-28')).map(x => x.id)).toEqual(['now', 'soon', 'far', 'last', 'old'])
  })
})

describe('新建行程', () => {
  it('玩法最多两个，再选挤掉最早的', () => {
    expect(pickStyles(['scenic', 'family'])).toEqual(['scenic', 'family'])
    expect(pickStyles(['scenic', 'family', 'food'])).toEqual(['family', 'food'])
  })

  it('沿用同行只留勾上的，清掉中途加入的天数；没有上一趟给一个「我」', () => {
    const p = seedTrip().party
    const keep = new Set([p.members[0].id, p.members[2].id])
    const c = carryParty({ ...p, members: p.members.map(m => ({ ...m, days: { from: 1, to: 2 } })) }, keep)
    expect(c.members.map(m => m.id)).toEqual([p.members[0].id, p.members[2].id])
    expect(c.members.every(m => m.days === undefined)).toBe(true)
    expect(c.pets).toEqual([])
    expect(carryParty(undefined, new Set()).members).toHaveLength(1)
  })

  it('空行程骨架：每天一个住处；地区作标题；跟团不记出发地；天数夹在 1–30', () => {
    let n = 0
    const id = (p: string) => p + ++n
    const party = carryParty(seedTrip().party, new Set(seedTrip().party.members.map(m => m.id)))
    const a = skeletonTrip({ title: '', startDate: '2026-11-01', days: 4, mode: 'tour', party, flow: 'region', styles: ['scenic', 'food', 'family'], region: ' 滇西北 ', origin: '昆明' }, id)
    expect(a.title).toBe('滇西北')
    expect(a.days).toHaveLength(4)
    expect(a.days.every(d => d.stops.length === 1 && d.stops[0].kind === 'lodging')).toBe(true)
    expect(a.party.mode).toBe('tour')
    expect(a.plan).toEqual({ flow: 'region', styles: ['scenic', 'food'], region: '滇西北', origin: undefined })
    const b = skeletonTrip({ title: '国庆', startDate: '2026-10-01', days: 99, mode: 'selfDrive', party, flow: 'places', styles: [], region: '忽略', origin: '昆明' }, id)
    expect(b.days).toHaveLength(30)
    expect(b.plan).toMatchObject({ flow: 'places', region: undefined, origin: '昆明' })
  })
})

describe('存档升级到多行程', () => {
  it('v1：示例和历史都变成行程，当前指向原来那趟，其余设置保留', () => {
    const trip = seedTrip()
    const v1 = { version: 1, trip, ratings: [{ id: 'r' }], demoNow: '2026-10-03T10:55', history: [t('h1', '2024-01-01', 1)], amapKey: 'k', theme: 'poster' }
    const s = migrate(v1)!
    expect(s.version).toBe(2)
    expect(s.trips.map(x => x.id)).toEqual([trip.id, 'h1'])
    expect(s.trips.every(x => x.sample)).toBe(true)
    expect(s.currentId).toBe(trip.id)
    expect(s.amapKey).toBe('k')
    expect(s.ratings).toHaveLength(1)
    expect(s.theme).toBeUndefined() // 已移除的风格回默认
    expect('trip' in s || 'history' in s).toBe(false)
  })

  it('当前行程找不到就指向第一个；认不出的存档返回 null', () => {
    const s = migrate({ ...defaultState(), currentId: 'nope' })!
    expect(s.currentId).toBe(s.trips[0].id)
    expect(migrate({ version: 9 })).toBeNull()
    expect(migrate(null)).toBeNull()
  })

  it('改当前行程、恢复示例不动自己建的、演示时间只对示例生效', () => {
    const s0 = defaultState()
    const mine = { ...t('mine', '2026-11-01', 2) }
    let s = { ...s0, trips: [...s0.trips, mine], currentId: 'mine' }
    s = withTrip(s, { ...mine, title: '改了' })
    expect(currentTrip(s).title).toBe('改了')
    expect(nowOf(s).getFullYear()).toBe(new Date().getFullYear()) // 自己的行程按真实时间
    const edited = withTrip(s, { ...s.trips[0], title: '乱改的示例' })
    const r = restoreSamples(edited)
    expect(r.trips.find(x => x.id === s0.trips[0].id)?.title).toBe(s0.trips[0].title)
    expect(r.trips.some(x => x.id === 'mine')).toBe(true)
    expect(r.currentId).toBe(s0.trips[0].id)
    expect(nowOf(r).getMonth()).toBe(9) // 示例按演示时间 10 月
  })
})

describe('新建后的空行程', () => {
  it('还没定的住处占位：住宿条件只作待核，不算留意', async () => {
    const { checkTrip } = await import('@core/validate')
    const party = carryParty(seedTrip().party, new Set([...seedTrip().party.members, ...seedTrip().party.pets].map(x => x.id)))
    let n = 0
    const s = skeletonTrip({ title: 'x', startDate: '2026-11-01', days: 3, mode: 'selfDrive', party, flow: 'places', styles: [] }, p => p + ++n)
    const issues = checkTrip(s)
    expect(issues.filter(i => i.code.startsWith('need:')).length).toBeGreaterThan(0)
    expect(issues.filter(i => i.level !== 'tip')).toEqual([])
    expect(issues.find(i => i.code.startsWith('need:'))?.message).toContain('还没定住处')
  })
})

describe('改天数', () => {
  it('加的天补在后面、带住处占位；减的从最后删，数出删了几站；排好没采用的作废', async () => {
    const { resizeDays, skeletonTrip, carryParty } = await import('@core/trips')
    let k = 0
    const id = (p: string) => p + ++k
    const t0 = skeletonTrip({ title: 't', startDate: '2026-11-01', days: 2, mode: 'selfDrive', party: carryParty(undefined, new Set()), flow: 'places', styles: [] }, id)
    const t = { ...t0, days: [t0.days[0], { ...t0.days[1], stops: [{ id: 'x', kind: 'sight' as const, name: '古城', durationMin: 60 }, ...t0.days[1].stops] }],
      plan: { ...t0.plan!, tweaks: [{ day: 1, lighter: true }], draft: { days: 2, result: { days: [], plan: t0.plan!, unplaced: [], extraDaysNeeded: 0, notes: [], at: '' }, recs: { region: '大理', wishes: '', at: '', data: {} } } } }
    const up = resizeDays(t, 4, id)
    expect(up.trip.days).toHaveLength(4)
    expect(up.trip.days[3].stops).toMatchObject([{ kind: 'lodging', name: '住处' }])
    expect(up.removedStops).toBe(0)
    expect(up.trip.plan!.draft).toMatchObject({ days: undefined, result: undefined, recs: { region: '大理' } })
    const down = resizeDays(t, 1, id)
    expect(down.trip.days).toHaveLength(1)
    expect(down.removedStops).toBe(1) // 删掉的那天有一个景点（住处占位不算）
    expect(down.trip.plan!.tweaks).toEqual([])
    expect(resizeDays(t, 0, id).trip.days).toHaveLength(1)
    expect(resizeDays(t, 2, id).trip).toBe(t)
  })
})
