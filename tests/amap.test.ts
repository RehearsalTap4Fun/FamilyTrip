import { describe, expect, it } from 'vitest'
import { AmapError, amapPacing, driveBetween, parsePlaces, searchPlaces } from '../src/geo/amap'

// 测试里不排队等待
amapPacing.gapMs = 0
amapPacing.backoffMs = 0
import { fillDrives } from '../src/geo/fillDrives'
import { seedTrip } from '../src/data/seed'

// v5 place/text 的真实返回形状（2026-09-28 用真实 Key 抓到的喜洲古镇），另加两条边界情况
const PLACE_JSON = { status: '1', info: 'OK', count: '100', pois: [
  { parent: '', address: '清真路130号', distance: '', pcode: '530000', adcode: '532901', pname: '云南省', cityname: '大理白族自治州', type: '风景名胜;风景名胜;风景名胜', typecode: '110200', adname: '大理市', citycode: '0872', name: '喜洲古镇', location: '100.131582,25.852950', id: 'B0FFH27SSH' },
  { parent: '', address: [], distance: '', pcode: '530000', adcode: '532901', pname: '云南省', cityname: '大理白族自治州', type: '餐饮服务', typecode: '050000', adname: '大理市', citycode: '0872', name: '喜洲粑粑', location: '100.140,25.850', id: 'B0FFG2' },
  { id: 'bad', name: '没坐标', address: [], location: [] },
] }
const mockFetch = (json: unknown, seen?: string[]) => (async (url: string) => { seen?.push(String(url)); return { json: async () => json } as Response }) as unknown as typeof fetch

describe('高德接口解析', () => {
  it('地点：空地址是 []，统一成空串；没有坐标的丢掉；省市区去重拼起来', async () => {
    const seen: string[] = []
    const r = await searchPlaces('喜洲', 'K', { city: '大理', fetchImpl: mockFetch(PLACE_JSON, seen) })
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ name: '喜洲古镇', address: '清真路130号', area: '云南省 大理白族自治州 大理市', poi: { lng: 100.131582, lat: 25.85295, adcode: '532901', amapId: 'B0FFH27SSH' } })
    expect(r[1].address).toBe('')
    // 必须走 v5：v3 的 base 模式不给 adcode
    expect(seen[0]).toContain('/v5/place/text')
    expect(seen[0]).toContain('region=%E5%A4%A7%E7%90%86')
    expect(parsePlaces({ pois: [] })).toEqual([])
  })

  it('驾车：秒换分钟、米换公里', async () => {
    const d = await driveBetween({ lng: 1, lat: 2 }, { lng: 3, lat: 4 }, 'K', mockFetch({ status: '1', route: { paths: [{ duration: '7830', distance: '172400' }] } }))
    expect(d).toEqual({ minutes: 131, km: 172.4 })
  })

  it('被限流就退避重试，重试几次还不行才报错', async () => {
    let n = 0
    const flaky = (async () => ({ json: async () => (++n < 3 ? { status: '0', info: 'CUQPS_HAS_EXCEEDED_THE_LIMIT' } : { status: '1', route: { paths: [{ duration: '600', distance: '1000' }] } }) })) as unknown as typeof fetch
    expect(await driveBetween({ lng: 1, lat: 2 }, { lng: 3, lat: 4 }, 'K', flaky)).toEqual({ minutes: 10, km: 1 })
    expect(n).toBe(3)
    const always = mockFetch({ status: '0', info: 'CUQPS_HAS_EXCEEDED_THE_LIMIT' })
    await expect(driveBetween({ lng: 1, lat: 2 }, { lng: 3, lat: 4 }, 'K', always)).rejects.toThrow('高德限流了')
  })

  it('错误说人话；没填 Key 不发请求', async () => {
    await expect(searchPlaces('x', 'K', { fetchImpl: mockFetch({ status: '0', info: 'USERKEY_PLAT_NOMATCH' }) })).rejects.toThrow('需要「Web服务」类型的 Key')
    const seen: string[] = []
    await expect(searchPlaces('x', '', { fetchImpl: mockFetch({}, seen) })).rejects.toBeInstanceOf(AmapError)
    expect(seen).toEqual([])
  })
})

describe('按高德补车程', () => {
  it('第 3 天：喜洲←前一晚客栈记在「开过来」；两段大丽高速按原比例分掉丽江的车程', async () => {
    const t = seedTrip()
    // 给洱源服务区去掉坐标，模拟服务区没定位：两段高速之间就只剩喜洲 → 入住束河客栈
    const asked: string[] = []
    const ask = async (a: { lng: number }, b: { lng: number }) => { asked.push(`${a.lng}->${b.lng}`); return { minutes: b.lng === 100.205 ? 200 : 33, km: 1 } }
    const t2 = { ...t, days: t.days.map((d, i) => (i === 2 ? { ...d, stops: d.stops.map(s => (s.name === '洱源服务区' ? { ...s, poi: undefined } : s)) } : d)) }
    const { trip, changes } = await fillDrives(t2, 2, ask)
    const d = trip.days[2].stops
    expect(d.find(s => s.name === '喜洲古镇')?.driveMin).toBe(35) // 33 取整到 5 分钟
    const drives = d.filter(s => s.kind === 'drive').map(s => s.durationMin)
    expect(drives).toEqual([145, 55]) // 200 按 130:50 分
    expect(d.find(s => s.name === '入住 束河客栈')?.driveMin).toBeUndefined()
    // 之后每一段也各问一次：黑龙潭、纳西腊排骨按 33 分钟取整成 35，回束河客栈那段模拟成 200
    expect(changes.map(c => `${c.name}:${c.to}`)).toEqual(['喜洲古镇:35', '大丽高速 G5611:145', '大丽高速 G5611:55', '黑龙潭公园:35', '纳西腊排骨:35', '束河客栈:200'])
    expect(asked).toHaveLength(5)
  })
})
