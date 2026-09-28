import { describe, expect, it } from 'vitest'
import { planTrip, type Candidate, type NearbyPlace, type PlanTools } from '@core/planner'
import { estDriveMin, distanceKm } from '@core/geo'
import { carryParty, skeletonTrip } from '@core/trips'
import { checkDay } from '@core/validate'
import { scheduleDay, parseHM } from '@core/schedule'
import type { Poi, Trip } from '@core/types'
import { seedTrip } from '../src/data/seed'

const P = (lng: number, lat: number): Poi => ({ lng, lat, adcode: '530000' })
// 大理一片、丽江一片：相距约 150 km
const DALI = { 古城: P(100.160, 25.690), 三塔: P(100.148, 25.710), 喜洲: P(100.130, 25.850), 双廊: P(100.190, 25.915), 洱海公园: P(100.230, 25.610) }
const LIJIANG = { 古城: P(100.233, 26.873), 束河: P(100.205, 26.921), 黑龙潭: P(100.236, 26.884), 拉市海: P(100.120, 26.860) }
const HOTEL_DALI = P(100.165, 25.695)
const HOTEL_LJ = P(100.230, 26.878)

let n = 0
const newId = (p: string) => p + ++n
const family = carryParty(seedTrip().party, new Set([...seedTrip().party.members, ...seedTrip().party.pets].map(x => x.id)))
const base = (days: number, styles: Trip['plan'] extends infer T ? any : never = []): Trip =>
  skeletonTrip({ title: 't', startDate: '2026-11-01', days, mode: 'selfDrive', party: family, flow: 'places', styles }, newId)
const cand = (name: string, poi: Poi, extra: Partial<Candidate> = {}): Candidate => ({ id: name, name, kind: 'sight', poi, ...extra })

/** 假高德：车程按估算，周边给三家店（最近的评分低） */
const fake = (overrides: Partial<PlanTools> = {}): PlanTools => ({
  drive: async (a, b) => estDriveMin(a, b),
  nearby: async (what, at): Promise<NearbyPlace[]> => {
    const off = (k: number) => P(at.lng + 0.003 * k, at.lat + 0.002 * k)
    if (what === 'serviceArea') return [{ name: `服务区${at.lat.toFixed(2)}`, poi: at }]
    const tag = what === 'food' ? '饭馆' : what === 'sight' ? '景点' : '酒店'
    return [1, 2, 3].map(k => ({ name: `${tag}${at.lng.toFixed(3)}-${k}`, poi: off(k), rating: [3.9, 4.6, 4.2][k - 1] }))
  },
  ...overrides,
})

const allStops = (t: Trip) => t.days.flatMap(d => d.stops)

