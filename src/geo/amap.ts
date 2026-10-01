// 高德 Web 服务 API：地点搜索、驾车路线。浏览器直连（接口允许跨域），Key 由用户自己在设置里填。
// 小程序端走云函数转发，用同一套解析。
import type { Leg, LegStep, Poi } from '@core/types'

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
  /** 头图（高德收录的第一张照片，已换成 https） */
  photo?: string
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
  if (!key) throw new AmapError('还没有填高德 Key（在「同行」页右上角的设置里）', 'NO_KEY')
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

/** 高德的照片地址有的是 http：一律换成 https（页面是 https，http 的图会被拦） */
export const photoOf = (p: any): string | undefined => {
  const u = str(p?.photos?.[0]?.url)
  return u ? u.replace(/^http:\/\//, 'https://') : undefined
}

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
      ...(photoOf(p) ? { photo: photoOf(p) } : {}),
    }
  }).filter((p: Place) => Number.isFinite(p.poi.lng) && Number.isFinite(p.poi.lat))
}

/**
 * 用 v5 的关键字搜索：v3 的 extensions=base 不返回 adcode（2026-09-28 真实 Key 联调发现），
 * 没有 adcode 就归不了省市、进不了足迹；v3 的 extensions=all 有，但一条要返回几十个字段。
 */
export async function searchPlaces(keywords: string, key: string, opts: { city?: string; fetchImpl?: typeof fetch } = {}): Promise<Place[]> {
  const j = await call('v5/place/text', { keywords, region: opts.city ?? '', city_limit: 'false', page_size: '10', page_num: '1', show_fields: 'photos' }, key, opts.fetchImpl ?? fetch)
  return parsePlaces(j)
}

/** 高德 POI 分类码：周边找吃饭、住处、服务区用 */
// 吃饭只找正餐：中餐厅 050100、外国餐厅 050200、快餐 050300；不要奶茶、咖啡、甜品（050500–050900，推荐午饭推出过蜜雪冰城）
// 下午空着就近补的景点：风景名胜 110000、博物馆 140100
export const AMAP_TYPES = { food: '050100|050200|050300', lodging: '100000', serviceArea: '180300', sight: '110000|140100' } as const

/**
 * 一个城市里的景区，按高德的重要程度排（v5 place/text 只给分类不给关键字）。
 * 下午补景点用：周边搜索按距离排，大景区旁边最近的几十个全是园区里的小点，这里排在前面的是洱海公园、苍山这种
 */
export async function searchCitySights(adcode: string, key: string, fetchImpl: typeof fetch = fetch): Promise<Place[]> {
  const j = await call('v5/place/text', { types: AMAP_TYPES.sight, region: adcode.slice(0, 4) + '00', city_limit: 'true', page_size: '25', page_num: '1', show_fields: 'business,photos' }, key, fetchImpl)
  return parsePlaces(j)
}

