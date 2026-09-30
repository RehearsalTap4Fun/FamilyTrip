// 同路 · 国外地图中转（Cloudflare Worker）：app → 自家服务器 /trip/api/gmap/* → 这里 → Google 地图。
// Google Key 只放在这里（wrangler secret GOOGLE_KEY），app 和自家服务器都不经手；
// 请求要带访问口令（X-Trip-Token，与 wrangler secret ACCESS_TOKEN 一致），不然谁拿到地址都能花你的额度。
//
// 接口（都是 POST JSON，返回和 app 里高德那套同样形状的数据）：
//   /v1/search  { q, near?: {lng,lat} }                    → { places: Place[] }   地名搜索
//   /v1/nearby  { at: {lng,lat}, kind, radius }            → { places: Place[] }   周边：sight / food / lodging / serviceArea
//   /v1/drive   { from, to }                               → { minutes, km } | null
//   /v1/route   { from, to }                               → { minutes, points: [{lng,lat,t}] } | null   带沿途坐标
//   /v1/region  { at }                                     → { country, cc, city, district } | null
// 省钱：只要必要的字段（字段越少计费档越低）；同样的请求缓存（地点 7 天、路线 1 天）。
// 这个文件不依赖 Cloudflare 专有的东西，测试里直接调 handle()。

const PLACES = 'https://places.googleapis.com/v1/places'
const ROUTES = 'https://routes.googleapis.com/directions/v2:computeRoutes'
const GEOCODE = 'https://maps.googleapis.com/maps/api/geocode/json'

// 周边要评分（挑饭店、住处要看），搜索只要名字和位置
const SEARCH_FIELDS = 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.addressComponents'
const NEARBY_FIELDS = 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.rating,places.addressComponents'

/** 同路的周边类别 → Google 的地点类型 */
export const NEARBY_TYPES = {
  sight: ['tourist_attraction', 'museum', 'park', 'amusement_park', 'zoo', 'aquarium'],
  food: ['restaurant'],
  lodging: ['lodging'],
  // 先找高速休息区；一个都没有再退回加油站（实测只给加油站时全是 ENEOS 这类）
  serviceArea: ['rest_stop'],
}
/** 主类型不是这些的才要：「餐厅」里会混进带餐厅的商场、酒店（实测浅草周边第一个是东京晴空街道） */
const EXCLUDED_PRIMARY = {
  food: ['shopping_mall', 'department_store', 'lodging', 'hotel', 'tourist_attraction', 'market', 'supermarket', 'grocery_store'],
  sight: ['shopping_mall', 'department_store', 'lodging', 'hotel', 'restaurant'],
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })

/** 口令逐字比较，不因前几位对上就提前返回 */
function sameToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !b || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

const isPoint = p => p && Number.isFinite(p.lng) && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180

function cityOf(components = []) {
  const get = t => components.find(c => c.types?.includes(t))
  const country = get('country')
  const city = get('locality') ?? get('postal_town') ?? get('administrative_area_level_2') ?? get('administrative_area_level_1')
  const district = get('sublocality_level_1') ?? get('sublocality') ?? get('administrative_area_level_3')
  return { country: country?.longText ?? country?.long_name ?? '', cc: country?.shortText ?? country?.short_name ?? '', city: city?.longText ?? city?.long_name ?? '', district: district?.longText ?? district?.long_name ?? '' }
}

/** Google 的地点 → app 里的 Place（和高德那边同样的字段） */
export function toPlace(p, from) {
  const c = cityOf(p.addressComponents)
  const lng = p.location?.longitude, lat = p.location?.latitude
  const out = {
    name: p.displayName?.text ?? '', address: p.formattedAddress ?? '', area: [c.country, c.city].filter(Boolean).join(' '),
    type: p.primaryType ?? '', poi: { lng, lat, cc: c.cc || undefined, gid: p.id },
  }
  if (Number.isFinite(p.rating)) out.rating = p.rating
  if (from && Number.isFinite(lng)) out.distanceM = Math.round(haversineKm(from, { lng, lat }) * 1000)
  return out
}

