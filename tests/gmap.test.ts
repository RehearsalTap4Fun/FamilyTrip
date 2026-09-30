import { describe, expect, it } from 'vitest'
// @ts-expect-error Worker 是纯 .js
import { decodePolyline, handle, NEARBY_TYPES, timedPoints } from '../worker/src/gmap.js'
import { inChina } from '../src/geo/inChina'
import { mapDrive, mapSearch } from '../src/geo/maps'
import { makePlanTools } from '../src/geo/planTools'

const env = { GOOGLE_KEY: 'gk', ACCESS_TOKEN: 'tok-123' }
const req = (op: string, body: unknown, token = 'tok-123') => new Request(`https://map.x/v1/${op}`, { method: 'POST', headers: { 'X-Trip-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const place = (name: string, lng: number, lat: number, extra = {}) => ({ id: 'g-' + name, displayName: { text: name }, formattedAddress: name + '地址', location: { longitude: lng, latitude: lat }, primaryType: 'tourist_attraction', addressComponents: [{ longText: '日本', shortText: 'JP', types: ['country'] }, { longText: '东京', shortText: '东京', types: ['locality'] }], ...extra })

function fakeGoogle() {
  const calls: { url: string; init: RequestInit }[] = []
  const f = async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    if (url.includes(':searchText')) return new Response(JSON.stringify({ places: [place('浅草寺', 139.7966, 35.7148)] }))
    if (url.includes(':searchNearby')) return new Response(JSON.stringify({ places: [place('一兰拉面', 139.797, 35.713, { rating: 4.3, primaryType: 'restaurant' })] }))
    if (url.includes('computeRoutes')) return new Response(JSON.stringify({ routes: [{ duration: '1260s', distanceMeters: 8400, polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' } }] }))
    if (url.includes('geocode')) return new Response(JSON.stringify({ status: 'OK', results: [{ address_components: [{ long_name: '日本', short_name: 'JP', types: ['country'] }, { long_name: '东京都', short_name: '东京都', types: ['administrative_area_level_1'] }, { long_name: '台东区', short_name: '台东区', types: ['locality'] }] }] }))
    return new Response('{}', { status: 404 })
  }
  return { f, calls }
}

describe('国外地图中转（Worker）', () => {
  it('口令不对 401；没配 Key 503；只认 POST 和那几个接口', async () => {
    const { f } = fakeGoogle()
    expect((await handle(req('search', { q: 'x' }, 'bad'), env, { fetch: f })).status).toBe(401)
    expect((await handle(req('search', { q: 'x' }), { ACCESS_TOKEN: 't' }, { fetch: f })).status).toBe(503)
    expect((await handle(new Request('https://map.x/v1/search'), env, { fetch: f })).status).toBe(405)
    expect((await handle(req('whatever', {}), env, { fetch: f })).status).toBe(404)
  })

  it('搜地名：Key 放在请求头、只要必要字段，返回和高德一样的 Place（带国家码）', async () => {
    const { f, calls } = fakeGoogle()
    const r = await (await handle(req('search', { q: '浅草寺' }), env, { fetch: f })).json()
    expect(r.places[0]).toMatchObject({ name: '浅草寺', area: '日本 东京', poi: { lng: 139.7966, lat: 35.7148, cc: 'JP' } })
    const h = calls[0].init.headers as Record<string, string>
    expect(h['X-Goog-Api-Key']).toBe('gk')
    expect(h['X-Goog-FieldMask']).not.toContain('rating') // 搜索不要评分，便宜一档
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ textQuery: '浅草寺', languageCode: 'zh-CN' })
  })

  it('周边：按类别换成 Google 类型，带评分和距离', async () => {
    const { f, calls } = fakeGoogle()
    const r = await (await handle(req('nearby', { at: { lng: 139.7966, lat: 35.7148 }, kind: 'food', radius: 2500 }), env, { fetch: f })).json()
    expect(r.places[0]).toMatchObject({ name: '一兰拉面', rating: 4.3 })
    expect(r.places[0].distanceM).toBeGreaterThan(0)
    const sent = JSON.parse(String(calls[0].init.body))
    expect(sent.includedTypes).toEqual(NEARBY_TYPES.food)
    expect(sent.excludedPrimaryTypes).toContain('shopping_mall') // 商场、酒店不算饭店
  })

  it('服务区：先找高速休息区，一个都没有再找加油站', async () => {
    const calls: string[] = []
    const f = async (_u: string, init: RequestInit) => { const b = JSON.parse(String(init.body)); calls.push(b.includedTypes.join()); return new Response(JSON.stringify({ places: b.includedTypes[0] === 'rest_stop' ? [] : [place('ENEOS', 138.95, 35.3)] })) }
    const r = await (await handle(req('nearby', { at: { lng: 138.95, lat: 35.3 }, kind: 'serviceArea', radius: 20000 }), env, { fetch: f })).json()
    expect(calls).toEqual(['rest_stop', 'gas_station'])
    expect(r.places[0].name).toBe('ENEOS')
  })

  it('车程、路线（折线解码、按距离摊时间）、所在城市', async () => {
    const { f } = fakeGoogle()
    expect(await (await handle(req('drive', { from: { lng: 139.79, lat: 35.71 }, to: { lng: 139.74, lat: 35.65 } }), env, { fetch: f })).json()).toEqual({ minutes: 21, km: 8.4 })
    const route = await (await handle(req('route', { from: { lng: 139.79, lat: 35.71 }, to: { lng: 139.74, lat: 35.65 } }), env, { fetch: f })).json()
    expect(route.minutes).toBe(21)
    expect(route.points[0].t).toBe(0)
    expect(route.points[route.points.length - 1].t).toBe(21)
    expect(await (await handle(req('region', { at: { lng: 139.79, lat: 35.71 } }), env, { fetch: f })).json()).toMatchObject({ cc: 'JP', country: '日本', city: '台东区' })
  })

  it('同样的请求走缓存，不再问 Google', async () => {
    const { f, calls } = fakeGoogle()
    const store = new Map<string, Response>()
    const cache = { match: async (r: Request) => store.get(r.url)?.clone(), put: async (r: Request, res: Response) => { store.set(r.url, res) } }
    await handle(req('search', { q: '浅草寺' }), env, { fetch: f, cache })
    const again = await (await handle(req('search', { q: '浅草寺' }), env, { fetch: f, cache })).json()
    expect(again.places[0].name).toBe('浅草寺')
    expect(calls).toHaveLength(1)
  })

  it('折线解码（Google 文档里的例子）', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([{ lng: -120.2, lat: 38.5 }, { lng: -120.95, lat: 40.7 }, { lng: -126.453, lat: 43.252 }])
    expect(timedPoints([], 10)).toEqual([])
  })
})

describe('国内高德、国外 Google', () => {
  it('在不在国内：含港澳台和边境一带；东京、首尔、曼谷、河内不算', () => {
    for (const [lng, lat] of [[104.07, 30.57], [121.56, 25.03], [114.17, 22.32], [113.54, 22.19], [100.16, 25.69], [87.6, 43.8], [126.6, 45.75]]) expect(inChina({ lng, lat })).toBe(true)
    for (const [lng, lat] of [[139.69, 35.69], [126.98, 37.57], [100.5, 13.75], [105.85, 21.03], [2.35, 48.86]]) expect(inChina({ lng, lat })).toBe(false)
    expect(inChina({ lng: 139.69, lat: 35.69, adcode: '110101' })).toBe(true)
    expect(inChina({ lng: 104, lat: 30, cc: 'JP' })).toBe(false)
  })

  const tokyo = { lng: 139.7966, lat: 35.7148 }, tokyo2 = { lng: 139.7454, lat: 35.6586 }, chengdu = { lng: 104.07, lat: 30.57 }, chengdu2 = { lng: 104.1, lat: 30.6 }
  const fakeBoth = () => {
    const seen: string[] = []
    const f = (async (url: string) => {
      seen.push(url.includes('amap') ? 'amap' : 'gmap')
      if (url.includes('restapi.amap.com')) {
        if (url.includes('direction')) return new Response(JSON.stringify({ status: '1', route: { paths: [{ duration: '1800', distance: '12000' }] } }))
        return new Response(JSON.stringify({ status: '1', pois: [{ name: '浅草寺(佛山)', location: '113.14,23.01', adcode: '440604', pname: '广东省', cityname: '佛山市', adname: '禅城区' }] }))
      }
      if (url.endsWith('/gmap/search')) return new Response(JSON.stringify({ places: [{ name: '浅草寺', address: '', area: '日本 东京', type: '', poi: { ...tokyo, cc: 'JP' } }, { name: '北京某店', address: '', area: '', type: '', poi: { lng: 116.4, lat: 39.9 } }] }))
      if (url.endsWith('/gmap/drive')) return new Response(JSON.stringify({ minutes: 21, km: 8.4 }))
      if (url.endsWith('/gmap/nearby')) return new Response(JSON.stringify({ places: [{ name: '一兰拉面', address: '', area: '', type: '', poi: tokyo, rating: 4.3 }] }))
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch
    return { f, seen }
  }

  it('搜地名：两边一起搜，Google 的只留国外的', async () => {
    const { f } = fakeBoth()
    const list = await mapSearch('浅草寺', { amap: 'ak', gmap: 'tok', apiBase: 'https://s/api', fetchImpl: f })
    // 名字完全对上的排最前
    expect(list.map(p => p.name)).toEqual(['浅草寺', '浅草寺(佛山)'])
  })

  it('车程：两头在国内问高德，有一头在国外问 Google；国外又没配就不算', async () => {
    const { f, seen } = fakeBoth()
    const k = { amap: 'ak', gmap: 'tok', apiBase: 'https://s/api', fetchImpl: f }
    expect((await mapDrive(chengdu, chengdu2, k))?.minutes).toBe(30)
    expect((await mapDrive(tokyo, tokyo2, k))?.minutes).toBe(21)
    expect(seen).toEqual(['amap', 'gmap'])
    expect(await mapDrive(tokyo, tokyo2, { amap: 'ak', fetchImpl: f })).toBeNull()
  })

  it('排程工具：国外的周边走 Google', async () => {
    const { f } = fakeBoth()
    const tools = makePlanTools({ amap: 'ak', gmap: 'tok', apiBase: 'https://s/api', fetchImpl: f }, [])
    expect((await tools.nearby!('food', tokyo)).map(p => p.name)).toEqual(['一兰拉面'])
  })
})
