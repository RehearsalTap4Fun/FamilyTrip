// 历史足迹：把所有旅程里打过卡的点按高德行政区划码归到省、市。
import type { Trip } from './types'

/** 直辖市：省级码即市级码 */
const MUNICIPALITY = new Set(['11', '12', '31', '50'])

export function provinceOf(adcode: string): string {
  return adcode.slice(0, 2) + '0000'
}

export function cityOf(adcode: string): string {
  const p = adcode.slice(0, 2)
  if (MUNICIPALITY.has(p)) return p + '0000'
  return adcode.slice(0, 4) + '00'
}

export interface Visit {
  code: string
  /** 第一次去的日期 'YYYY-MM-DD' */
  first: string
  /** 去过的次数（按旅程计，同一次旅程去多个点算一次） */
  trips: number
}

export interface Footprint {
  provinces: Map<string, Visit>
  cities: Map<string, Visit>
  /** 有坐标的打卡点，画点用 */
  points: { lng: number; lat: number; name: string; tripId: string }[]
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(y, m - 1, d + n)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

export function footprint(trips: Trip[]): Footprint {
  const provinces = new Map<string, Visit>()
  const cities = new Map<string, Visit>()
  const points: Footprint['points'] = []

  const bump = (map: Map<string, Visit>, code: string, date: string, seen: Set<string>) => {
    const v = map.get(code)
    const firstTime = !seen.has(code)
    seen.add(code)
    if (!v) map.set(code, { code, first: date, trips: 1 })
    else {
      if (date < v.first) v.first = date
      if (firstTime) v.trips++
    }
  }

  for (const t of trips) {
    const seenP = new Set<string>()
    const seenC = new Set<string>()
    t.days.forEach((d, i) => {
      const date = addDays(t.startDate, i)
      for (const s of d.stops) {
        if (s.status !== 'done' || !s.poi) continue
        points.push({ lng: s.poi.lng, lat: s.poi.lat, name: s.name, tripId: t.id })
        if (!s.poi.adcode) continue
        bump(provinces, provinceOf(s.poi.adcode), date, seenP)
        bump(cities, cityOf(s.poi.adcode), date, seenC)
      }
    })
  }
  return { provinces, cities, points }
}
