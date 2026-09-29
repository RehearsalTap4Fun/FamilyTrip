// 纯几何：两点直线距离、粗估车程。排程先用粗估决定顺序，再用高德真实车程落定。
import type { Poi } from './types'

export function distanceKm(a: Poi, b: Poi): number {
  const r = Math.PI / 180
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

/** 没有真实路线时的车程估计：直线 × 1.3 的路网系数、平均 50 km/h；很近的算 5 分钟 */
export function estDriveMin(a: Poi, b: Poi): number {
  const km = distanceKm(a, b)
  if (km < 0.3) return 0
  return Math.max(5, Math.round((km * 1.3) / 50 * 60))
}

/** 不自驾时，超过这个直线距离的一段算城际长途（高铁、飞机），不按汽车算 */
export const LONG_HAUL_KM = 150

/**
 * 城际长途粗估（跟团、公共交通的去程返程）：直线 800 公里内按高铁（路网系数 1.2、均速 200 km/h，加进出站 60 分），
 * 再远按飞机（均速 650 km/h，加值机候机和往返机场 180 分）。没查班次，只是估个量级
 */
export function longHaul(a: Poi, b: Poi): { by: 'rail' | 'flight'; min: number } {
  const km = distanceKm(a, b)
  if (km <= 800) return { by: 'rail', min: Math.round((km * 1.2) / 200 * 60 / 5) * 5 + 60 }
  return { by: 'flight', min: Math.round(km / 650 * 60 / 5) * 5 + 180 }
}

/** 这一段怎么走、要多久（粗估）：自驾、短途按车程；不自驾的长途按高铁或飞机 */
export function estLegMin(a: Poi, b: Poi, mode: 'selfDrive' | 'tour' | 'transit'): number {
  if (mode !== 'selfDrive' && distanceKm(a, b) > LONG_HAUL_KM) return longHaul(a, b).min
  const m = estDriveMin(a, b)
  return mode === 'transit' ? Math.round(m * 1.4) : m
}
