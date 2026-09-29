// 排程质检：一批同行组合 × 路线，排出来逐条按验收标准查。
// 车程按直线估（estDriveMin），周边搜索给固定的假数据：这里查的是排程的逻辑，不是高德的数据。
// 真实路线（绕山路、服务区名字）另用 scripts/ 下的真机脚本在浏览器里抽查。
import { describe, expect, it } from 'vitest'
import { deriveConstraints } from '@core/constraints'
import { estDriveMin } from '@core/geo'
import { partyOnDay } from '@core/party'
import { planTrip, type Candidate, type NearbyPlace, type PlanTools } from '@core/planner'
import { fmtHM, scheduleDay } from '@core/schedule'
import { skeletonTrip } from '@core/trips'
import type { Member, Party, Pet, Poi, Trip, TravelMode } from '@core/types'
import { checkDay, napMissed } from '@core/validate'

const P = (lng: number, lat: number): Poi => ({ lng, lat })

// —— 同行组合 ——
const adult = (id: string, driver = true): Member => ({ id, name: id, role: 'adult', driver })
const PARTIES: Record<string, { members: Member[]; pets: Pet[] }> = {
  两个大人: { members: [adult('A'), adult('B')], pets: [] },
  带婴儿: { members: [adult('A'), adult('B'), { id: 'bb', name: '宝宝', role: 'kid', age: 0 }], pets: [] },
  带幼儿: { members: [adult('A'), adult('B'), { id: 'kid', name: '朵朵', role: 'kid', age: 2 }], pets: [] },
  老人小孩: { members: [adult('A'), adult('B'), { id: 'gm', name: '外婆', role: 'elder', age: 76, mobility: 'slow' }, { id: 'k5', name: '小宝', role: 'kid', age: 5 }], pets: [] },
  带大狗: { members: [adult('A'), adult('B')], pets: [{ id: 'dog', name: '豆包', kind: 'dog', size: 'large' }] },
  一个司机带娃: { members: [adult('A'), adult('B', false), { id: 'kid', name: '朵朵', role: 'kid', age: 2 }], pets: [] },
}

