import { describe, expect, it } from 'vitest'
import { applyTweaks, buildTweakPrompt, type Tweaks } from '../src/llm/tweakPlan'
import { planTrip, type NearbyPlace } from '@core/planner'
import { estDriveMin, distanceKm } from '@core/geo'
import { carryParty, skeletonTrip } from '@core/trips'
import { scheduleDay } from '@core/schedule'
import { namesMatch } from '../src/geo/groundDay'
import { seedTrip } from '../src/data/seed'
import type { PlanPlace, Poi, Trip } from '@core/types'

const P = (lng: number, lat: number, id?: string): Poi => ({ lng, lat, adcode: '530000', ...(id ? { amapId: id } : {}) })
let n = 0
const newId = (p: string) => p + ++n
const family = carryParty(seedTrip().party, new Set([...seedTrip().party.members, ...seedTrip().party.pets].map(x => x.id)))
const base = (days: number, tweaks?: Trip['plan'] extends infer T ? any : never): Trip => {
  const t = skeletonTrip({ title: 't', startDate: '2026-11-01', days, mode: 'selfDrive', party: family, flow: 'places', styles: [] }, newId)
  return { ...t, plan: { ...t.plan!, tweaks } }
}
const place = (id: string, name: string, poi: Poi, extra: Partial<PlanPlace> = {}): PlanPlace => ({ id, name, kind: 'sight', poi, ...extra })
const tools = {
  drive: async (a: Poi, b: Poi) => estDriveMin(a, b),
  nearby: async (what: string, at: Poi): Promise<NearbyPlace[]> => (what === 'serviceArea' ? [] : [1, 2].map(k => ({ name: `${what}@${at.lng.toFixed(3)}-${k}`, poi: P(at.lng + 0.002 * k, at.lat), rating: 4 + k / 10 }))),
}
const places = [place('a', '大理古城', P(100.16, 25.69)), place('b', '崇圣寺三塔', P(100.148, 25.71)), place('c', '喜洲古镇', P(100.13, 25.85)), place('d', '双廊', P(100.19, 25.915))]

describe('排程引擎按天调整', () => {
  it('几点出发、排松一点（少排，下午不补）、晚饭在指定的地方附近', async () => {
    const ERHAI = P(100.25, 25.8)
    const plain = await planTrip(base(2), places, tools, { newId })
    const r = await planTrip(base(2, [{ day: 1, start: '10:30', lighter: true, dinnerNear: { name: '洱海公园', poi: ERHAI } }]), places, tools, { newId })
    expect(r.trip.days[1].startTime).toBe('10:30')
    expect(r.trip.days[0].startTime).toBe('09:00')
    const sightsOn = (t: Trip, d: number) => t.days[d].stops.filter(s => s.kind === 'sight')
    expect(sightsOn(r.trip, 1).some(s => s.suggested)).toBe(false) // 排松的那天不补点
    expect(sightsOn(r.trip, 1).reduce((a, s) => a + s.durationMin, 0)).toBeLessThanOrEqual(sightsOn(plain.trip, 1).reduce((a, s) => a + s.durationMin, 0))
    const dinner = scheduleDay(r.trip.days[1]).filter(s => s.stop.kind === 'food').slice(-1)[0].stop
    expect(distanceKm(dinner.poi!, ERHAI)).toBeLessThan(1)
    expect(dinner.why).toContain('洱海公园')
  })
})

describe('写一句要求再排', () => {
  it('提示词带上每天的安排和地点清单，要求没提到的不动', () => {
    const t = base(2)
    const { system, user } = buildTweakPrompt(t, places, '第二天晚点出发')
    expect(system).toContain('没提到的就不要动')
    expect(user).toContain('行程一共 2 天')
    expect(user).toContain('- 喜洲古镇（景点，没排进去）')
    expect(user).toContain('用户的要求：第二天晚点出发')
  })

  const tw = (x: Partial<Tweaks>): Tweaks => ({ understood: '好', startTimes: [], lighter: [], pins: [], drop: [], must: [], add: [], meals: [], unsupported: [], ...x })
  const find = async (name: string) => (name === '沙溪古镇' ? { name: '沙溪古镇', poi: P(99.85, 26.32, 'sx') } : name === '双廊' ? { name: '双廊古镇', poi: P(100.19, 25.915, 'sl') } : null)

  it('不去、必去、挪天（名字对得上就行）、新加（先在高德找）；做不到的如实列出', async () => {
    const a = await applyTweaks(tw({
      drop: ['三塔'], must: ['双廊'], pins: [{ place: '喜洲', day: 2 }, { place: '不存在', day: 1 }, { place: '大理古城', day: 9 }],
      add: [{ name: '沙溪古镇', city: '大理', kind: 'sight', day: 2 }, { name: '火星基地', city: '', kind: 'sight', day: null }],
      unsupported: ['换一辆车'],
    }), places, [], 2, find, newId, namesMatch)
    expect(a.places.map(p => p.name)).toEqual(['大理古城', '喜洲古镇', '双廊', '沙溪古镇'])
    expect(a.places.find(p => p.name === '双廊')!.must).toBe(true)
    expect(a.places.find(p => p.name === '喜洲古镇')!.day).toBe(1)
    expect(a.places.find(p => p.name === '沙溪古镇')).toMatchObject({ day: 1, must: true })
    expect(a.done).toEqual(['不去崇圣寺三塔', '双廊改成必去', '喜洲古镇放到第 2 天', '加上沙溪古镇（第 2 天）'])
    expect(a.skipped).toEqual(['做不到：换一辆车', '清单里没有「不存在」', '没有第 9 天', '高德里没找到「火星基地」'])
  })

  it('按天的调整和上次的叠加（同一天后说的覆盖）；时间看不懂的跳过；吃饭地点找不到照旧', async () => {
    const a = await applyTweaks(tw({
      startTimes: [{ day: 2, time: '9:30' }, { day: 1, time: '25:00' }], lighter: [1], meals: [{ day: 2, meal: 'dinner', near: '双廊' }, { day: 1, meal: 'lunch', near: '月球' }],
    }), places, [{ day: 1, start: '10:00', lighter: false }], 2, find, newId, namesMatch)
    expect(a.tweaks).toEqual([
      { day: 0, lighter: true },
      { day: 1, start: '09:30', lighter: false, dinnerNear: { name: '双廊古镇', poi: P(100.19, 25.915, 'sl') } },
    ])
    expect(a.skipped).toEqual(['第 1 天 25:00 出发看不懂', '高德里没找到「月球」，第 1 天午饭照旧'])
  })
})