function haversineKm(a, b) {
  const R = 6371, rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Google 编码折线 → 坐标 */
export function decodePolyline(s) {
  const pts = []
  let i = 0, lat = 0, lng = 0
  while (i < s.length) {
    for (const k of [0, 1]) {
      let shift = 0, result = 0, b
      do { b = s.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20 && i < s.length)
      const d = result & 1 ? ~(result >> 1) : result >> 1
      if (k === 0) lat += d; else lng += d
    }
    pts.push({ lng: lng / 1e5, lat: lat / 1e5 })
  }
  return pts
}

/** 路线坐标按距离摊时间（和高德那边一样：每个点带「开到这儿过了几分钟」），最多留 400 个点 */
export function timedPoints(pts, minutes) {
  if (!pts.length) return []
  const cum = [0]
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + haversineKm(pts[k - 1], pts[k]))
  const total = cum[cum.length - 1] || 1
  const step = Math.max(1, Math.ceil(pts.length / 400))
  const out = []
  for (let k = 0; k < pts.length; k += step) out.push({ ...pts[k], t: Math.round((cum[k] / total) * minutes * 10) / 10 })
  const last = pts[pts.length - 1]
  if (out[out.length - 1].lng !== last.lng || out[out.length - 1].lat !== last.lat) out.push({ ...last, t: minutes })
  return out
}

const seconds = d => Number(String(d ?? '').replace(/s$/, ''))

async function google(url, init, env, f) {
  const r = await f(url, init)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    const msg = j.error?.message ?? j.error_message ?? `HTTP ${r.status}`
    throw Object.assign(new Error('Google：' + msg), { status: r.status === 429 ? 429 : 502 })
  }
  return j
}

const post = (fields, key, body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fields }, body: JSON.stringify(body) })