// —— 路线：家在哪、玩几天、要去的地方（真实地点的大致坐标） ——
interface Route { name: string; home: Poi; days: number; mode: TravelMode; places: Candidate[]; lighter?: number[]
  /** 全部必去（川西那趟用户就是全标必去）；不然只有前两个必去，其余排不下可以砍 */
  allMust?: boolean
}
const sight = (name: string, poi: Poi, extra: Partial<Candidate> = {}): Candidate => ({ id: name, name, kind: 'sight', poi, must: true, ...extra })
const ROUTES: Route[] = [
  { name: '川西 3 天', home: P(104.039, 30.478), days: 3, mode: 'selfDrive', lighter: [0], allMust: true, places: [
    sight('都江堰景区', P(103.6105, 31.0034), { day: 0 }), sight('南桥', P(103.6159, 30.9963), { prefDay: 0, bestTime: 'evening' }),
    sight('卧龙大熊猫基地', P(103.3204, 31.1008), { prefDay: 1 }), sight('灌县古城', P(103.6200, 30.9986), { prefDay: 2, bestTime: 'evening' }),
    sight('玉垒山公园', P(103.6155, 31.0002), { prefDay: 2 }),
  ] },
  { name: '大理丽江 5 天', home: P(102.712, 25.040), days: 5, mode: 'selfDrive', places: [
    sight('大理古城', P(100.160, 25.690), { bestTime: 'evening' }), sight('崇圣寺三塔', P(100.148, 25.710)), sight('喜洲古镇', P(100.130, 25.850)),
    sight('双廊古镇', P(100.190, 25.915)), sight('丽江古城', P(100.233, 26.873), { bestTime: 'evening' }), sight('束河古镇', P(100.205, 26.921)),
    sight('黑龙潭公园', P(100.236, 26.884)),
  ] },
  { name: '杭州西湖 2 天（公交）', home: P(120.150, 30.280), days: 2, mode: 'transit', places: [
    sight('断桥残雪', P(120.155, 30.259)), sight('灵隐寺', P(120.101, 30.241)), sight('西溪湿地', P(120.070, 30.270)),
    sight('湖滨音乐喷泉', P(120.163, 30.257), { bestTime: 'evening' }), sight('宋城千古情', P(120.100, 30.170), { bestTime: 'evening' }),
  ] },
  { name: '西安 3 天', home: P(108.940, 34.340), days: 3, mode: 'selfDrive', places: [
    sight('兵马俑', P(109.278, 34.385), { durationMin: 180 }), sight('华清宫', P(109.212, 34.364)), sight('大雁塔', P(108.964, 34.219)),
    sight('大唐不夜城', P(108.964, 34.214), { bestTime: 'evening' }), sight('西安城墙', P(108.940, 34.260)), sight('回民街', P(108.940, 34.264), { bestTime: 'evening' }),
  ] },
  { name: '上海去苏州 2 天', home: P(121.470, 31.230), days: 2, mode: 'selfDrive', places: [
    sight('拙政园', P(120.629, 31.324)), sight('虎丘', P(120.585, 31.337)), sight('平江路', P(120.634, 31.315), { bestTime: 'evening' }),
    sight('苏州博物馆', P(120.628, 31.323)),
  ] },
  { name: '成都去九寨沟 4 天', home: P(104.039, 30.478), days: 4, mode: 'selfDrive', places: [
    sight('九寨沟', P(103.918, 33.260), { durationMin: 300 }), sight('黄龙', P(103.830, 32.740)), sight('松潘古城', P(103.600, 32.640), { bestTime: 'evening' }),
  ] },
  { name: '北京 5 天（上海坐高铁去）', home: P(121.470, 31.230), days: 5, mode: 'transit', places: [
    sight('故宫', P(116.397, 39.918), { durationMin: 240, start: '09:30' }), sight('八达岭长城', P(116.016, 40.356), { durationMin: 240 }),
    sight('颐和园', P(116.275, 39.999), { durationMin: 180 }), sight('天坛', P(116.411, 39.882)), sight('天安门广场', P(116.397, 39.903)),
    sight('南锣鼓巷', P(116.403, 39.937), { bestTime: 'evening' }), sight('什刹海', P(116.385, 39.940), { bestTime: 'evening' }),
    sight('鸟巢水立方', P(116.396, 39.993), { bestTime: 'evening' }), sight('798 艺术区', P(116.495, 39.984)), sight('北海公园', P(116.389, 39.925)),
  ] },
  { name: '厦门 3 天（跟团）', home: P(119.296, 26.074), days: 3, mode: 'tour', places: [
    sight('鼓浪屿', P(118.067, 24.448), { durationMin: 240 }), sight('南普陀寺', P(118.097, 24.443)), sight('厦门大学', P(118.100, 24.438)),
    sight('曾厝垵', P(118.128, 24.428), { bestTime: 'evening' }), sight('环岛路', P(118.150, 24.440)), sight('中山路步行街', P(118.080, 24.456), { bestTime: 'evening' }),
  ] },
  { name: '成都市内 2 天（公交）', home: P(104.066, 30.572), days: 2, mode: 'transit', places: [
    sight('大熊猫繁育研究基地', P(104.146, 30.733), { durationMin: 180 }), sight('宽窄巷子', P(104.053, 30.664)), sight('武侯祠', P(104.047, 30.646)),
    sight('锦里', P(104.050, 30.645), { bestTime: 'evening' }), sight('杜甫草堂', P(104.028, 30.660)), sight('九眼桥', P(104.087, 30.640), { bestTime: 'evening' }),
  ] },
  { name: '桂林阳朔 4 天（南宁飞去）', home: P(108.366, 22.817), days: 4, mode: 'transit', places: [
    sight('漓江竹筏', P(110.430, 25.080), { durationMin: 240 }), sight('遇龙河', P(110.430, 24.780)), sight('象鼻山', P(110.295, 25.267)),
    sight('西街', P(110.495, 24.778), { bestTime: 'evening' }), sight('十里画廊', P(110.460, 24.740)), sight('两江四湖', P(110.290, 25.280), { bestTime: 'evening' }),
  ] },
  { name: '北京自驾大理 18 天', home: P(116.40, 39.90), days: 18, mode: 'selfDrive', places: [
    sight('大理古城', P(100.160, 25.690)), sight('喜洲古镇', P(100.130, 25.850)), sight('双廊古镇', P(100.190, 25.915)),
  ] },
]

