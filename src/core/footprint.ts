// 历史足迹：把所有旅程里打过卡的点按国家、省、市归类。国内的按高德行政区划码归到省、市（有行政区划码就是中国）；
// 国外的没有行政区划码，按坐标落在哪个国家的边界里算（countryAt，由足迹页按世界地图给）。
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
  /** 国家和地区，按 ISO 两位码（中国是 CN） */
  countries: Map<string, Visit>
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

export function footprint(trips: Trip[], countryAt?: (lng: number, lat: number) => string | undefined): Footprint {
  const countries = new Map<string, Visit>()
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
    const seenN = new Set<string>()
    const seenP = new Set<string>()
    const seenC = new Set<string>()
    t.days.forEach((d, i) => {
      const date = addDays(t.startDate, i)
      for (const s of d.stops) {
        if (s.status !== 'done' || !s.poi) continue
        points.push({ lng: s.poi.lng, lat: s.poi.lat, name: s.name, tripId: t.id })
        const country = s.poi.adcode ? 'CN' : countryAt?.(s.poi.lng, s.poi.lat)
        if (country) bump(countries, country, date, seenN)
        if (!s.poi.adcode) continue
        bump(provinces, provinceOf(s.poi.adcode), date, seenP)
        bump(cities, cityOf(s.poi.adcode), date, seenC)
      }
    })
  }
  return { countries, provinces, cities, points }
}
