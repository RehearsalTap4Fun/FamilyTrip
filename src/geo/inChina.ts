// 这个坐标在不在国内（含港澳台）：国内用高德，国外用 Google。
// 按足迹页那张全国省界（src/data/china-map.json，和它同一个投影）做点在多边形内；
// 贴着国界、落在简化掉的小岛上的，离国界 15 公里内也算国内（高德在边境一带比 Google 准）。
import type { Poi } from '@core/types'
import map from '../data/china-map.json'
import { inRing, pathRings } from './pip'

const project = (lng: number, lat: number): [number, number] => [(lng * map.k - map.minX) * map.scale, (-lat - map.minY) * map.scale]
let rings: [number, number][][] | null = null
const all = () => (rings ??= map.provinces.flatMap(p => pathRings(p.d)))
// 1 度纬度 ≈ 111 公里，投影后 1 度 = scale 像素
const NEAR_PX = (15 / 111) * map.scale

export function inChina(p: Pick<Poi, 'lng' | 'lat' | 'adcode' | 'cc'>): boolean {
  if (p.adcode) return true
  if (p.cc) return p.cc === 'CN' || p.cc === 'HK' || p.cc === 'MO' || p.cc === 'TW'
  // 明显在外面的先排除（经度 73–136、纬度 3–54 之外）
  if (p.lng < 72 || p.lng > 136 || p.lat < 3 || p.lat > 54) return false
  const [x, y] = project(p.lng, p.lat)
  const rs = all()
  if (rs.some(r => inRing(x, y, r))) return true
  for (const r of rs) for (const [px, py] of r) if (Math.abs(px - x) < NEAR_PX && Math.abs(py - y) < NEAR_PX && Math.hypot(px - x, py - y) < NEAR_PX) return true
  return false
}
