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
  /** 高德评分 0–5（周边搜索带 business 字段时才有） */
  rating?: number
  /** 离搜索中心的米数（周边搜索才有） */
  distanceM?: number
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
  INVALID_USER_IP: 'Key 设了 IP 白名单，这台设备的网络不在白名单里（浏览器直连时去掉白名单）',
  INVALID_USER_SIGNATURE: 'Key 开了数字签名，去控制台关掉签名校验',
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
      // Key 无效时说一下这台设备上填的有几位：Web服务 Key 是 32 位，少一位多一位一眼就能看出来
      const lenHint = j.info === 'INVALID_USER_KEY' ? `（这台设备上填的 Key 有 ${key.length} 位，「Web服务」Key 是 32 位的字母数字）` : ''
      throw new AmapError((ERRORS[j.info] ?? `高德返回错误：${j.info}`) + lenHint, j.info)
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
    const rating = Number(p.business?.rating)
    const distanceM = Number(p.distance)
    return {
      name: str(p.name), address: str(p.address), area, type: str(p.type), poi: { lng, lat, adcode: str(p.adcode) || undefined, amapId: str(p.id) || undefined },
      ...(Number.isFinite(rating) && str(p.business?.rating) ? { rating } : {}),
      ...(Number.isFinite(distanceM) && str(p.distance) ? { distanceM } : {}),
    }
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

/** 高德 POI 分类码：周边找吃饭、住处、服务区用 */
// 吃饭只找正餐：中餐厅 050100、外国餐厅 050200、快餐 050300；不要奶茶、咖啡、甜品（050500–050900，推荐午饭推出过蜜雪冰城）
// 下午空着就近补的景点：风景名胜 110000、博物馆 140100
export const AMAP_TYPES = { food: '050100|050200|050300', lodging: '100000', serviceArea: '180300', sight: '110000|140100' } as const

/** 周边搜索（v5 place/around）：按距离排，带评分。radius 单位米，高德上限 50 km */
export async function searchAround(center: Poi, key: string, opts: { types?: string; keywords?: string; radius?: number; fetchImpl?: typeof fetch } = {}): Promise<Place[]> {
  const j = await call('v5/place/around', {
    location: `${center.lng},${center.lat}`, types: opts.types ?? '', keywords: opts.keywords ?? '',
    radius: String(Math.min(50000, opts.radius ?? 3000)), sortrule: 'distance', page_size: '10', page_num: '1', show_fields: 'business',
  }, key, opts.fetchImpl ?? fetch)
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

/** 测一下 Key：搜一次「天安门」，能返回结果就算好用 */
export async function testAmapKey(key: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; msg: string }> {
  if (!key) return { ok: false, msg: '还没填' }
  if (!/^[0-9a-f]{32}$/i.test(key)) return { ok: false, msg: `格式不对：「Web服务」Key 是 32 位的字母数字，这里填的有 ${key.length} 位${/\s/.test(key) ? '，还带了空格' : ''}` }
  try { await searchPlaces('天安门', key, { fetchImpl }); return { ok: true } } catch (e) { return { ok: false, msg: e instanceof AmapError ? e.message : '连不上高德' } }
}
