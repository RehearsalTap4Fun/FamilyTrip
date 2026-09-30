// 地图统一入口：国内用高德，国外用 Google（经自家服务器转给 Cloudflare Worker）。按坐标在不在国内自动选。
// 界面和排程引擎都走这里，不直接调 amap.ts / gmap.ts。
import type { Poi } from '@core/types'
import { distanceKm } from '@core/geo'
import { AmapError, driveBetween, drivePath, regionAt, searchPlaces, type Drive, type Place, type RoutePath } from './amap'
import { gDrive, gRegion, gRoute, gSearch, type GmapOpts } from './gmap'
import { inChina } from './inChina'

/** 高德 Key、国外地图访问口令：都只存在这台设备上 */
export interface MapKeys { amap: string; gmap?: string; apiBase?: string; fetchImpl?: typeof fetch }

export const hasMaps = (k: MapKeys) => !!k.amap || !!k.gmap
const g = (k: MapKeys): GmapOpts => ({ token: k.gmap!, apiBase: k.apiBase, fetchImpl: k.fetchImpl })

/**
 * 搜地名：两边都有就一起搜——高德的全要，Google 的只要国外的（国内的 Google 数据差、坐标系也不一样）；
 * 只有一边就用那一边。一边出错不耽误另一边
 */
export async function mapSearch(q: string, k: MapKeys, opts: { city?: string; near?: Poi } = {}): Promise<Place[]> {
  const tasks: Promise<Place[]>[] = []
  if (k.amap) tasks.push(searchPlaces(q, k.amap, { city: opts.city, fetchImpl: k.fetchImpl }))
  if (k.gmap) tasks.push(gSearch(q, g(k), opts.near && !inChina(opts.near) ? opts.near : undefined).then(list => list.filter(p => !inChina(p.poi))))
  if (!tasks.length) return []
  const got = await Promise.allSettled(tasks)
  const ok = got.filter((x): x is PromiseFulfilledResult<Place[]> => x.status === 'fulfilled')
  if (!ok.length) throw (got[0] as PromiseRejectedResult).reason
  const out: Place[] = []
  for (const p of ok.flatMap(x => x.value)) if (!out.some(o => o.name === p.name && distanceKm(o.poi, p.poi) < 0.3)) out.push(p)
  // 名字对得上的排前面：搜「浅草寺」时高德给的佛山「浅草堂」别压在东京浅草寺上面（同档里保持原来的先后）
  const norm = (x: string) => x.replace(/[\s·()（）]/g, '').toLowerCase()
  const qq = norm(q)
  const rank = (p: Place) => { const n = norm(p.name); return n === qq ? 0 : n.startsWith(qq) ? 1 : n.includes(qq) ? 2 : 3 }
  return out.map((p, i) => ({ p, i, r: rank(p) })).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.p)
}

/** 两头都在国内用高德；有一头在国外用 Google（没配就算不了，返回 null，排程按直线估） */
export async function mapDrive(a: Poi, b: Poi, k: MapKeys): Promise<Drive | null> {
  if (inChina(a) && inChina(b)) return k.amap ? driveBetween(a, b, k.amap, k.fetchImpl) : null
  return k.gmap ? gDrive(a, b, g(k)) : null
}

export async function mapRoute(a: Poi, b: Poi, k: MapKeys): Promise<RoutePath | null> {
  if (inChina(a) && inChina(b)) return k.amap ? drivePath(a, b, k.amap, k.fetchImpl) : null
  return k.gmap ? gRoute(a, b, g(k)) : null
}

export interface MapRegion { city: string; district: string; country?: string; cc?: string }

/** 坐标在哪个城市、区县（国外还有国家） */
export async function mapRegion(at: Poi, k: MapKeys): Promise<MapRegion | null> {
  if (inChina(at)) return k.amap ? regionAt(at, k.amap, k.fetchImpl) : null
  return k.gmap ? gRegion(at, g(k)) : null
}

/** 国外、又没配国外地图：给一句能照着做的提示 */
export function noAbroad(): AmapError {
  return new AmapError('这是国外的地方：高德查不了，要在设置里填「国外地图访问口令」', 'NO_GMAP')
}