describe('排程引擎：大理 → 丽江三天', () => {
  const cands: Candidate[] = [
    cand('大理古城', DALI.古城), cand('崇圣寺三塔', DALI.三塔), cand('喜洲古镇', DALI.喜洲), cand('双廊', DALI.双廊, { must: true }),
    cand('丽江古城', LIJIANG.古城, { must: true }), cand('束河古镇', LIJIANG.束河), cand('黑龙潭', LIJIANG.黑龙潭), cand('拉市海', LIJIANG.拉市海),
    { id: 'h1', name: '大理的酒店', kind: 'lodging', poi: HOTEL_DALI, day: 0 },
    { id: 'h2', name: '丽江的酒店', kind: 'lodging', poi: HOTEL_LJ, day: 1 },
    { id: 'h3', name: '丽江的酒店', kind: 'lodging', poi: HOTEL_LJ, day: 2 },
  ]
  const run = () => planTrip(base(3), cands, fake(), { newId })

  it('按地理分天：第一天在大理；转场那天上午在大理、下午到丽江；最后一天在丽江；每晚住指定的酒店', async () => {
    const r = await run()
    const inDali = (name: string) => ['大理古城', '崇圣寺三塔', '喜洲古镇', '双廊'].includes(name)
    const sightsOn = (d: number) => r.trip.days[d].stops.filter(s => s.kind === 'sight').map(s => s.name)
    expect(sightsOn(0).length).toBeGreaterThan(0)
    expect(sightsOn(0).every(inDali)).toBe(true)
    expect(sightsOn(2).every(x => !inDali(x))).toBe(true)
    const d1 = sightsOn(1).map(inDali)
    expect(d1.indexOf(false) < 0 || d1.slice(d1.indexOf(false)).every(x => !x)).toBe(true) // 先大理后丽江，不来回
    expect(r.trip.days.map(d => d.stops.slice(-1)[0].name)).toEqual(['大理的酒店', '丽江的酒店', '丽江的酒店'])
    // 这家人（76 岁外婆）每天游玩 6 小时：放不下的点列出来，必去的都在
    const placed = r.trip.days.flatMap(d => d.stops).map(s => s.name)
    expect(placed).toContain('双廊')
    expect(placed).toContain('丽江古城')
    expect(r.unplaced.every(u => !u.candidate.must)).toBe(true)
  })

  it('每天都有午饭晚饭：附近评分最高的那家，或路上的服务区；两岁孩子的午睡不被占', async () => {
    const r = await run()
    for (const d of r.trip.days) {
      const foods = d.stops.filter(s => s.kind === 'food')
      expect(foods.length).toBeGreaterThanOrEqual(2)
      expect(foods.every(f => f.name.endsWith('-2') || f.name.startsWith('服务区') || f.name.includes('附近找'))).toBe(true)
      const [lunch, dinner] = scheduleDay(d).filter(s => s.stop.kind === 'food')
      expect(lunch.start).toBeGreaterThanOrEqual(parseHM('11:00'))
      expect(lunch.start).toBeLessThanOrEqual(parseHM('13:30'))
      expect(dinner.start).toBeGreaterThanOrEqual(parseHM('17:00'))
    }
    for (let i = 0; i < 3; i++) expect(checkDay(r.trip, i).map(x => x.code)).not.toContain('noNap')
    // 午睡不会把午饭挤到下午
    for (const d of r.trip.days) expect(scheduleDay(d).find(s => s.stop.kind === 'food')!.start).toBeLessThanOrEqual(parseHM('13:30'))
  })

  it('大理到丽江的长途按连续驾驶上限拆段，中间停服务区；规则层不再报连开', async () => {
    const r = await run()
    // 每一段连续开车都不超过这家人的 90 分钟；转场那天确实开了很久
    const legs = allStops(r.trip).map(s => (s.kind === 'drive' ? s.durationMin : s.driveMin ?? 0))
    expect(Math.max(...legs)).toBeLessThanOrEqual(90)
    expect(r.trip.days[1].stops.reduce((a, s) => a + (s.kind === 'drive' ? s.durationMin : s.driveMin ?? 0), 0)).toBeGreaterThan(150)
    expect(allStops(r.trip).some(s => s.name.startsWith('服务区'))).toBe(true)
    for (let i = 0; i < 3; i++) expect(checkDay(r.trip, i).map(x => x.code)).not.toContain('noDriveBreak')
  })

  it('推荐的住处、饭馆带「推荐」标记；推荐住处缺条件只作待核，指定的住处照常查', async () => {
    const r = await planTrip(base(1), [cand('大理古城', DALI.古城)], fake(), { newId })
    const [lodge] = r.trip.days[0].stops.slice(-1)
    expect(lodge.suggested).toBe(true)
    expect(r.trip.days[0].stops.filter(s => s.kind === 'food').every(f => f.suggested)).toBe(true)
    expect(r.issues.filter(i => i.code.startsWith('need:'))).toEqual([])
    const mine = await run()
    expect(mine.issues.some(i => i.code === 'need:petOk')).toBe(true) // 指定的「大理的酒店」没标能带宠物
  })

  it('排完没有「游玩超时」这类必改问题；进度提示有分天和逐天', async () => {
    const msgs: string[] = []
    const r = await planTrip(base(3), cands, fake({ onProgress: m => msgs.push(m) }), { newId })
    expect(r.issues.filter(i => i.code === 'activeTooLong')).toEqual([])
    // 晚饭「到饭点再吃」是最后才定的，不会跟后来插进去的午睡、服务区撞车
    expect(r.issues.filter(i => i.code === 'overlap')).toEqual([])
    expect(msgs[0]).toBe('分天')
    expect(msgs).toContain('排第 3/3 天')
  })
})

