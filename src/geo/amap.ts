// 高德 Web 服务 API：地点搜索、驾车路线。浏览器直连（接口允许跨域），Key 由用户自己在「同行」页填。
// 小程序端走云函数转发，用同一套解析。
import type { Poi } from '@core/types'

const BASE = 'https://restapi.amap.com'

export interface Place {
  name: string
  address: string
  /** 省 市 区，给用户认地方用 */
  area: string
  poi: Poi
  /** 高德分类，例如「风景名胜;公园广场;公园」 */
  type: string
}

export class AmapError extends Error {
  constructor(message: string, public readonly code: string) { super(message) }
}

const ERRORS: Record<string, string> = {
  INVALID_USER_KEY: '高德 Key 无效，检查一下是不是填错了',
  USERKEY_PLAT_NOMATCH: 'Key 的类型不对：需要「Web服务」类型的 Key',
  INVALID_USER_DOMAIN: 'Key 限制了域名，这个页面的地址不在白名单里',
  DAILY_QUERY_OVER_LIMIT: '今天的高德调用次数用完了',
  ACCESS_TOO_FREQUENT: '请求太频繁，等几秒再试',
  CUQPS_HAS_EXCEEDED_THE_LIMIT: '请求太快，高德限流了，等几秒再试',
  CKQPS_HAS_EXCEEDED_THE_LIMIT: '请求太快，高德限流了，等几秒再试',
  SERVICE_NOT_AVAILABLE: '高德服务暂时不可用',
}

/**
 * 个人 Key 的并发额度很低，补车程一口气问好几段会被限流（2026-09-28 真实 Key 联调时遇到）。
 * 所以所有请求排队、两次之间至少隔 gapMs；碰到限流就退避重试。测试里把间隔设成 0。
 */
export const amapPacing = { gapMs: 400, retries: 3, backoffMs: 900 }
const LIMITED = new Set(['CUQPS_HAS_EXCEEDED_THE_LIMIT', 'CKQPS_HAS_EXCEEDED_THE_LIMIT', 'ACCESS_TOO_FREQUENT'])
let lastAt = 0
let queue: Promise<unknown> = Promise.resolve()
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function once(url: string, f: typeof fetch): Promise<any> {
  const wait = lastAt + amapPacing.gapMs - Date.now()
  if (wait > 0) await sleep(wait)
  lastAt = Date.now()
  let res: Response
  try { res = await f(url) } catch { throw new AmapError('连不上高德，检查一下网络', 'NETWORK') }
  return res.json()
}

async function call(path: string, params: Record<string, string>, key: string, f: typeof fetch): Promise<any> {
  if (!key) throw new AmapError('还没有填高德 Key（在「同行」页最下面）', 'NO_KEY')
  const url = `${BASE}/${path}?${new URLSearchParams({ ...params, key, output: 'JSON' })}`
  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      const j = await once(url, f)
      if (j.status === '1') return j
      if (LIMITED.has(j.info) && attempt < amapPacing.retries) { await sleep(amapPacing.backoffMs * (attempt + 1)); continue }
      throw new AmapError(ERRORS[j.info] ?? `高德返回错误：${j.info}`, j.info)
    }
  }
  const p = queue.then(run, run)
  queue = p.catch(() => undefined)
  return p
}

/** 高德的空字段是 []，统一成字符串 */
const str = (v: unknown) => (typeof v === 'string' ? v : '')

export function parsePlaces(j: any): Place[] {
  return (j.pois ?? []).map((p: any) => {
    const [lng, lat] = str(p.location).split(',').map(Number)
    const area = [str(p.pname), str(p.cityname), str(p.adname)].filter((x, i, a) => x && a.indexOf(x) === i).join(' ')
    return { name: str(p.name), address: str(p.address), area, type: str(p.type), poi: { lng, lat, adcode: str(p.adcode) || undefined, amapId: str(p.id) || undefined } }
  }).filter((p: Place) => Number.isFinite(p.poi.lng) && Number.isFinite(p.poi.lat))
}

/**
 * 用 v5 的关键字搜索：v3 的 extensions=base 不返回 adcode（2026-09-28 真实 Key 联调发现），
 * 没有 adcode 就归不了省市、进不了足迹；v3 的 extensions=all 有，但一条要返回几十个字段。
 */
export async function searchPlaces(keywords: string, key: string, opts: { city?: string; fetchImpl?: typeof fetch } = {}): Promise<Place[]> {
  const j = await call('v5/place/text', { keywords, region: opts.city ?? '', city_limit: 'false', page_size: '10', page_num: '1' }, key, opts.fetchImpl ?? fetch)
  return parsePlaces(j)
}

export interface Drive { minutes: number; km: number }

export function parseDrive(j: any): Drive | null {
  const p = j.route?.paths?.[0]
  if (!p) return null
  return { minutes: Math.round(Number(p.duration) / 60), km: Math.round(Number(p.distance) / 100) / 10 }
}

export async function driveBetween(from: Poi, to: Poi, key: string, fetchImpl: typeof fetch = fetch): Promise<Drive | null> {
  const j = await call('v3/direction/driving', { origin: `${from.lng},${from.lat}`, destination: `${to.lng},${to.lat}`, strategy: '0', extensions: 'base' }, key, fetchImpl)
  return parseDrive(j)
}