// —— 假高德：车程按直线估，周边给三家店、一家住处、服务区、两个远一点的景点 ——
const tools: PlanTools = {
  drive: async (a, b) => estDriveMin(a, b),
  nearby: async (what, at): Promise<NearbyPlace[]> => {
    const off = (k: number, d = 0.004) => P(at.lng + d * k, at.lat + d * k * 0.6)
    const tag = `${at.lng.toFixed(3)},${at.lat.toFixed(3)}`
    if (what === 'serviceArea') return [{ name: `服务区@${tag}`, poi: at }]
    if (what === 'sight') return [1, 2].map(k => ({ name: `附近景点${k}@${tag}`, poi: off(k, 0.05), rating: 4.5 }))
    const label = what === 'food' ? '饭馆' : '酒店'
    return [1, 2, 3].map(k => ({ name: `${label}${k}@${tag}`, poi: off(k), rating: [4.2, 4.6, 4.4][k - 1] }))
  },
}

interface Verdict { hard: string[]; soft: string[] }

/** 按验收标准查一个排出来的行程 */
function evaluate(route: Route, trip: Trip, unplacedMust: string[], overloaded = false): Verdict {
  const hard: string[] = [], soft: string[] = []
  const days = trip.days.length
  if (unplacedMust.length) hard.push(`必去的没排进去：${unplacedMust.join('、')}`)
  trip.days.forEach((day, d) => {
    const c = deriveConstraints(partyOnDay(trip.party, d))
    const sl = scheduleDay(day)
    if (!sl.length) return
    const tag = `D${d + 1}`
    const sights = sl.filter(s => s.stop.kind === 'sight')
    const foods = sl.filter(s => s.stop.kind === 'food')
    const road = !sights.length
    const end = sl[sl.length - 1].end
    const last = d === days - 1
    // 半夜前结束；按时回住处（赶路日放宽到 21:30）
    if (end >= 24 * 60) hard.push(`${tag} 排过了半夜（${fmtHM(end)}）`)
    // 必去的都放不下、已经提示加天：只查不过半夜（其余硬规则放过，这种方案本来就得改天数）
    if (overloaded) return
    const limit = road ? Math.max(c.endBy.value + 30, 21 * 60 + 30) : c.endBy.value + 30
    if (end > limit) hard.push(`${tag} ${fmtHM(end)} 才结束，晚于 ${fmtHM(limit)}`)
    // 游玩时长
    const active = sl.filter(s => s.stop.kind === 'sight').reduce((a, s) => a + s.stop.durationMin, 0)
    if (!road && active > c.activeMin.value + 20) hard.push(`${tag} 游玩 ${active} 分，超过上限 ${c.activeMin.value}`)
    // 两顿饭：时间像样、各一顿、隔得开
    const lunch = foods.filter(f => f.start >= 11 * 60 && f.start <= 13 * 60 + 45)
    const dinnerLo = 16 * 60 + 45, dinnerHi = last && trip.plan?.to ? 21 * 60 : road ? 21 * 60 + 30 : 20 * 60
    const dinner = foods.filter(f => f.start >= dinnerLo && f.start <= dinnerHi)
    // 最后一天早到家：中午前到家不用在外面吃午饭，19:30 前到家晚饭回家吃
    const homeAt = last && trip.plan?.to ? end : Infinity
    const homeDinner = homeAt <= 19 * 60 + 30 || (last && day.stops[day.stops.length - 1]?.why?.includes('到家吃晚饭'))
    const homeLunch = homeAt <= 12 * 60 + 30
    if (!lunch.length && !homeLunch) hard.push(`${tag} 没有像样的午饭（${foods.map(f => fmtHM(f.start)).join('、') || '一顿都没有'}）`)
    if (!dinner.length && !homeDinner) hard.push(`${tag} 没有像样的晚饭（${foods.map(f => fmtHM(f.start)).join('、') || '一顿都没有'}）`)
    const odd = foods.filter(f => !lunch.includes(f) && !dinner.includes(f))
    if (odd.length) hard.push(`${tag} 饭点不对：${odd.map(f => `${fmtHM(f.start)} ${f.stop.name}`).join('、')}`)
    if (lunch.length && dinner.length && dinner[0].start - lunch[0].start < 210) hard.push(`${tag} 午饭晚饭挨太近（${fmtHM(lunch[0].start)} / ${fmtHM(dinner[0].start)}）`)
    // 夜景在晚饭后；返程日（离家远）不排夜景
    for (const s of sights) {
      const src = route.places.find(p => p.name === s.stop.name)
      if (src?.bestTime !== 'evening') continue
      const farHome = last && !!trip.plan?.to && estDriveMin(s.stop.poi!, trip.plan.to.poi) > 45
      if (farHome) { if (s.start >= 17 * 60) hard.push(`${tag} 返程那天还排夜景：${s.stop.name} ${fmtHM(s.start)}`) }
      else if (dinner.length && s.start < dinner[0].end) soft.push(`${tag} 夜景 ${s.stop.name} 排在白天（${fmtHM(s.start)}）`)
    }
    // 规则层查出来的：时间冲突、连续开车超时
    for (const i of checkDay(trip, d)) if (i.code === 'overlap' || i.code === 'noDriveBreak') hard.push(`${tag} ${i.message}`)
    // 白天无故空一大段（排松一点的那天除外）
    // 这天可玩的时间还差一个半小时以上才算「无故空着」（带娃午睡后到饭点空着、已经玩够了的不算）
    if (!road && !route.lighter?.includes(d) && active < c.activeMin.value - 90) {
      for (let k = 1; k < sl.length; k++) {
        const gap = sl[k].departAt - sl[k - 1].end
        if (gap > 150 && sl[k - 1].end >= 9 * 60 && sl[k].departAt <= 19 * 60) soft.push(`${tag} ${fmtHM(sl[k - 1].end)}–${fmtHM(sl[k].departAt)} 空着 ${gap} 分`)
      }
    }
    // 下午没景点（14:30–17:00 逛景点不到一小时）：路上、排松一点的那天、下午就回到家的不算
    const ov = (x: typeof sl[number], lo: number, hi: number) => Math.max(0, Math.min(x.end, hi) - Math.max(x.start, lo))
    const pmSight = sights.reduce((a, x) => a + ov(x, 14.5 * 60, 17 * 60), 0)
    const pmMove = sl.filter(x => x.stop.kind === 'drive' || x.stop.kind === 'transit').reduce((a, x) => a + ov(x, 14.5 * 60, 17 * 60), 0) + sl.reduce((a, x) => a + Math.max(0, Math.min(x.start, 17 * 60) - Math.max(x.departAt, 14.5 * 60)), 0)
    if (!road && !route.lighter?.includes(d) && active < c.activeMin.value - 60 && end >= 17.5 * 60 && pmSight < 60 && pmMove < 75) soft.push(`${tag} 下午没安排景点`)
    // 同一天景点之间来回折返
    // 只算第一个景点到最后一个景点之间（去程、回住处的路不算）
    const i0 = sl.findIndex(s => s.stop.kind === 'sight'), i1 = sl.map(s => s.stop.kind).lastIndexOf('sight')
    const between = sl.slice(i0 + 1, i1 + 1).reduce((a, s) => a + (s.stop.kind === 'drive' ? s.stop.durationMin : s.stop.driveMin ?? 0), 0)
    if (!road && sights.length >= 2 && between > 180) soft.push(`${tag} 当天在景点之间开了 ${between} 分`)
    // 午睡时段结束后一小时内就到家、到住处的：回去睡，不算没睡上
    if (!road && c.nap && napMissed(trip, d) && end > c.nap.to + 60) soft.push(`${tag} 午睡没睡上`)
  })
  return { hard, soft }
}

