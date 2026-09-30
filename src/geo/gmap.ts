// 国外地图（Google）：经自家服务器 /trip/api/gmap/* 转给 Cloudflare Worker（worker/src/gmap.js），Worker 再问 Google。
// 访问口令存在这台设备上（设置里填），和高德 Key 一样不同步、不导出。返回的数据和高德那套同样形状。
import type { Leg, Poi } from '@core/types'
import { syncApi } from '../sync/client'
import { AmapError, type Drive, type Place, type RoutePath } from './amap'

/** 继承高德的错误类：界面上 `e instanceof AmapError` 显示原因的地方照样能显示 */
export class GmapError extends AmapError {
  constructor(message: string, public readonly status = 0) { super(message, 'GMAP_' + status) }
}

export interface GmapOpts { token: string; apiBase?: string; fetchImpl?: typeof fetch }
export type NearbyKind = 'sight' | 'food' | 'lodging' | 'serviceArea'
export interface Region { country: string; cc: string; city: string; district: string }

async function call<T>(op: string, body: unknown, o: GmapOpts): Promise<T> {
  const base = (o.apiBase ?? syncApi()).replace(/\/$/, '')
  let r: Response
  try {
    r = await (o.fetchImpl ?? fetch)(`${base}/gmap/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Trip-Token': o.token }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
  } catch (e) {
    throw new GmapError('连不上国外地图：' + (e instanceof Error && e.name === 'TimeoutError' ? '超时' : '网络不通'))
  }
  const j = await r.json().catch(() => ({})) as { error?: string }
  if (!r.ok) throw new GmapError(r.status === 401 ? '国外地图的访问口令不对（设置里核对一下）' : r.status === 503 ? '国外地图中转还没配好' : j.error ?? `国外地图出错（HTTP ${r.status}）`, r.status)
  return j as T
}

const pt = (p: Poi) => ({ lng: p.lng, lat: p.lat })

export const gSearch = async (q: string, o: GmapOpts, near?: Poi): Promise<Place[]> => (await call<{ places: Place[] }>('search', { q, ...(near ? { near: pt(near) } : {}) }, o)).places
export const gNearby = async (at: Poi, kind: NearbyKind, radius: number, o: GmapOpts): Promise<Place[]> => (await call<{ places: Place[] }>('nearby', { at: pt(at), kind, radius }, o)).places
export const gDrive = (from: Poi, to: Poi, o: GmapOpts): Promise<Drive | null> => call<Drive | null>('drive', { from: pt(from), to: pt(to) }, o)
export const gRoute = (from: Poi, to: Poi, o: GmapOpts): Promise<RoutePath | null> => call<RoutePath | null>('route', { from: pt(from), to: pt(to) }, o)
export const gTransit = (from: Poi, to: Poi, o: GmapOpts): Promise<Leg | null> => call<Leg | null>('transit', { from: pt(from), to: pt(to) }, o)
export const gRegion = (at: Poi, o: GmapOpts): Promise<Region | null> => call<Region | null>('region', { at: pt(at) }, o)

/** 设置里「测一下」：随便查一个地方（东京塔），通了就行 */
export async function testGmap(o: GmapOpts): Promise<{ ok: true } | { ok: false; msg: string }> {
  try { await gRegion({ lng: 139.7454, lat: 35.6586 }, o); return { ok: true } } catch (e) { return { ok: false, msg: e instanceof Error ? e.message : String(e) } }
}
