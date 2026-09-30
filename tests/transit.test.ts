import { describe, expect, it } from 'vitest'
import { cleanLine, parseTransit } from '../src/geo/amap'
// @ts-expect-error Worker 是纯 .js
import { transitLeg } from '../worker/src/gmap.js'
import { planTrip, type Candidate, type PlanTools } from '../src/core/planner'
import { scheduleDay } from '../src/core/schedule'
import { legText, mapLink, stepText } from '../src/ui/Leg'
import type { Leg, Trip } from '../src/core/types'

describe('公共交通怎么坐', () => {
  it('高德换乘方案拆成步行、几号线从哪站到哪站', () => {
    const j = { route: { transits: [{ duration: '1980', segments: [
      { walking: { distance: '420', duration: '360' }, bus: { buslines: [{ name: '地铁2号线(积水潭--积水潭)', type: '地铁线路', duration: '720', via_num: '3', departure_stop: { name: '前门' }, arrival_stop: { name: '安定门' } }] } },
      { walking: { distance: '30', duration: '20' }, bus: { buslines: [{ name: '118路(永定门--北新桥)', type: '普通公交线路', duration: '600', via_num: '2', departure_stop: { name: '安定门' }, arrival_stop: { name: '雍和宫' } }] } },
      { walking: { distance: '200', duration: '180' }, bus: { buslines: [] } },
    ] }] } }
    const leg = parseTransit(j)!
    expect(leg.min).toBe(33)
    expect(leg.summary).toBe('地铁2号线 → 118路')
    expect(leg.steps!.map(stepText)).toEqual(['步行 6′', '地铁 地铁2号线：前门 → 安定门（4 站） 12′', '公交 118路：安定门 → 雍和宫（3 站） 10′', '步行 3′'])
    expect(parseTransit({ route: { transits: [] } })).toBeNull()
    expect(cleanLine('地铁1号线(八通线)(环球度假区--古城)')).toEqual({ line: '地铁1号线(八通线)', toward: '古城' })
  })

  it('Google 的公共交通路线：连着的走路并成一步，每坐一条线一步', () => {
    const leg = transitLeg({ duration: '1500s', legs: [{ steps: [
      { travelMode: 'WALK', staticDuration: '120s' }, { travelMode: 'WALK', staticDuration: '90s' },
      { travelMode: 'TRANSIT', staticDuration: '600s', transitDetails: { transitLine: { nameShort: '银座线', vehicle: { type: 'SUBWAY' } }, stopDetails: { departureStop: { name: '上野' }, arrivalStop: { name: '浅草' } }, stopCount: 3 } },
      { travelMode: 'WALK', staticDuration: '60s' },
    ] }] })
    expect(leg).toMatchObject({ by: 'transit', min: 25, summary: '银座线' })
    expect(leg.steps.map((s: Leg['steps'] extends (infer T)[] | undefined ? T : never) => s.by)).toEqual(['walk', 'subway'])
    expect(transitLeg(undefined)).toBeNull()
  })

  it('打开地图查换乘：国内开高德，国外开 Google 地图', () => {
    expect(mapLink({ lng: 116.39, lat: 39.9 }, { lng: 116.41, lat: 39.95 }, '雍和宫')).toContain('uri.amap.com/navigation')
    expect(mapLink({ lng: 139.79, lat: 35.71 }, { lng: 139.74, lat: 35.65 }, '东京塔')).toContain('travelmode=transit')
  })

  it('一句话怎么说', () => {
    expect(legText({ by: 'walk', min: 8, summary: '步行 8′' })).toBe('步行 8 分')
    expect(legText({ by: 'transit', min: 25, summary: '银座线' })).toBe('银座线 · 25 分')
    expect(legText({ by: 'taxi', min: 15, summary: '打车（坐公交要 70 分钟）' })).toBe('打车约 15 分（坐公交要 70 分钟）')
    expect(legText({ by: 'taxi', min: 110, summary: '包车或租车（坐公交要 9.3 小时）' })).toBe('包车或租车约 110 分（坐公交要 9.3 小时）')
  })

  const P = (lng: number, lat: number) => ({ lng, lat })
  const hotel = P(116.397, 39.94)
  const base = (): Trip => ({ id: 't', title: 't', startDate: '2026-10-01', party: { members: [{ id: 'a', name: 'A', role: 'adult', driver: true }, { id: 'b', name: 'B', role: 'adult' }], pets: [], mode: 'transit' }, days: [{ stops: [] }] } as unknown as Trip)
  const cand = (name: string, poi: { lng: number; lat: number }): Candidate => ({ id: name, name, kind: 'sight', poi, durationMin: 60 })

  it('排程：方案里夹着走两个多小时的一段（洞爷湖到洞爷站），那段改打车，总时长跟着少', async () => {
    const tools: PlanTools = {
      drive: async () => 150,
      transit: async () => ({ by: 'transit', min: 240, summary: '北斗', steps: [{ by: 'walk', min: 131 }, { by: 'rail', min: 105, line: '北斗', tag: 'JR 特急' }, { by: 'walk', min: 4 }] }),
      nearby: async () => [],
    }
    let n = 0
    const r = await planTrip(base(), [cand('札幌', P(117.6, 39.94))], tools, { origin: hotel, newId: p => p + (++n) })
    const leg = r.trip.days[0].stops.find(s => s.name === '札幌')!.leg!
    expect(leg.steps!.map(x => x.tag ?? x.by)).toEqual(['打车', 'JR 特急', 'walk'])
    expect(leg.min).toBe(240 - 131 + 27)
    expect(leg.summary).toBe('打车 → 北斗')
  })

  it('排程：一公里内走过去，远的按地图的换乘方案；公交比打车慢太多就写打车；没方案按估算并标「估」', async () => {
    const asked: string[] = []
    const tools: PlanTools = {
      drive: async () => 15,
      transit: async (_a, b) => {
        asked.push(`${b.lng}`)
        if (b.lng === 116.45) return { by: 'transit', min: 30, summary: '地铁2号线', steps: [{ by: 'walk', min: 5 }, { by: 'subway', min: 20, line: '地铁2号线' }, { by: 'walk', min: 5 }] }
        if (b.lng === 116.3) return { by: 'transit', min: 90, summary: '公交 1 路', steps: [{ by: 'bus', min: 90 }] }
        // 没车的时候地图给「步行 273 分钟」
        if (b.lng === 116.5) return { by: 'transit', min: 273, summary: '步行 273′', steps: [{ by: 'walk', min: 273 }] }
        if (b.lng === 116.412) return { by: 'transit', min: 40, summary: '三趟公交', steps: [{ by: 'bus', min: 40 }] }
        return null
      },
      nearby: async () => [],
    }
    let n = 0
    const r = await planTrip(base(), [cand('近', P(116.401, 39.943)), cand('地铁', P(116.45, 39.94)), cand('绕', P(116.3, 39.94)), cand('没方案', P(116.36, 39.99)), cand('走比坐快', P(116.412, 39.945)), cand('只能走', P(116.5, 39.94))], tools, { origin: hotel, newId: p => p + (++n) })
    const legs = new Map(scheduleDay(r.trip.days[0]).filter(s => s.stop.leg).map(s => [s.stop.name, s.stop.leg!]))
    expect(legs.get('近')?.by).toBe('walk')
    // 1.6 公里、公交要 40 分钟：走过去（约 31 分钟）不比坐车慢
    expect(legs.get('走比坐快')?.by).toBe('walk')
    // 地图只给了走四个半小时：当成没车可坐，打车
    expect(legs.get('只能走')).toMatchObject({ by: 'taxi' })

    expect(legs.get('地铁')).toMatchObject({ by: 'transit', summary: '地铁2号线' })
    expect(legs.get('绕')?.by).toBe('taxi')
    expect(legs.get('没方案')).toMatchObject({ by: 'transit', estimated: true })
    // 同一段路只问一次（排程过程中会反复算时间线）
    expect(asked.length).toBe(new Set(asked).size)
  })
})

