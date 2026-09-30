import { describe, expect, it } from 'vitest'
import { cleanLine, parseTransit } from '../src/geo/amap'
// @ts-expect-error Worker 是纯 .js
import { transitLeg } from '../worker/src/gmap.js'
import { planTrip, type Candidate, type PlanTools } from '../src/core/planner'
import { scheduleDay } from '../src/core/schedule'
import { legText, mapLink, stepText } from '../src/ui/Leg'
import type { Leg, Trip } from '../src/core/types'

describe('公共交通怎么坐', () => {
  it('高德换乘方案拆成步行、几号线从哪站到哪站', () => {
    const j = { route: { transits: [{ duration: '1980', segments: [
      { walking: { distance: '420', duration: '360' }, bus: { buslines: [{ name: '地铁2号线(积水潭--积水潭)', type: '地铁线路', duration: '720', via_num: '3', departure_stop: { name: '前门' }, arrival_stop: { name: '安定门' } }] } },
      { walking: { distance: '30', duration: '20' }, bus: { buslines: [{ name: '118路(永定门--北新桥)', type: '普通公交线路', duration: '600', via_num: '2', departure_stop: { name: '安定门' }, arrival_stop: { name: '雍和宫' } }] } },
      { walking: { distance: '200', duration: '180' }, bus: { buslines: [] } },
    ] }] } }
    const leg = parseTransit(j)!
    expect(leg.min).toBe(33)
    expect(leg.summary).toBe('地铁2号线 → 118路')
    expect(leg.steps!.map(stepText)).toEqual(['步行 6′', '地铁 地铁2号线：前门 → 安定门（4 站） 12′', '公交 118路：安定门 → 雍和宫（3 站） 10′', '步行 3′'])
    expect(parseTransit({ route: { transits: [] } })).toBeNull()
    expect(cleanLine('地铁1号线(八通线)(环球度假区--古城)')).toEqual({ line: '地铁1号线(八通线)', toward: '古城' })
  })

  it('Google 的公共交通路线：连着的走路并成一步，每坐一条线一步', () => {
    const leg = transitLeg({ duration: '1500s', legs: [{ steps: [
      { travelMode: 'WALK', staticDuration: '120s' }, { travelMode: 'WALK', staticDuration: '90s' },
      { travelMode: 'TRANSIT', staticDuration: '600s', transitDetails: { transitLine: { nameShort: '银座线', vehicle: { type: 'SUBWAY' } }, stopDetails: { departureStop: { name: '上野' }, arrivalStop: { name: '浅草' } }, stopCount: 3 } },
      { travelMode: 'WALK', staticDuration: '60s' },
    ] }] })
    expect(leg).toMatchObject({ by: 'transit', min: 25, summary: '银座线' })
    expect(leg.steps.map((s: Leg['steps'] extends (infer T)[] | undefined ? T : never) => s.by)).toEqual(['walk', 'subway'])
    expect(transitLeg(undefined)).toBeNull()
  })

  it('打开地图查换乘：国内开高德，国外开 Google 地图', () => {
    expect(mapLink({ lng: 116.39, lat: 39.9 }, { lng: 116.41, lat: 39.95 }, '雍和宫')).toContain('uri.amap.com/navigation')
    expect(mapLink({ lng: 139.79, lat: 35.71 }, { lng: 139.74, lat: 35.65 }, '东京塔')).toContain('travelmode=transit')
  })

  it('一句话怎么说', () => {
    expect(legText({ by: 'walk', min: 8, summary: '步行 8′' })).toBe('步行 8 分')
    expect(legText({ by: 'transit', min: 25, summary: '银座线' })).toBe('银座线 · 25 分')
    expect(legText({ by: 'taxi', min: 15, summary: '打车（坐公交要 70 分钟）' })).toBe('打车约 15 分（公交太绕）')
  })

  const P = (lng: number, lat: number) => ({ lng, lat })
  const hotel = P(116.397, 39.94)
  const base = (): Trip => ({ id: 't', title: 't', startDate: '2026-10-01', party: { members: [{ id: 'a', name: 'A', role: 'adult', driver: true }, { id: 'b', name: 'B', role: 'adult' }], pets: [], mode: 'transit' }, days: [{ stops: [] }] } as unknown as Trip)
  const cand = (name: string, poi: { lng: number; lat: number }): Candidate => ({ id: name, name, kind: 'sight', poi, durationMin: 90 })

  it('排程：一公里内走过去，远的按地图的换乘方案；公交比打车慢太多就写打车；没方案按估算并标「估」', async () => {
    const asked: string[] = []
    const tools: PlanTools = {
      drive: async () => 15,
      transit: async (_a, b) => {
        asked.push(`${b.lng}`)
        if (b.lng === 116.45) return { by: 'transit', min: 30, summary: '地铁2号线', steps: [{ by: 'walk', min: 5 }, { by: 'subway', min: 20, line: '地铁2号线' }, { by: 'walk', min: 5 }] }
        if (b.lng === 116.3) return { by: 'transit', min: 90, summary: '公交 1 路', steps: [{ by: 'bus', min: 90 }] }
        if (b.lng === 116.412) return { by: 'transit', min: 40, summary: '三趟公交', steps: [{ by: 'bus', min: 40 }] }
        return null
      },
      nearby: async () => [],
    }
    let n = 0
    const r = await planTrip(base(), [cand('近', P(116.401, 39.943)), cand('地铁', P(116.45, 39.94)), cand('绕', P(116.3, 39.94)), cand('没方案', P(116.36, 39.99)), cand('走比坐快', P(116.412, 39.945))], tools, { origin: hotel, newId: p => p + (++n) })
    const legs = new Map(scheduleDay(r.trip.days[0]).filter(s => s.stop.leg).map(s => [s.stop.name, s.stop.leg!]))
    expect(legs.get('近')?.by).toBe('walk')
    // 1.6 公里、公交要 40 分钟：走过去（约 31 分钟）不比坐车慢
    expect(legs.get('走比坐快')?.by).toBe('walk')
    expect(legs.get('地铁')).toMatchObject({ by: 'transit', summary: '地铁2号线' })
    expect(legs.get('绕')?.by).toBe('taxi')
    expect(legs.get('没方案')).toMatchObject({ by: 'transit', estimated: true })
    // 同一段路只问一次（排程过程中会反复算时间线）
    expect(asked.length).toBe(new Set(asked).size)
  })
})
