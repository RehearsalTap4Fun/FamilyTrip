import { describe, expect, it } from 'vitest'
import { distanceKm, makeGrounder, namesMatch } from '../src/geo/groundDay'
import type { Place } from '../src/geo/amap'
import type { Poi, Trip } from '@core/types'
import { replanDay, type DayDraft } from '../src/llm/replanDay'
import { seedTrip } from '../src/data/seed'

const t = seedTrip()
const d3 = t.days[2]
const place = (name: string, lng: number, lat: number): Place => ({ name, address: '', area: '', type: '', poi: { lng, lat, adcode: '530700' } })

describe('按高德落地', () => {
  it('新站按名字定位；外地同名的不认；同名同段只问一次', async () => {
    const searched: string[] = []
    const g = makeGrounder({
      search: async name => {
        searched.push(name)
        if (name === '邓川服务区') return [place('邓川服务区', 100.1, 25.98)]
        if (name === '外地烤鱼') return [place('外地烤鱼', 116.4, 39.9)] // 北京
        return []
      },
      drive: async (a: Poi, b: Poi) => ({ minutes: Math.round(distanceKm(a, b) * 1.2), km: Math.round(distanceKm(a, b)) }),
    })
    const trip: Trip = { ...t, days: t.days.map((d, i) => i !== 2 ? d : { ...d, stops: [d.stops[0],
      { id: 'n1', kind: 'rest', name: '邓川服务区', durationMin: 20, status: 'planned' },
      { id: 'n2', kind: 'food', name: '外地烤鱼', durationMin: 60, status: 'planned' },
      ...d.stops.slice(1)] }) }
    const a = await g(trip, 2)
    expect(a.report.located).toEqual(['邓川服务区'])
    expect(a.report.unlocated).toEqual(['外地烤鱼'])
    expect(a.trip.days[2].stops.find(s => s.id === 'n1')?.poi?.lat).toBe(25.98)
    expect(a.report.legs.some(l => l.to === '邓川服务区')).toBe(true)
    const n = searched.length
    await g(trip, 2)
    expect(searched.length).toBe(n)
  })
})

describe('落地的防误认', () => {
  it('名字要对得上；顺路停的站不能绕远', async () => {
    expect(namesMatch('邓川服务区', '邓川服务区(大丽高速西行)')).toBe(true)
    expect(namesMatch('车上午睡', '上海路午后茶餐厅')).toBe(false)
    const g = makeGrounder({
      // 两个都叫「白沙服务区」：一个在路上，一个在 180 km 外
      search: async () => [place('白沙服务区', 101.6, 26.9), place('白沙服务区', 100.25, 26.95)],
      drive: async () => ({ minutes: 10, km: 5 }),
    })
    const base = t.days[3].stops.filter(s => s.poi)
    const a = base[0].poi!, b = base[base.length - 1].poi!
    const trip: Trip = { ...t, days: t.days.map((d, i) => i !== 3 ? d : { ...d, stops: [
      { id: 'a', kind: 'sight', name: 'A', durationMin: 30, status: 'planned', poi: a },
      { id: 'n', kind: 'rest', name: '白沙服务区', durationMin: 20, status: 'planned' },
      { id: 'b', kind: 'lodging', name: 'B', durationMin: 0, status: 'planned', poi: b }] }) }
    const r = await g(trip, 3)
    const got = r.trip.days[3].stops.find(s => s.id === 'n')!.poi!
    expect(distanceKm(a, got) + distanceKm(got, b) - distanceKm(a, b)).toBeLessThanOrEqual(25)
  })
})

describe('重排循环接上落地', () => {
  const echo = (): DayDraft => ({ summary: '原样', stops: d3.stops.map(s => ({ ref: s.id, kind: s.kind, name: s.name, durationMin: s.durationMin, driveMin: s.driveMin ?? null, start: s.start ?? null, priority: s.priority ?? 2, why: '' })) })

  it('每一版先落地再检查；修复提示里带上高德实测车程；交回落地报告', async () => {
    const prompts: string[] = []
    let calls = 0
    const caller = (async (_c: unknown, req: { user: string }) => { prompts.push(req.user); calls++; return { data: echo(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0 }, model: 'fake' } }) as never
    let grounded = 0
    const ground = (async (trip: Trip) => { grounded++; return { trip, report: { located: [], unlocated: ['洱海边车上午睡'], legs: [{ from: '喜洲古镇', to: '入住 束河客栈', minutes: 150, km: 160 }], changed: 1 } } }) as never
    const r = await replanDay({ provider: 'deepseek', apiKey: 'k' }, { trip: t, dayIndex: 2 }, { caller, ground })
    expect(grounded).toBe(calls)
    expect(prompts[1]).toContain('喜洲古镇 → 入住 束河客栈：开车 150 分（160 km）')
    expect(prompts[1]).toContain('换成能搜到的正式地名：洱海边车上午睡')
    expect(r.ground?.legs.length).toBe(1)
  })

  it('高德出错：不再落地，照样交回，并说明原因', async () => {
    const caller = (async () => ({ data: echo(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0 }, model: 'fake' })) as never
    let grounded = 0
    const ground = (async () => { grounded++; throw new Error('今天的高德调用次数用完了') }) as never
    const r = await replanDay({ provider: 'deepseek', apiKey: 'k' }, { trip: t, dayIndex: 2 }, { caller, ground })
    expect(grounded).toBe(1)
    expect(r.groundError).toBe('今天的高德调用次数用完了')
    expect(r.ground).toBeUndefined()
  })
})