// @ts-expect-error Worker 是纯 .js
import { defaultStart, handle, inJapan, japanTag, navitimeLeg } from '../worker/src/gmap.js'

describe('日本的公交地铁：NAVITIME', () => {
  const sample = { items: [{ summary: { move: { time: 24, fare: { unit_0: 180, unit_48: 178 } } }, sections: [
    { type: 'point', name: 'start' },
    { type: 'move', move: 'walk', time: 4 },
    { type: 'point', name: '浅草' },
    { type: 'move', move: 'local_train', line_name: '東京メトロ銀座線', time: 5 },
    { type: 'point', name: '上野' },
    { type: 'move', move: 'walk', time: 1 },
    { type: 'point', name: '上野' },
    { type: 'move', move: 'local_train', line_name: 'JR山手線内回り', time: 10 },
    { type: 'point', name: '浜松町' },
    { type: 'move', move: 'walk', time: 3 }, { type: 'move', move: 'walk', time: 2 },
    { type: 'point', name: 'goal' },
  ] }] }

  it('站点和移动交替：认出地铁、JR、上下车站、IC 卡票价；连着的走路并成一步', () => {
    const leg = navitimeLeg(sample)
    expect(leg).toMatchObject({ by: 'transit', min: 24, summary: '東京メトロ銀座線 → JR山手線内回り', fare: { amount: 178, currency: 'JPY' } })
    expect(leg.steps).toEqual([
      { by: 'walk', min: 4 },
      { by: 'subway', min: 5, line: '東京メトロ銀座線', from: '浅草', to: '上野', tag: '地铁' },
      { by: 'rail', min: 10, line: 'JR山手線内回り', from: '上野', to: '浜松町', tag: 'JR' },
      { by: 'walk', min: 5 },
    ])
    expect(legText(leg)).toBe('東京メトロ銀座線 → JR山手線内回り · 24 分 · 178 日元')
    expect(navitimeLeg({ items: [] })).toBeNull()
  })

  it('日本的车种胶囊：新干线、JR 特急（线名里没 JR 看公司）、JR、地铁、私铁、高速巴士、公交、轮渡、缆车', () => {
    expect(japanTag('superexpress_train', '東北新幹線はやぶさ', 'JR東日本')).toBe('新干线')
    expect(japanTag('local_train', '北斗', 'JR北海道', '特急')).toBe('JR 特急')
    expect(japanTag('local_train', 'ＪＲ山手線内回り')).toBe('JR')
    expect(japanTag('local_train', '札幌市営南北線', '札幌市交通局')).toBe('地铁')
    expect(japanTag('local_train', '東京メトロ銀座線', '東京地下鉄')).toBe('地铁')
    expect(japanTag('rapid_train', '京急本線', '京浜急行電鉄')).toBe('私铁')
    expect(japanTag('limited_express', 'スカイライナー', '京成電鉄')).toBe('私铁特急')
    expect(japanTag('highway_bus', '高速おたる号')).toBe('高速巴士')
    expect(japanTag('bus', '都営バス')).toBe('公交')
    expect(japanTag('ferry', '東京湾フェリー')).toBe('轮渡')
    expect(japanTag('local_train', '函館山ロープウェイ')).toBe('缆车')
  })

  it('NAVITIME 出发时刻必填：没给按日本时间明天上午 10 点', () => {
    // 2026-09-30 20:00 北京时间 = 21:00 日本时间 → 明天是 10-01
    expect(defaultStart(Date.UTC(2026, 8, 30, 12, 0))).toBe('2026-10-01T10:00:00')
    // 日本时间已经过了半夜（北京时间 23:30 = 日本 00:30 的 10-01）→ 明天是 10-02
    expect(defaultStart(Date.UTC(2026, 8, 30, 15, 30))).toBe('2026-10-02T10:00:00')
  })

  it('在不在日本：东京、那霸、札幌算；首尔、釜山、台北、库页岛不算；给了国家码按国家码', () => {
    for (const [lng, lat] of [[139.7, 35.7], [127.68, 26.21], [141.35, 43.06], [130.4, 33.59]]) expect(inJapan({ lng, lat })).toBe(true)
    for (const [lng, lat] of [[126.98, 37.57], [129.07, 35.18], [121.56, 25.03], [142.7, 46.95]]) expect(inJapan({ lng, lat })).toBe(false)
    expect(inJapan({ lng: 139.7, lat: 35.7 }, 'KR')).toBe(false)
  })

  it('Worker：日本两头都在、配了 RAPIDAPI_KEY 就问 NAVITIME；没配、或不在日本就问 Google', async () => {
    const hits: string[] = []
    const f = async (url: string) => { hits.push(url.includes('navitime') ? 'navitime' : 'google'); return new Response(JSON.stringify(url.includes('navitime') ? sample : { routes: [] })) }
    const req = (body: unknown) => new Request('https://map.x/v1/transit', { method: 'POST', headers: { 'X-Trip-Token': 't' }, body: JSON.stringify(body) })
    const tokyo = { from: { lng: 139.7966, lat: 35.7148 }, to: { lng: 139.7454, lat: 35.6586 } }
    const r = await (await handle(req(tokyo), { GOOGLE_KEY: 'g', ACCESS_TOKEN: 't', RAPIDAPI_KEY: 'r' }, { fetch: f })).json()
    expect(r.summary).toBe('東京メトロ銀座線 → JR山手線内回り')
    await handle(req(tokyo), { GOOGLE_KEY: 'g', ACCESS_TOKEN: 't' }, { fetch: f })
    await handle(req({ from: { lng: 2.29, lat: 48.86 }, to: { lng: 2.34, lat: 48.86 } }), { GOOGLE_KEY: 'g', ACCESS_TOKEN: 't', RAPIDAPI_KEY: 'r' }, { fetch: f })
    expect(hits).toEqual(['navitime', 'google', 'google'])
  })
})