describe('排程引擎：放不下、固定时刻、红黑榜、没有高德', () => {
  it('午饭前就逛完、下午才开长途：拆成几段开车，中间停服务区歇', async () => {
    const r = await planTrip(base(1), [
      cand('大理古城', DALI.古城, { must: true, durationMin: 150 }), cand('丽江古城', LIJIANG.古城, { must: true, durationMin: 60 }),
      { id: 'h', name: '丽江的酒店', kind: 'lodging', poi: HOTEL_LJ, day: 0 },
    ], fake(), { newId, origin: HOTEL_DALI })
    const stops = r.trip.days[0].stops
    expect(stops.filter(s => s.kind === 'drive').length).toBeGreaterThanOrEqual(2)
    expect(stops.some(s => s.kind === 'rest' && s.name.startsWith('服务区'))).toBe(true)
    expect(checkDay(r.trip, 0).map(x => x.code)).not.toContain('noDriveBreak')
  })

  it('一天塞太多：先砍最费时的「想去」，必去的留下；只剩必去也放不下就建议加天', async () => {
    const many = Array.from({ length: 8 }, (_, i) => cand(`点${i}`, P(100.16 + i * 0.01, 25.69), { durationMin: 90 + i * 10, must: i < 2 }))
    const r = await planTrip(base(1), many, fake(), { newId })
    expect(r.unplaced.length).toBeGreaterThan(0)
    expect(r.unplaced.every(u => !u.candidate.must)).toBe(true)
    expect(r.unplaced[0].candidate.name).toBe('点7')
    expect(r.unplaced[0].reason).toContain('放不下')
    const mustOnly = Array.from({ length: 6 }, (_, i) => cand(`必${i}`, P(100.16 + i * 0.01, 25.69), { durationMin: 120, must: true }))
    const r2 = await planTrip(base(1), mustOnly, fake(), { newId })
    expect(r2.unplaced).toEqual([])
    expect(r2.extraDaysNeeded).toBeGreaterThanOrEqual(2)
  })

  it('指定了日子的点就在那天；固定时刻的点按时刻排', async () => {
    const r = await planTrip(base(2), [
      cand('A', DALI.古城), cand('B', DALI.三塔), cand('C', DALI.洱海公园, { day: 1 }), cand('D', DALI.喜洲, { start: '15:00' }),
    ], fake(), { newId })
    expect(r.trip.days[1].stops.some(s => s.name === 'C')).toBe(true)
    const dayOfD = r.trip.days.findIndex(d => d.stops.some(s => s.name === 'D'))
    const slot = scheduleDay(r.trip.days[dayOfD]).find(s => s.stop.name === 'D')!
    expect(slot.start).toBe(parseHM('15:00'))
    expect(slot.overlap).toBe(false)
  })

  it('「想在哪天」只是偏好：尽量照着排；某天的点被去掉、另一天挤不下时会挪到空着的那天', async () => {
    const r = await planTrip(base(3), [
      cand('丽江古城', LIJIANG.古城, { prefDay: 0 }), cand('束河古镇', LIJIANG.束河, { prefDay: 0 }),
      cand('喜洲古镇', DALI.喜洲, { prefDay: 2 }), cand('大理古城', DALI.古城, { prefDay: 2, durationMin: 120 }), cand('双廊', DALI.双廊, { prefDay: 2, durationMin: 120 }),
    ], fake(), { newId })
    const dayOf = (n: string) => r.trip.days.findIndex(d => d.stops.some(s => s.name === n))
    expect(r.unplaced).toEqual([])
    expect(dayOf('丽江古城')).toBe(0)
    expect(dayOf('束河古镇')).toBe(0)
    expect(r.trip.days[1].stops.some(s => s.kind === 'sight')).toBe(true) // 第 2 天不再空着
  })

  it('要去的地方里有这家店：按「想在哪天」放，而且不会再被当成附近推荐吃第二顿', async () => {
    const r = await planTrip(base(3), [
      cand('大理古城', DALI.古城, { prefDay: 0 }), cand('丽江古城', LIJIANG.古城, { prefDay: 2 }),
      { id: 'f', name: '饭馆100.163-2', kind: 'food', poi: P(100.163, 25.692), prefDay: 0 },
    ], fake(), { newId })
    const hits = r.trip.days.flatMap((d, i) => d.stops.filter(s => s.name === '饭馆100.163-2').map(() => i))
    expect(hits).toEqual([0])
  })

  it('黑榜不推荐，红榜优先', async () => {
    const r = await planTrip(base(1), [cand('大理古城', DALI.古城)], fake({
      verdictOf: p => (p.name.endsWith('-2') ? 'black' : p.name.endsWith('-1') ? 'red' : undefined),
    }), { newId })
    const foods = r.trip.days[0].stops.filter(s => s.kind === 'food')
    expect(foods.some(f => f.name.endsWith('-2'))).toBe(false)
    expect(foods.some(f => f.name.endsWith('-1'))).toBe(true)
  })

  it('没有高德：车程按直线估，吃饭住处放占位并说明', async () => {
    const r = await planTrip(base(1), [cand('大理古城', DALI.古城), cand('喜洲古镇', DALI.喜洲)], {}, { newId })
    expect(r.notes.join()).toContain('直线距离估算')
    expect(r.trip.days[0].stops.some(s => s.name === '午饭（附近找）')).toBe(true)
    expect(r.trip.days[0].stops.slice(-1)[0].name).toBe('住处')
    const xz = r.trip.days[0].stops.find(s => s.name === '喜洲古镇')!
    expect(xz.driveMin ?? 0).toBeGreaterThan(0)
  })

  it('玩法定节奏：健康有氧 08:00 出发，休闲度假 10:00、景点停得久', async () => {
    const a = await planTrip(base(1, ['active']), [cand('X', DALI.古城)], fake(), { newId })
    const b = await planTrip(base(1, ['resort']), [cand('X', DALI.古城)], fake(), { newId })
    expect(a.trip.days[0].startTime).toBe('08:00')
    expect(b.trip.days[0].startTime).toBe('10:00')
    expect(b.trip.days[0].stops.find(s => s.name === 'X')!.durationMin).toBe(150)
  })

  it('没给住处：在最后一站附近找；第二天还在附近就连住', async () => {
    const r = await planTrip(base(2), [cand('A', DALI.古城), cand('B', DALI.三塔)], fake(), { newId })
    const [n1, n2] = r.trip.days.map(d => d.stops.slice(-1)[0])
    expect(n1.name).toMatch(/^酒店/)
    expect(n2.name).toBe(n1.name)
  })

  it('方案里说是第 3 晚的住处：只住第 3 晚，不当整趟的大本营；AI 推荐的住处缺条件只作待核', async () => {
    const r = await planTrip(base(3), [cand('大理古城', DALI.古城, { prefDay: 0 }), cand('喜洲古镇', DALI.喜洲, { prefDay: 1 }), cand('丽江古城', LIJIANG.古城, { prefDay: 2 }),
      { id: 'h', name: '丽江的温泉酒店', kind: 'lodging', poi: HOTEL_LJ, prefDay: 2, suggested: true }], fake(), { newId })
    const nights = r.trip.days.map(d => d.stops.slice(-1)[0].name)
    expect(nights[2]).toBe('丽江的温泉酒店')
    expect(nights[0]).not.toBe('丽江的温泉酒店')
    expect(r.issues.filter(i => i.code.startsWith('need:'))).toEqual([])
  })

  it('只给了一处住处、没说哪晚：整趟都住那儿', async () => {
    const r = await planTrip(base(2), [cand('A', DALI.古城), cand('B', DALI.喜洲), { id: 'h', name: '大本营', kind: 'lodging', poi: HOTEL_DALI }], fake(), { newId })
    expect(r.trip.days.map(d => d.stops.slice(-1)[0].name)).toEqual(['大本营', '大本营'])
    expect(distanceKm(HOTEL_DALI, r.trip.days[1].stops.slice(-1)[0].poi!)).toBe(0)
  })
})