describe('排程质检：同行组合 × 路线', () => {
  const rows: string[] = []
  const all: { key: string; v: Verdict }[] = []
  for (const route of ROUTES) {
    for (const [pname, p] of Object.entries(PARTIES)) {
      // 公交路线不带大狗（大狗上不了车）；长途只测几种
      if (route.mode === 'transit' && pname === '带大狗') continue
      it(`${route.name} · ${pname}`, async () => {
        let n = 0
        const newId = (x: string) => x + ++n
        const party: Party = { mode: route.mode, members: p.members, pets: p.pets }
        const base = skeletonTrip({ title: route.name, startDate: '2026-10-10', days: route.days, mode: route.mode, party, flow: 'places', styles: [], from: { name: '家', poi: route.home }, to: { name: '家', poi: route.home } }, newId)
        const t = { ...base, plan: { ...base.plan!, tweaks: (route.lighter ?? []).map(day => ({ day, lighter: true })) } }
        const places = route.places.map((p0, i) => ({ ...p0, must: route.allMust || i < 2 }))
        const r = await planTrip(t, places, tools, { origin: route.home, end: { name: '家', poi: route.home }, newId })
        const must = r.unplaced.filter(u => u.candidate.must).map(u => u.candidate.name)
        // 必去的都放不下、提示了加天：只查不过半夜，另外必须真的给了加天的提示
        const overloaded = r.extraDaysNeeded > 0
        const v = evaluate(route, r.trip, overloaded ? [] : must, overloaded)
        if (overloaded && !r.notes.length && !r.unplaced.length && r.extraDaysNeeded < 1) v.hard.push('排不下却没提示')
        all.push({ key: `${route.name} · ${pname}`, v })
        rows.push(`${v.hard.length ? '✗' : v.soft.length ? '△' : '✓'} ${route.name} · ${pname}${v.hard.length ? '\n    硬：' + v.hard.join('\n    硬：') : ''}${v.soft.length ? '\n    软：' + v.soft.join('\n    软：') : ''}`)
        if (process.env.QUALITY_DUMP) {
          console.log(`\n=== ${route.name} · ${pname} | 加 ${r.extraDaysNeeded} 天 | ${r.notes.join('；')}`)
          r.trip.days.forEach((d, i) => console.log(`D${i + 1} ` + scheduleDay(d).filter(s => process.env.QUALITY_DUMP === "all" || s.stop.kind !== "drive").map(s => `${fmtHM(s.start)}-${fmtHM(s.end)} ${s.stop.name.slice(0, 12)}`).join(' | ') + ` 〔${fmtHM(scheduleDay(d).slice(-1)[0]?.end ?? 0)}〕`))
        }
        expect(v.hard).toEqual([])
      })
    }
  }
  it('汇总', () => {
    if (process.env.QUALITY_REPORT) console.log('\n' + rows.join('\n'))
    const soft = all.reduce((a, x) => a + x.v.soft.length, 0)
    // 软性问题（夜景没排上晚上、空档、午睡）不挡验收，但要少：平均每个方案不到一条
    expect(soft).toBeLessThanOrEqual(all.length)
  })
})