/** 周边搜索（v5 place/around）：按距离排，带评分。radius 单位米，高德上限 50 km */
export async function searchAround(center: Poi, key: string, opts: { types?: string; keywords?: string; radius?: number; pageSize?: number; page?: number; fetchImpl?: typeof fetch } = {}): Promise<Place[]> {
  const j = await call('v5/place/around', {
    location: `${center.lng},${center.lat}`, types: opts.types ?? '', keywords: opts.keywords ?? '',
    radius: String(Math.min(50000, opts.radius ?? 3000)), sortrule: 'distance', page_size: String(opts.pageSize ?? 10), page_num: String(opts.page ?? 1), show_fields: 'business,photos',
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

/** 线路名去掉方向括号：「地铁1号线(八通线)(环球度假区--古城)」→ 线名「地铁1号线(八通线)」、开往「古城」 */
export function cleanLine(name: string): { line: string; toward?: string } {
  const m = /^(.*)\(([^()]*?)--([^()]*?)\)$/.exec(name.trim())
  return m ? { line: m[1].trim(), toward: m[3].trim() } : { line: name.trim() }
}

/**
 * 公交地铁换乘方案（v3/direction/transit/integrated，strategy 3 = 最少步行：带老人孩子，最快的那个常要走 40 分钟）：取高德推荐的第一个，按「步行 → 几号线从哪站到哪站 → 步行」拆开。
 * city 是起点所在城市（行政区划码），跨城时 cityd 是终点城市。搜不到方案返回 null
 */
export function parseTransit(j: any): Leg | null {
  const t = j.route?.transits?.[0]
  if (!t) return null
  const steps: LegStep[] = []
  for (const seg of t.segments ?? []) {
    const w = seg.walking
    if (w && Number(w.distance) > 50) steps.push({ by: 'walk', min: Math.max(1, Math.round(Number(w.duration) / 60)) })
    for (const b of (seg.bus?.buslines ?? []).slice(0, 1)) {
      const { line } = cleanLine(str(b.name))
      steps.push({ by: str(b.type).includes('地铁') ? 'subway' : 'bus', min: Math.max(1, Math.round(Number(b.duration) / 60)), line, from: str(b.departure_stop?.name), to: str(b.arrival_stop?.name), stops: Number(b.via_num ?? 0) + 1 })
    }
    const r = seg.railway
    if (r && str(r.name)) steps.push({ by: 'rail', min: Math.max(1, Math.round(Number(r.time ?? 0) / 60)), line: str(r.name), from: str(r.departure_stop?.name), to: str(r.arrival_stop?.name) })
  }
  const min = Math.round(Number(t.duration) / 60)
  return { by: 'transit', min, steps, summary: legSummary(steps) }
}

/** 一句话：「地铁2号线 → 公交 K18」；全程走路就是「步行 12′」 */
export function legSummary(steps: LegStep[]): string {
  const rides = steps.filter(s => s.by !== 'walk')
  if (!rides.length) return `步行 ${steps.reduce((a, s) => a + s.min, 0)}′`
  return rides.map(s => s.line ?? '').filter(Boolean).join(' → ')
}

export async function transitBetween(from: Poi, to: Poi, key: string, fetchImpl: typeof fetch = fetch): Promise<Leg | null> {
  const city = from.adcode ?? to.adcode
  if (!city) return null
  const j = await call('v3/direction/transit/integrated', { origin: `${from.lng},${from.lat}`, destination: `${to.lng},${to.lat}`, city, cityd: to.adcode ?? city, strategy: '3', nightflag: '0', extensions: 'base' }, key, fetchImpl)
  return parseTransit(j)
}

/** 一条真实路线：总用时，和沿途的点（每个点记着从起点开到这要几分钟） */
export interface RoutePath { minutes: number; points: { lng: number; lat: number; t: number }[] }

/**
 * 驾车路线带沿途坐标（extensions=all）：长途拆成几天时，按真实路线找「开到第 8 小时在哪」。
 * 每段（step）的用时按它的折线点数平均摊开
 */
export function parseRoute(j: any): RoutePath | null {
  const p = j.route?.paths?.[0]
  if (!p) return null
  const points: RoutePath['points'] = []
  let t = 0
  for (const st of p.steps ?? []) {
    const seg = String(st.polyline ?? '').split(';').filter(Boolean).map((x: string) => x.split(',').map(Number)).filter((x: number[]) => x.length === 2 && x.every(Number.isFinite))
    const dur = Number(st.duration) / 60 || 0
    seg.forEach(([lng, lat]: number[], i: number) => points.push({ lng, lat, t: t + (seg.length > 1 ? (dur * i) / (seg.length - 1) : 0) }))
    t += dur
  }
  return { minutes: Math.round(Number(p.duration) / 60), points }
}

export async function drivePath(from: Poi, to: Poi, key: string, fetchImpl: typeof fetch = fetch): Promise<RoutePath | null> {
  const j = await call('v3/direction/driving', { origin: `${from.lng},${from.lat}`, destination: `${to.lng},${to.lat}`, strategy: '0', extensions: 'all' }, key, fetchImpl)
  return parseRoute(j)
}

/** 测一下 Key：搜一次「天安门」，能返回结果就算好用 */
/** 坐标在哪个城市、区县（逆地理编码）：搜网上攻略时带上，免得「南桥」搜到上海奉贤的南桥 */
export async function regionAt(p: Poi, key: string, fetchImpl: typeof fetch = fetch): Promise<{ city: string; district: string } | null> {
  const j = await call('v3/geocode/regeo', { location: `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`, extensions: 'base' }, key, fetchImpl)
  const c = j.regeocode?.addressComponent
  if (!c) return null
  const city = str(c.city) || str(c.province)
  return { city, district: str(c.district) }
}

/** 按高德 POI id 查头图（v5/place/detail，一次最多 10 个）：已经排好的站补照片用。查不到的不在结果里 */
export async function photosById(ids: string[], key: string, fetchImpl: typeof fetch = fetch): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 10) {
    const j = await call('v5/place/detail', { id: ids.slice(i, i + 10).join('|'), show_fields: 'photos' }, key, fetchImpl)
    for (const p of j.pois ?? []) { const u = photoOf(p); if (u && str(p.id)) out.set(str(p.id), u) }
  }
  return out
}

/** 没有 POI id 的站（以前排的、手填的）：按名字在它坐标附近搜一次，名字对得上、离得不到 2 公里才认 */
export async function photoByName(name: string, at: Poi, key: string, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  const j = await call('v5/place/around', { keywords: name.replace(/（.*?）|\(.*?\)/g, '').slice(0, 20), location: `${at.lng},${at.lat}`, radius: '2000', sortrule: 'distance', page_size: '5', page_num: '1', show_fields: 'photos' }, key, fetchImpl)
  const core = name.replace(/（.*?）|\(.*?\)/g, '').replace(/\s/g, '')
  const hit = (j.pois ?? []).find((p: any) => { const n = str(p.name).replace(/\s/g, ''); return n.includes(core.slice(0, 4)) || core.includes(n.slice(0, 4)) })
  return hit ? photoOf(hit) : undefined
}

export async function testAmapKey(key: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; msg: string }> {
  if (!key) return { ok: false, msg: '还没填' }
  if (!/^[0-9a-f]{32}$/i.test(key)) return { ok: false, msg: `格式不对：「Web服务」Key 是 32 位的字母数字，这里填的有 ${key.length} 位${/\s/.test(key) ? '，还带了空格' : ''}` }
  try { await searchPlaces('天安门', key, { fetchImpl }); return { ok: true } } catch (e) { return { ok: false, msg: e instanceof AmapError ? e.message : '连不上高德' } }
}
