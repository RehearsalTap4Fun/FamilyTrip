import { describe, expect, it } from 'vitest'
import { footprint } from '@core/footprint'
import type { Trip } from '@core/types'
import world from '../src/data/world-map.json'
import { makeCountryAt, worldProjector, type WorldMap } from '../src/ui/worldMath'

const W = world as WorldMap
const at = makeCountryAt(W)

describe('世界足迹', () => {
  it('坐标落在哪个国家：中国按 DataV 边界（含台湾），以太平洋为中心切开的格陵兰两边都认得', () => {
    expect(at(139.69, 35.69)).toBe('JP') // 东京
    expect(at(2.35, 48.86)).toBe('FR') // 巴黎
    expect(at(-74.0, 40.71)).toBe('US') // 纽约
    expect(at(151.21, -33.87)).toBe('AU') // 悉尼
    expect(at(104.07, 30.57)).toBe('CN') // 成都
    expect(at(121.56, 25.03)).toBe('CN') // 台北
    expect(at(93.0, 28.0)).toBe('CN') // 藏南
    expect(at(-51.7, 64.2)).toBe('GL') // 努克（切线以西）
    expect(at(-22.0, 72.0)).toBe('GL') // 格陵兰东部（切线以东）
    expect(at(-150.0, -30.0)).toBeUndefined() // 南太平洋
  })

  it('投影：中央经线 150°E，30°W 在最左边', () => {
    const p = worldProjector(W)
    expect(p(-30, 0)[0]).toBeCloseTo(0)
    expect(p(150, 0)[0]).toBeCloseTo(W.width / 2)
  })

  it('国家按旅程计次：国内的有行政区划码就是中国，国外的按坐标', () => {
    const day = (stops: Trip['days'][number]['stops']) => ({ stops })
    const done = (name: string, lng: number, lat: number, adcode?: string) => ({ id: name, kind: 'sight' as const, name, durationMin: 60, status: 'done' as const, poi: { lng, lat, adcode } })
    const trips = [
      { id: 't1', title: '日本', startDate: '2026-05-01', days: [day([done('浅草寺', 139.80, 35.71), done('大阪城', 135.53, 34.69)])] },
      { id: 't2', title: '成都', startDate: '2026-07-01', days: [day([done('宽窄巷子', 104.05, 30.66, '510105')])] },
      { id: 't3', title: '又去日本', startDate: '2026-03-01', days: [day([done('京都', 135.77, 35.01)])] },
    ] as unknown as Trip[]
    const fp = footprint(trips, at)
    expect(fp.countries.get('JP')).toMatchObject({ trips: 2, first: '2026-03-01' })
    expect(fp.countries.get('CN')).toMatchObject({ trips: 1 })
    expect(fp.provinces.size).toBe(1) // 国外的不进省
    expect(footprint(trips).countries.has('JP')).toBe(false) // 没给查询就只认国内
  })
})