export async function run(op, b, env, f = fetch) {
  const key = env.GOOGLE_KEY
  switch (op) {
    case 'search': {
      const q = String(b.q ?? '').trim().slice(0, 80)
      if (!q) throw Object.assign(new Error('缺 q'), { status: 400 })
      const body = { textQuery: q, languageCode: 'zh-CN', pageSize: 10 }
      if (isPoint(b.near)) body.locationBias = { circle: { center: { latitude: b.near.lat, longitude: b.near.lng }, radius: 50000 } }
      const j = await google(`${PLACES}:searchText`, post(SEARCH_FIELDS, key, body), env, f)
      return { places: (j.places ?? []).map(p => toPlace(p)).filter(p => Number.isFinite(p.poi.lng)) }
    }
    case 'nearby': {
      if (!isPoint(b.at) || !NEARBY_TYPES[b.kind]) throw Object.assign(new Error('缺 at 或 kind 不对'), { status: 400 })
      const radius = Math.max(100, Math.min(50000, Number(b.radius) || 3000))
      const ask = types => google(`${PLACES}:searchNearby`, post(NEARBY_FIELDS, key, {
        includedTypes: types, ...(EXCLUDED_PRIMARY[b.kind] ? { excludedPrimaryTypes: EXCLUDED_PRIMARY[b.kind] } : {}),
        maxResultCount: 20, rankPreference: b.kind === 'serviceArea' ? 'DISTANCE' : 'POPULARITY', languageCode: 'zh-CN',
        locationRestriction: { circle: { center: { latitude: b.at.lat, longitude: b.at.lng }, radius } },
      }), env, f)
      let j = await ask(NEARBY_TYPES[b.kind])
      if (b.kind === 'serviceArea' && !(j.places ?? []).length) j = await ask(['gas_station'])
      return { places: (j.places ?? []).map(p => toPlace(p, b.at)).filter(p => Number.isFinite(p.poi.lng)) }
    }
    case 'drive':
    case 'route': {
      if (!isPoint(b.from) || !isPoint(b.to)) throw Object.assign(new Error('缺 from / to'), { status: 400 })
      const wantPath = op === 'route'
      const body = { origin: { location: { latLng: { latitude: b.from.lat, longitude: b.from.lng } } }, destination: { location: { latLng: { latitude: b.to.lat, longitude: b.to.lng } } }, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', languageCode: 'zh-CN' }
      const j = await google(ROUTES, post(wantPath ? 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline' : 'routes.duration,routes.distanceMeters', key, body), env, f)
      const r = j.routes?.[0]
      if (!r) return null
      const minutes = Math.round(seconds(r.duration) / 60)
      if (!wantPath) return { minutes, km: Math.round(Number(r.distanceMeters ?? 0) / 100) / 10 }
      return { minutes, points: timedPoints(decodePolyline(r.polyline?.encodedPolyline ?? ''), minutes) }
    }
    case 'region': {
      if (!isPoint(b.at)) throw Object.assign(new Error('缺 at'), { status: 400 })
      const u = `${GEOCODE}?latlng=${b.at.lat},${b.at.lng}&language=zh-CN&result_type=locality|administrative_area_level_1|country&key=${encodeURIComponent(key)}`
      const j = await google(u, { method: 'GET' }, env, f)
      if (j.status && j.status !== 'OK') return j.status === 'ZERO_RESULTS' ? null : Promise.reject(Object.assign(new Error('Google：' + (j.error_message ?? j.status)), { status: 502 }))
      const comps = (j.results ?? []).flatMap(x => x.address_components ?? [])
      const c = cityOf(comps)
      return c.cc ? c : null
    }
    default:
      throw Object.assign(new Error('not found'), { status: 404 })
  }
}

const CACHE_VER = 'v2'
const TTL = { search: 7 * 86400, nearby: 7 * 86400, region: 30 * 86400, drive: 86400, route: 86400 }

/** cache：Cloudflare 的 caches.default；测试里传一个 Map 包装或不传 */
export async function handle(req, env, opts = {}) {
  const f = opts.fetch ?? fetch
  const url = new URL(req.url)
  const m = /^\/v1\/(search|nearby|drive|route|region)$/.exec(url.pathname)
  if (url.pathname === '/health') return json({ ok: true, key: !!env.GOOGLE_KEY, token: !!env.ACCESS_TOKEN })
  if (!m) return json({ error: 'not found' }, 404)
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!env.GOOGLE_KEY || !env.ACCESS_TOKEN) return json({ error: '中转还没配好 Key 或口令' }, 503)
  if (!sameToken(req.headers.get('X-Trip-Token') ?? '', env.ACCESS_TOKEN)) return json({ error: '访问口令不对' }, 401)
  const text = await req.text()
  if (text.length > 4096) return json({ error: 'too large' }, 413)
  let b
  try { b = JSON.parse(text) } catch { return json({ error: 'bad json' }, 400) }
  const op = m[1]
  // 缓存按「接口 + 请求体」：同一个地方、同一段路，一周内只问 Google 一次
  // 版本号：改了查询规则（字段、类型过滤）就加一，旧缓存自然作废
  const cacheKey = new Request(`https://cache.tonglu/${CACHE_VER}/${op}?${encodeURIComponent(stableKey(b))}`)
  const cache = opts.cache
  if (cache) { const hit = await cache.match(cacheKey); if (hit) return hit }
  try {
    const out = await run(op, b, env, f)
    const res = new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `max-age=${TTL[op]}` } })
    if (cache) await cache.put(cacheKey, res.clone())
    return res
  } catch (e) {
    return json({ error: e.message ?? 'failed' }, e.status ?? 500)
  }
}

/** 坐标只取到小数点后 4 位（约 10 米）再当缓存键：同一个地方稍微挪一点也能命中 */
function stableKey(b) {
  const round = v => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, round(v[k])])) : v)
  return JSON.stringify(round(b))
}

export default {
  async fetch(req, env, ctx) {
    return handle(req, env, { cache: caches.default })
  },
}