describe('下午别空着', () => {
  const idleAfterLunch = (t: Trip, d: number) => {
    const sl = scheduleDay(t.days[d])
    const li = sl.findIndex(x => x.stop.kind === 'food')
    let worst = 0
    for (let i = Math.max(1, li + 1); i < sl.length; i++) {
      // 午睡本身、以及午睡时段（12:30–14:30）里的空档不算空
      if (sl[i - 1].stop.tags?.includes('napOk')) continue
      worst = Math.max(worst, sl[i].departAt - Math.max(sl[i - 1].end, 14 * 60 + 30))
    }
    return worst
  }
  const active = (t: Trip, d: number) => t.days[d].stops.reduce((a, s) => a + (s.kind === 'sight' || s.kind === 'food' ? s.durationMin : 0), 0)

  it('两个景点不全挤在上午：午饭后还有一个；等饭点的空档拉长前一个景点；不超过每天游玩上限', async () => {
    const r = await planTrip(base(1), [cand('大理古城', DALI.古城), cand('崇圣寺三塔', DALI.三塔)], fake({ nearby: async (w, at) => (w === 'sight' ? [] : fake().nearby!(w, at)) }), { newId })
    const sl = scheduleDay(r.trip.days[0])
    const lunch = sl.find(x => x.stop.kind === 'food')!
    expect(sl.some(x => x.stop.kind === 'sight' && x.start > lunch.start)).toBe(true)
    expect(sl.filter(x => x.stop.kind === 'sight').some(x => x.stop.durationMin > 75)).toBe(true)
    expect(active(r.trip, 0)).toBeLessThanOrEqual(360)
    expect(checkDay(r.trip, 0).map(x => x.code)).not.toContain('overlap')
  })

  it('上午本来就不满：不把景点挪到下午（免得上午干等），下午就近补', async () => {
    const r = await planTrip(base(1), [cand('大理州博物馆', DALI.古城, { durationMin: 60 }), cand('大理古城', DALI.三塔, { durationMin: 90 })], fake(), { newId })
    const sl = scheduleDay(r.trip.days[0])
    const lunch = sl.find(x => x.stop.kind === 'food')!
    const mine = sl.filter(x => x.stop.kind === 'sight' && !x.stop.suggested)
    expect(mine.every(x => x.start < lunch.start)).toBe(true)
    // 上午没有长时间干等
    const beforeLunch = sl.slice(0, sl.indexOf(lunch) + 1)
    for (let i = 1; i < beforeLunch.length; i++) expect(beforeLunch[i].departAt - beforeLunch[i - 1].end).toBeLessThan(45)
    expect(sl.some(x => x.stop.suggested && x.stop.kind === 'sight' && x.start > lunch.start)).toBe(true)
  })

  it('上午两个长景点：不挪的话午饭拖过一点、挤掉午睡，那就挪一个到下午', async () => {
    const r = await planTrip(base(1), [cand('大理州博物馆', DALI.古城, { durationMin: 90 }), cand('大理古城', DALI.三塔, { durationMin: 120 })], fake(), { newId })
    const sl = scheduleDay(r.trip.days[0])
    const lunch = sl.find(x => x.stop.kind === 'food')!
    expect(lunch.start).toBeLessThanOrEqual(12 * 60 + 30)
    expect(sl.some(x => x.stop.kind === 'sight' && !x.stop.suggested && x.start > lunch.start)).toBe(true)
    expect(checkDay(r.trip, 0).map(x => x.code)).not.toContain('noNap')
  })

  it('自己给了时长的景点不去拉长', async () => {
    const r = await planTrip(base(1), [cand('大理古城', DALI.古城, { durationMin: 60 }), cand('崇圣寺三塔', DALI.三塔, { durationMin: 60 })], fake({ nearby: async (w, at) => (w === 'sight' ? [] : fake().nearby!(w, at)) }), { newId })
    expect(r.trip.days[0].stops.filter(s => s.kind === 'sight').map(s => s.durationMin)).toEqual([60, 60])
  })

  it('下午还空一大段：就近补一个景点（标成推荐），不跟晚饭撞', async () => {
    const r = await planTrip(base(1), [cand('大理古城', DALI.古城, { durationMin: 90 })], fake(), { newId })
    const added = r.trip.days[0].stops.filter(s => s.kind === 'sight' && s.suggested)
    expect(added.length).toBeGreaterThanOrEqual(1)
    expect(added[0].name).toMatch(/^景点/)
    expect(checkDay(r.trip, 0).map(x => x.code)).not.toContain('noNap') // 补的景点不占午睡
    expect(checkDay(r.trip, 0).map(x => x.code)).not.toContain('overlap')
    expect(idleAfterLunch(r.trip, 0)).toBeLessThan(120)
    expect(active(r.trip, 0)).toBeLessThanOrEqual(360)
  })
})

describe('粘贴一串地名', () => {
  it('按顿号、逗号、换行拆开，去掉序号和重复，太短的丢掉', async () => {
    const { splitNames } = await import('../src/ui/PlanSheet')
    expect(splitNames('1. 大理古城、双廊，喜洲古镇\n2) 丽江古城；束河古镇、双廊、A')).toEqual(['大理古城', '双廊', '喜洲古镇', '丽江古城', '束河古镇'])
  })
})
