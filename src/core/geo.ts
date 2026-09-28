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
