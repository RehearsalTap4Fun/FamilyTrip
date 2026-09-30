// 排程引擎（流程一，也是流程二和导入攻略的公共后半段）：给一组要去的点，按同行人的限制排成每天的行程。
//   分天（地理成串 → 按每天可玩时长切段，靠近当晚住处）→ 放不下就砍「想去」→ 天内顺路 → 固定时刻就位
//   → 插午饭晚饭 → 留午睡 → 真实车程、超连开拆段插服务区 → 住处。
// 有起点终点（默认现居地）时：第一天从起点出发、最后一天以回到终点收尾，这两段路程算进当天；不自驾的长途按高铁、飞机估。
// 车程、周边搜索由调用方注入（网页用高德），这里只管排；没有工具时用直线估算和占位，照样能出一版。
import { deriveConstraints, type Constraints } from './constraints'
import { bestTimeOf, inferDurationMin } from './timeOfDay'
import { distanceKm, estDriveMin, estLegMin, LONG_HAUL_KM, longHaul } from './geo'
import { partyOnDay } from './party'
import { fmtHM, parseHM, scheduleDay } from './schedule'
import type { DayTweak, PlanPlace, Poi, Stop, Trip, TripStyle } from './types'
import { checkDay, LATE_GRACE_MIN, LODGING_PLACEHOLDER, type Issue } from './validate'

/** 排程的输入就是行程计划里的地点 */
export type Candidate = PlanPlace

export interface NearbyPlace { name: string; poi: Poi; rating?: number; distanceM?: number }

export type NearbyKind = 'food' | 'lodging' | 'serviceArea' | 'sight'

export interface PlanTools {
  /** 两点真实车程（分钟）；拿不到返回 null，改用估算 */
  drive?: (a: Poi, b: Poi) => Promise<number | null>
  /** 真实路线和沿途的点（长途拆成几天时找每天开到哪）；没有就沿直线估 */
  route?: (a: Poi, b: Poi) => Promise<{ minutes: number; points: { lng: number; lat: number; t: number }[] } | null>
  /** 周边找吃饭、住处、服务区 */
  nearby?: (what: NearbyKind, at: Poi) => Promise<NearbyPlace[]>
  /** 红黑榜：黑榜不推荐，红榜优先 */
  verdictOf?: (p: { name: string; poi: Poi }) => 'red' | 'black' | undefined
  onProgress?: (msg: string) => void
}

export interface Unplaced { candidate: Candidate; reason: string }

export interface PlanResult {
  trip: Trip
  /** 按限制放不下、被砍掉的点 */
  unplaced: Unplaced[]
  /** 只剩必去也放不下时，建议再加几天 */
  extraDaysNeeded: number
  /** 排完之后规则层还查出的问题（不含待核） */
  issues: Issue[]
  /** 给人看的说明：用了哪些推荐、哪些是占位 */
  notes: string[]
}

// —— 玩法决定节奏：出发时间、景点默认停留、吃饭时长 ——
const START_BY_STYLE: Partial<Record<TripStyle, string>> = { active: '08:00', resort: '10:00' }
const SIGHT_MIN_BY_STYLE: Partial<Record<TripStyle, number>> = { family: 75, heritage: 120, resort: 150, scenic: 100 }
const MEAL_MIN_BY_STYLE: Partial<Record<TripStyle, number>> = { food: 75 }
const LUNCH = 12 * 60
const DINNER = 18 * 60
const REST_MIN = 20
/** 吃饭、住处推荐只认这个范围内的 */
const NEAR_KM = { food: 2.5, lodging: 6, serviceArea: 20, sight: 15 }
/** 周边搜出来的「景点」里其实是设施的 */
const SIGHT_JUNK = /(停车|招呼站|候车|吸烟|售票|厕所|卫生间|游客中心|服务中心|入口|出口|山门|大门|检票|码头|观光车|游览车)/
/** 景点最多延长到默认停留的这么多倍、不超过这么多分钟 */
const STRETCH_X = 2
const STRETCH_MAX = 240

interface Pace { start: string; sightMin: number; mealMin: number }

export function paceOf(styles: TripStyle[] = []): Pace {
  const main = styles[0]
  return {
    start: (main && START_BY_STYLE[main]) ?? '09:00',
    sightMin: (main && SIGHT_MIN_BY_STYLE[main]) ?? 90,
    mealMin: (main && MEAL_MIN_BY_STYLE[main]) ?? 60,
  }
}

const durOf = (c: Candidate, pace: Pace) => c.durationMin ?? (c.kind === 'food' ? pace.mealMin : c.kind === 'lodging' ? 0 : pace.sightMin)

/** 最近邻串起来：从 from 出发，每次去最近的那个 */
function chain<T extends { poi: Poi }>(items: T[], from?: Poi): T[] {
  const left = [...items]
  const out: T[] = []
  let at = from
  if (!at && left.length) {
    // 没有起点：从离重心最远的那个开始，线性路线（大理→丽江）会从一头走到另一头
    const cx = left.reduce((a, x) => a + x.poi.lng, 0) / left.length
    const cy = left.reduce((a, x) => a + x.poi.lat, 0) / left.length
    const c = { lng: cx, lat: cy }
    left.sort((a, b) => distanceKm(b.poi, c) - distanceKm(a.poi, c))
    at = left[0].poi
  }
  while (left.length) {
    let bi = 0
    for (let i = 1; i < left.length; i++) if (distanceKm(at!, left[i].poi) < distanceKm(at!, left[bi].poi)) bi = i
    const [x] = left.splice(bi, 1)
    out.push(x)
    at = x.poi
  }
  return out
}

/** 有「想在哪天」的按天序分组串，组内最近邻；没有偏好的按地理插到离得最近的组里 */
function chainByPref<T extends { poi: Poi; prefDay?: number }>(items: T[], from?: Poi): T[] {
  if (!items.some(x => x.prefDay != null)) return chain(items, from)
  const groups = new Map<number, T[]>()
  for (const x of items) if (x.prefDay != null) groups.set(x.prefDay, [...(groups.get(x.prefDay) ?? []), x])
  for (const x of items) {
    if (x.prefDay != null) continue
    let bd = [...groups.keys()][0], bk = Infinity
    for (const [d, g] of groups) for (const y of g) { const k = distanceKm(x.poi, y.poi); if (k < bk) { bk = k; bd = d } }
    groups.get(bd)!.push(x)
  }
  const out: T[] = []
  let at = from
  for (const d of [...groups.keys()].sort((a, b) => a - b)) {
    const part = chain(groups.get(d)!, at)
    out.push(...part)
    at = part[part.length - 1]?.poi ?? at
  }
  return out
}

/** 开放路径的 2-opt：首尾可以固定（前一晚住处、今晚住处），点少时足够 */
function twoOpt<T extends { poi: Poi }>(path: T[], from?: Poi, to?: Poi): T[] {
  const p = [...path]
  const at = (i: number) => (i < 0 ? from : i >= p.length ? to : p[i].poi)
  const d = (a?: Poi, b?: Poi) => (a && b ? distanceKm(a, b) : 0)
  let improved = true
  for (let guard = 0; improved && guard < 50; guard++) {
    improved = false
    for (let i = 0; i < p.length - 1; i++) {
      for (let j = i + 1; j < p.length; j++) {
        const before = d(at(i - 1), at(i)) + d(at(j), at(j + 1))
        const after = d(at(i - 1), at(j)) + d(at(i), at(j + 1))
        if (after + 1e-9 < before) { p.splice(i, j - i + 1, ...p.slice(i, j + 1).reverse()); improved = true }
      }
    }
  }
  return p
}

/** 一天的额度：景点可用分钟（游玩上限 − 两顿饭）、全天可用分钟（出发到最晚回住处） */
interface DayBudget {
  cap: number; span: number; from?: Poi; to?: Poi
  /** 两点之间要走多久（按出行方式粗估） */
  est: (a: Poi, b: Poi) => number
  /** 分天时点该靠近的两头：只算在当地的（从家出发、回家那头离得远，不拿来比远近） */
  near: Poi[]
  /** 这天不排夜景（最后一天要回家、离家远）：夜景尽量别分到这天 */
  noEve?: boolean
  /** 这天最多开多久（每天驾驶上限；不限就不传） */
  driveCap?: number
  /** 自驾：每开两个半小时歇一次，也占时间（高铁、飞机不用） */
  rests?: boolean
}

/** 按估算车程串起来的一段路要开多久 */
function estPath(points: Poi[], est: (a: Poi, b: Poi) => number = estDriveMin): number {
  let m = 0
  for (let i = 1; i < points.length; i++) m += est(points[i - 1], points[i])
  return m
}

/** 这一天超出了多少（景点超时、或加上开车全天放不下，取大的那个，单位分钟） */
function excessOf(b: DayBudget, sights: Candidate[], pace: Pace): number {
  const load = sights.reduce((a, s) => a + durOf(s, pace), 0)
  const drive = estPath([b.from, ...sights.map(s => s.poi), b.to].filter((p): p is Poi => !!p), b.est)
  // 路上每开两个半小时歇 20 分钟，也要占时间
  const rests = b.rests ? Math.floor(drive / 150) * REST_MIN : 0
  // 开车超过每天上限的也算超出（最后一天在丽江玩完再开 8 个多小时回昆明）
  return Math.max(load - b.cap, load + 2 * pace.mealMin + drive + rests - b.span, b.driveCap != null ? drive - b.driveCap : -Infinity)
}

/**
 * 把串好的点切成连续的几段，每段是一天。代价：负荷均衡（平方和）+ 景点超时、全天放不下重罚
 * + 离这天的路线远（这天从前一晚住处出发、到今晚住处，点离两头中近的那个越远越差）
 * + 偏离「想在哪天」（导入攻略时原文的分天，只是偏好）。
 * 已经指定了日子的点先占那天的额度。
 */
function splitDays(order: Candidate[], budgets: DayBudget[], pinned: Candidate[][], pace: Pace): number[][] {
  const n = order.length
  const days = budgets.length
  const cost = (d: number, i: number, j: number) => {
    const b = budgets[d]
    const seg = [...pinned[d], ...order.slice(i, j)]
    const load = seg.reduce((a, s) => a + durOf(s, pace), 0)
    const r = load / b.cap
    const ex = Math.max(0, excessOf(b, seg, pace)) / b.cap
    let far = 0, off = 0
    for (let k = i; k < j; k++) {
      const p = order[k].poi
      const near = Math.min(...b.near.map(q => distanceKm(p, q)))
      if (Number.isFinite(near)) far += near / 30
      // 想在哪天：偏离一天罚一点，比放不下、全天超时轻得多
      const pd = order[k].prefDay
      if (pd != null) off += Math.abs(d - pd) * 0.8
    }
    // 一天只有一个晚上：两个要看夜景的别分在同一天
    const eve = seg.filter(s => s.bestTime === 'evening').length
    return r * r + ex * 100 + far + off + Math.max(0, eve - 1) * 4 + (b.noEve ? eve * 3 : 0)
  }
  // best[d][j]：前 d 天排掉前 j 个点的最小代价
  const best = Array.from({ length: days + 1 }, () => new Array(n + 1).fill(Infinity))
  const cut = Array.from({ length: days + 1 }, () => new Array(n + 1).fill(0))
  best[0][0] = 0
  for (let d = 1; d <= days; d++) {
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= j; i++) {
        if (best[d - 1][i] === Infinity) continue
        const v = best[d - 1][i] + cost(d - 1, i, j)
        if (v < best[d][j]) { best[d][j] = v; cut[d][j] = i }
      }
    }
  }
  const segs: number[][] = []
  let j = n
  for (let d = days; d >= 1; d--) { const i = cut[d][j]; segs.unshift(Array.from({ length: j - i }, (_, k) => i + k)); j = i }
  return segs
}

/**
 * 一天分到这些景点的代价（和 splitDays 同一套，再加「当天兜圈」）：负荷均衡、超时重罚、离两头远、偏离想去的那天、夜景冲突，
 * 以及当天景点之间按顺路串起来要开多久（每小时 0.6）——离得近的景点才会凑到一天
 */
function dayCost(b: DayBudget, seg: Candidate[], d: number, pace: Pace): number {
  const order = chain(seg, b.from)
  const load = seg.reduce((a, s) => a + durOf(s, pace), 0)
  const r = load / b.cap
  const ex = Math.max(0, excessOf(b, order, pace)) / b.cap
  let far = 0, off = 0
  for (const s of seg) {
    const near = Math.min(...b.near.map(q => distanceKm(s.poi, q)))
    if (Number.isFinite(near)) far += near / 30
    if (s.prefDay != null) off += Math.abs(d - s.prefDay) * 0.8
  }
  const eve = seg.filter(s => s.bestTime === 'evening').length
  const loop = order.length > 1 ? estPath(order.map(s => s.poi), b.est) / 60 * 0.6 : 0
  // 排得刚好压线也不好（最后一天逛完长城再坐五个小时车，十点多才到家）：离收尾不到两小时的，每少 40 分钟加 1
  const drive = estPath([b.from, ...order.map(s => s.poi), b.to].filter((p): p is Poi => !!p), b.est)
  const slack = b.span - (load + 2 * pace.mealMin + drive + (b.rests ? Math.floor(drive / 150) * REST_MIN : 0))
  const tight = seg.length ? Math.max(0, Math.min(120, 120 - slack)) / 40 : 0
  return r * r + ex * 100 + far + off + Math.max(0, eve - 1) * 4 + (b.noEve ? eve * 3 : 0) + loop + tight
}

/**
 * 分天后再挪一挪：按顺序切段只能切连续的一串（清单顺序把都江堰的南桥和卧龙串在一起、华清宫和大雁塔串在一起），
 * 这里逐个试「把一个没指定日子的景点挪到另一天」「两天各拿一个互换」，更好就换，直到挪不动
 */
function refineDays(days: Candidate[][], budgets: DayBudget[], pinned: (c: Candidate) => boolean, pace: Pace): Candidate[][] {
  const out = days.map(d => [...d])
  // 前一晚住处还没定：当天从前一天最后一个景点那儿出发（不然最后一天从丽江开回昆明的那段算不进来）
  const total = (plan: Candidate[][]) => {
    let sum = 0, prevEnd: Poi | undefined
    plan.forEach((seg, d) => {
      const b = budgets[d]
      const bb = b.from || !prevEnd ? b : { ...b, from: prevEnd }
      sum += dayCost(bb, seg, d, pace)
      const ord = chain(seg, bb.from)
      prevEnd = ord.length ? ord[ord.length - 1].poi : b.to ?? prevEnd
    })
    return sum
  }
  let cur = total(out)
  for (let iter = 0; iter < 80; iter++) {
    let best: { gain: number; plan: Candidate[][] } | null = null
    const tryPlan = (plan: Candidate[][]) => { const g = cur - total(plan); if (g > 0.05 && (!best || g > best.gain)) best = { gain: g, plan } }
    for (let a = 0; a < out.length; a++) {
      for (const s of out[a]) {
        if (pinned(s)) continue
        const without = out[a].filter(x => x !== s)
        for (let b = 0; b < out.length; b++) {
          if (b === a) continue
          // 挪过去
          tryPlan(out.map((seg, d) => (d === a ? without : d === b ? [...seg, s] : seg)))
          // 互换
          for (const t of out[b]) {
            if (pinned(t)) continue
            tryPlan(out.map((seg, d) => (d === a ? [...without, t] : d === b ? [...seg.filter(x => x !== t), s] : seg)))
          }
        }
      }
    }
    if (!best) break
    const pick = best as { gain: number; plan: Candidate[][] }
    pick.plan.forEach((seg, d) => { out[d] = seg })
    cur -= pick.gain
  }
  return out
}

/** 一天里的一个非开车节点；开车段和路上的服务区由 expand 按真实车程生成 */
interface Node { stop: Stop; poi?: Poi; meal?: 'lunch' | 'dinner' }

const MEAL_AT = { lunch: LUNCH, dinner: DINNER }

export async function planTrip(trip: Trip, candidates: Candidate[], tools: PlanTools, opts: { origin?: Poi; end?: { name: string; poi: Poi }; newId: (prefix: string) => string }): Promise<PlanResult> {
  const days = trip.days.length
  const pace = paceOf(trip.plan?.styles)
  const cons: Constraints[] = trip.days.map((_, i) => deriveConstraints(partyOnDay(trip.party, i)))
  const notes: string[] = []
  const progress = (m: string) => tools.onProgress?.(m)
  const clampDay = (d?: number) => (d == null ? undefined : Math.max(0, Math.min(days - 1, Math.round(d))))
  // 按要求对某几天的调整：出发时间、排松一点、饭在哪附近吃
  const tweakOf = (d: number): DayTweak | undefined => trip.plan?.tweaks?.find(t => t.day === d)
  const startOf = (d: number) => tweakOf(d)?.start ?? pace.start

  // 单个景点比任何一天留给景点的额度还长（带宝宝一天只剩两三个小时，青城山估了 170 分）：压到能放下、说一声，别整个砍掉
  const capOf = (d: number) => Math.max(60, cons[d].activeMin.value * (tweakOf(d)?.lighter ? 0.75 : 1))
  const maxCap = Math.max(...trip.days.map((_, d) => capOf(d)))
  // 最佳时段：给了的照用，没给的从说明里认（「晚上灯亮了最好看」）
  const sights = candidates.filter(c => c.kind === 'sight').map(c0 => {
    const bt = bestTimeOf(c0.bestTime, c0.why)
    // 没给时长的按景点大小估（夜景晚上逛一圈，最多一个半小时）；认不出的按节奏默认
    const guess = c0.durationMin == null ? inferDurationMin(c0.name, c0.why, bt) : undefined
    const c = { ...c0, ...(bt ? { bestTime: bt } : {}), ...(guess ? { durationMin: guess } : {}) }
    const dur = durOf(c, pace)
    if (dur <= maxCap) return c
    const fit = Math.floor(maxCap / 10) * 10
    notes.push(`${c.name}估的要玩 ${dur} 分钟，按你们的节奏一天最多 ${fit} 分钟，挑重点逛`)
    return { ...c, durationMin: fit }
  })
  const foods = candidates.filter(c => c.kind === 'food')
  const lodgings = candidates.filter(c => c.kind === 'lodging')

  // —— 工具：带缓存的车程、周边推荐 ——
  const driveCache = new Map<string, number>()
  const driveMin = async (a: Poi, b: Poi): Promise<number> => {
    if (distanceKm(a, b) < 0.3) return 0
    const k = `${a.lng},${a.lat}>${b.lng},${b.lat}`
    if (!driveCache.has(k)) {
      let m: number | null = null
      if (tools.drive) { try { m = await tools.drive(a, b) } catch { m = null } }
      driveCache.set(k, m ?? estDriveMin(a, b))
    }
    return driveCache.get(k)!
  }
  // 真实路线（带沿途的点），同一段只要一次：长途拆天找落脚点、路上找服务区都沿它
  const routeCache = new Map<string, Promise<Awaited<ReturnType<NonNullable<PlanTools['route']>>>>>()
  const routeOf = (a: Poi, b: Poi) => {
    if (!tools.route) return Promise.resolve(null)
    const k = `${a.lng},${a.lat}>${b.lng},${b.lat}`
    if (!routeCache.has(k)) routeCache.set(k, tools.route(a, b).catch(() => null))
    return routeCache.get(k)!
  }
  /** 沿真实路线开到第 m 分钟时在哪 */
  const along = (r: { points: { lng: number; lat: number; t: number }[] }, m: number): Poi => { const q = r.points.find(p => p.t >= m) ?? r.points[r.points.length - 1]; return { lng: q.lng, lat: q.lat } }
  // 已经在要去的地方里的不再被推荐一遍（免得同一家吃两顿、下午补的景点和要去的重复）
  const used = new Set<string>(candidates.map(c => c.name))
  const sightPois = candidates.filter(c => c.kind === 'sight').map(c => c.poi)
  const sightNames = candidates.filter(c => c.kind === 'sight').map(c => c.name.replace(/[（(].*$/, '').replace(/(景区|风景区|旅游区|文化旅游区)$/, '')).filter(n => n.length >= 2)
  const whyText = candidates.map(c => c.why ?? '').join(' ')
  // 用户（或攻略、方案）给了时长的站：补空档时不去拉长它
  const fixedDur = new Set<string>()
  // 排程自己定的时刻（夜景、晚饭等到饭点）：前面的站还没完时让位顺延，不报冲突；用户自己定的（预约）不动
  const softStart = new Set<string>()
  const softCands = new WeakSet<Candidate>()
  const nearbyCache = new Map<string, NearbyPlace | undefined>()
  /** heading：服务区用，这一点上行车的方向（经纬度差），挑右手边那个（两个方向各一个、名字一样） */
  const pick = async (what: NearbyKind, at: Poi, reuse = false, heading?: { dx: number; dy: number }): Promise<NearbyPlace | undefined> => {
    if (!tools.nearby) return undefined
    const key = `${what}@${at.lng.toFixed(4)},${at.lat.toFixed(4)}`
    if (reuse && nearbyCache.has(key)) return nearbyCache.get(key)
    let list: NearbyPlace[] = []
    try { list = await tools.nearby(what, at) } catch { return undefined }
    const red = (p: NearbyPlace) => (tools.verdictOf?.(p) === 'red' ? 1 : 0)
    // 下午补景点：别补已经排进去的景区里面的点（离已有景点 1.2 公里内、或名字写在园区顺序里，例如都江堰景区里的宝瓶口）
    // 名字里带着已排的景点也算（「大理古城国家级旅游度假区」）
    const inside = (p: NearbyPlace) => what === 'sight' && (sightPois.some(q => distanceKm(q, p.poi) < 1.2) || whyText.includes(p.name.replace(/[（(].*$/, '')) || sightNames.some(n => p.name.includes(n)))
    // 补的景点不要景区里的小点（名字带「-」的子景点）、设施（招呼站、停车场、售票处），也不要评分低于 4 的
    const junk = (p: NearbyPlace) => what === 'sight' && (/[\u4e00-\u9fa5）)][-—－][\u4e00-\u9fa5]/.test(p.name) || SIGHT_JUNK.test(p.name) || (p.rating != null && p.rating > 0 && p.rating < 4))
    // 还没开的服务区（高德名字里写着「建设中」「未开通」）到了也停不了
    const closed = (p: NearbyPlace) => /建设中|未开通|暂停|停用|关闭|停业/.test(p.name)
    const ok = list.filter(p => distanceKm(at, p.poi) <= NEAR_KM[what] && tools.verdictOf?.(p) !== 'black' && (what === 'serviceArea' || !used.has(p.name)) && !inside(p) && !junk(p) && !closed(p))
    // 景点评分和远近一起看（每远 10 公里抵 1 分），免得为了高 0.1 分跑老远；吃饭住处只看评分；
    // 服务区只看远近：at 是路上的那个点，最近的才在这条路上（远一点的可能在另一条高速上）
    // 靠右行驶：服务区在行车方向右手边的才能进（对向那个名字一样、位置几乎重合，差一点就算抵 2 公里）
    const wrongSide = (p: NearbyPlace) => (heading ? heading.dx * (p.poi.lat - at.lat) - heading.dy * (p.poi.lng - at.lng) > 0 : false)
    const score = (p: NearbyPlace) => (what === 'serviceArea' ? -distanceKm(at, p.poi) - (wrongSide(p) ? 2 : 0) : (p.rating ?? 0) - (what === 'sight' ? distanceKm(at, p.poi) / 10 : 0))
    ok.sort((a, b) => red(b) - red(a) || score(b) - score(a))
    const got = ok[0]
    if (got && what !== 'serviceArea') used.add(got.name)
    nearbyCache.set(key, got)
    return got
  }

  // —— 住处：指定了哪晚就是哪晚；只给了一处又没说哪晚，当整趟的大本营 ——
  const night: (Candidate | undefined)[] = new Array(days).fill(undefined)
  // 住处：指定的晚上优先；原文 / 方案里说的那晚（prefDay）其次
  for (const l of lodgings) { const d = clampDay(l.day); if (d != null && !night[d]) night[d] = l }
  for (const l of lodgings) { const d = clampDay(l.prefDay); if (l.day == null && d != null && !night[d]) night[d] = l }
  const looseLodging = lodgings.filter(l => clampDay(l.day ?? l.prefDay) == null)
  if (looseLodging.length === 1 && lodgings.length === 1) for (let d = 0; d < days; d++) night[d] = looseLodging[0]
  // 最后一天回终点，不住了
  // 起点终点：长途自驾天数不够来回时会被去掉（先不排去程返程，照实说）
  let origin = opts.origin
  let endRef = opts.end
  let endPoi = endRef?.poi
  if (endPoi) night[days - 1] = undefined
  const mode = trip.party.mode
  const est = (a: Poi, b: Poi) => estLegMin(a, b, mode)
  const local = (q?: Poi) => (q && sights.some(s => distanceKm(s.poi, q) <= 80) ? q : undefined)

  // —— 长途自驾一天开不完：拆出整天赶路的日子（每天开到当天能开的上限，晚上在路上住），不再把几十个小时塞进一天 ——
  // 去程：前几天赶路，到的那天接着玩；返程：玩完那天住当地，最后几天赶路、最后一天到家。天数不够就照实说
  const road: ({ at: Poi; leg: 'out' | 'back'; min: number } | undefined)[] = new Array(days).fill(undefined)
  let firstRegion = 0, lastRegion = days - 1, shortDays = 0
  if (mode === 'selfDrive' && sights.length) {
    const nearest = (q: Poi) => sights.reduce((a, x) => (distanceKm(x.poi, q) < distanceKm(a.poi, q) ? x : a)).poi
    const lerp = (a: Poi, b: Poi, f: number): Poi => ({ lng: a.lng + (b.lng - a.lng) * f, lat: a.lat + (b.lat - a.lat) * f })
    // 一天能开多久：每天驾驶上限（一个司机 5 小时、两个 8 小时），也要给吃饭歇脚留出 3 小时
    const cap = (d: number) => Math.max(120, Math.min(cons[d].driveMin.value, cons[d].endBy.value - parseHM(startOf(d)) - 180))
    const hours = (m: number) => Math.round(m / 6) / 10
    // 当天的落脚点：按真实车程找「从 prev 开过去正好 x 分钟」的那一点（沿 a→b 连线二分）。
    // 不能直接取连线的几分之几：真实路线绕山路（成都到大理走西昌），连线上的点开过去要多好几个小时
    const stopAt = async (prev: Poi, a: Poi, b: Poi, f0: number, x: number): Promise<{ at: Poi; f: number }> => {
      let lo = f0, hi = 1, best = { at: b, f: 1 }
      for (let k = 0; k < 7; k++) {
        const f = (lo + hi) / 2
        const q = lerp(a, b, f)
        const m = await driveMin(prev, q)
        if (m <= x) { best = { at: q, f }; lo = f } else hi = f
      }
      return best.f > f0 ? best : { at: lerp(a, b, Math.min(1, f0 + (1 - f0) / 2)), f: Math.min(1, f0 + (1 - f0) / 2) }
    }
    const outTo = opts.origin ? nearest(opts.origin) : undefined
    // 返程从离家最远的那头估：按顺路排下来，行程多半在最远的那头结束（大理丽江最后一天在丽江，不是大理）
    const farthest = (q: Poi) => sights.reduce((a, x) => (distanceKm(x.poi, q) > distanceKm(a.poi, q) ? x : a)).poi
    const backFrom = endPoi ? farthest(endPoi) : undefined
    // 有真实路线就用它（总用时准、沿途的点在路上）；没有就用车程加直线
    const outRoute = opts.origin && outTo ? await routeOf(opts.origin, outTo) : null
    const backRoute = endPoi && backFrom ? await routeOf(backFrom, endPoi) : null
    const outTotal = opts.origin && outTo ? outRoute?.minutes ?? await driveMin(opts.origin, outTo) : 0
    const backTotal = endPoi && backFrom ? backRoute?.minutes ?? await driveMin(backFrom, endPoi) : 0
    // 每天开 x 分钟时：去程要几个整天赶路（到的那天开剩下的、接着玩），返程要几个整天赶路（开得完一天的就和玩的那天合在一起）
    // 最后一截不到一小时不另占一天（8.6 小时的返程不值得多拆一整天）；
    // 去程到的那天还要开的超过半天，那天也算纯赶路（不然到了天都黑了，排不了景点）
    const layout = (x: number) => {
      const outDays = outTotal > x + 60 ? Math.ceil((outTotal - 60) / x) : 1
      const rest = outTotal - (outDays - 1) * x
      return { out: outTotal > x + 60 ? (rest > x / 2 ? outDays : outDays - 1) : 0, back: backTotal > x + 60 ? Math.ceil((backTotal - 60) / x) : 0 }
    }
    const base = Math.min(...trip.days.map((_, d) => cap(d)))
    let x = base, L = layout(x)
    // 天数不够：先把每天开的时长往上加（最多 11 小时，一天之内开得完），至少留一天玩
    while (L.out + L.back > days - 1 && x < 11 * 60) { x = Math.min(11 * 60, x + 30); L = layout(x) }
    const need = layout(base)
    shortDays = Math.max(0, need.out + need.back + 1 - days)
    // 还是排不下：不硬排半夜还在开的车，先不排去程返程，只排当地的，照实说
    const fits = L.out + L.back <= days - 1
    const nOut = fits ? L.out : 0, nBack = fits ? L.back : 0
    if (!fits) {
      notes.push(`这趟 ${days} 天自驾来回排不下：按每天驾驶上限（${hours(base)} 小时），去程要开约 ${hours(outTotal)} 小时、返程约 ${hours(backTotal)} 小时，来回路上就要 ${need.out + need.back} 天，再加至少一天玩。先只排了当地的行程，去程返程没排；建议加 ${shortDays} 天，或者去程、返程换成高铁、飞机`)
      if (outTotal > base) origin = undefined
      if (backTotal > base) { endRef = undefined; endPoi = undefined }
    }
    if (origin && outTo) {
      let prev = origin, f = 0
      for (let d = 0; d < nOut; d++) {
        if (outRoute?.points.length) { road[d] = { at: along(outRoute, (d + 1) * x), leg: 'out', min: x }; continue }
        const s1 = await stopAt(prev, origin, outTo, f, x); road[d] = { at: s1.at, leg: 'out', min: x }; prev = s1.at; f = s1.f
      }
      firstRegion = nOut
      if (nOut > 0) notes.push(`去程开车约 ${hours(outTotal)} 小时，一天开不完：前 ${nOut} 天赶路，路上住 ${nOut} 晚`)
    }
    if (endPoi && backFrom && nBack > 0) {
      let prev = backFrom, f = 0
      for (let i = 0; i < nBack; i++) {
        if (i === nBack - 1) { road[days - nBack + i] = { at: endPoi, leg: 'back', min: x }; break }
        if (backRoute?.points.length) { road[days - nBack + i] = { at: along(backRoute, (i + 1) * x), leg: 'back', min: x }; continue }
        const s1 = await stopAt(prev, backFrom, endPoi, f, x); road[days - nBack + i] = { at: s1.at, leg: 'back', min: x }; prev = s1.at; f = s1.f
      }
      lastRegion = days - 1 - nBack
      notes.push(`返程开车约 ${hours(backTotal)} 小时，一天开不完：最后 ${nBack} 天赶路${nBack > 1 ? `，路上住 ${nBack - 1} 晚` : ''}`)
    }
    if (x > base && (nOut || nBack)) notes.push(`天数紧，按每天开约 ${hours(x)} 小时排的，超过了每天驾驶上限（${hours(base)} 小时）`)
    if (fits && shortDays > 0) notes.push(`这趟 ${days} 天开车来回有点紧：按每天驾驶上限，来回路上要 ${need.out + need.back} 天、再加至少一天玩；建议加 ${shortDays} 天`)
    for (let d = 0; d < days; d++) if (road[d]) night[d] = undefined
  }
  // 景点、饭店只放在玩的日子里：指定在赶路日的，挪到最近的玩的那天
  const regionDay = (d?: number) => { const c = clampDay(d); return c == null ? undefined : Math.max(firstRegion, Math.min(lastRegion, c)) }
  // 没住处的晚上：沿用前一晚（多半是连住）；第一晚没有就留空，排完再在附近找
  const budgets = (): DayBudget[] => cons.map((c, d) => {
    // 赶路日：额度几乎为零，分天时不会往里放景点
    if (road[d]) return { cap: 1, span: 1e6, est, near: [] }
    const from = d === firstRegion ? (road[d - 1]?.at ?? (d === 0 ? origin : night[d - 1]?.poi)) : night[d - 1]?.poi
    const to = d === days - 1 && endPoi ? endPoi : night[d]?.poi
    const noEve = d === days - 1 && !!endPoi && sights.every(x => est(x.poi, endPoi!) > 45)
    const driveCap = mode === 'selfDrive' && Number.isFinite(c.driveMin.value) ? c.driveMin.value + 60 : undefined
    return { cap: capOf(d), span: Math.max(120, c.endBy.value - parseHM(startOf(d))), from, to, est, near: [local(from), local(to)].filter((q): q is Poi => !!q), noEve, driveCap, rests: mode === 'selfDrive' }
  })

  // —— 分天，放不下就砍 ——
  progress('分天')
  let free = sights.filter(s => regionDay(s.day) == null)
  const pinnedAll = sights.filter(s => regionDay(s.day) != null)
  const unplaced: Unplaced[] = []
  const pinnedOn = () => Array.from({ length: days }, (_, d) => pinnedAll.filter(s => regionDay(s.day) === d))
  let daySights: Candidate[][] = []
  for (let guard = 0; guard < 200; guard++) {
    const order = chainByPref(free, road[firstRegion - 1]?.at ?? origin ?? night[0]?.poi)
    const pinned = pinnedOn()
    const b = budgets()
    const segs = splitDays(order, b, pinned, pace)
    daySights = segs.map((seg, d) => [...seg.map(k => order[k]), ...pinned[d]])
    const ex = daySights.map((ss, d) => excessOf(b[d], ss, pace))
    const worst = ex.reduce((bi, e, d) => (e > ex[bi] ? d : bi), 0)
    if (ex[worst] <= 0) break
    // 那天里最费时的「想去」先砍（指定了这天的也算）
    const pool = daySights[worst].filter(s => !s.must)
    if (!pool.length) break
    const drop = pool.reduce((a, x) => (durOf(x, pace) > durOf(a, pace) ? x : a))
    const c = cons[worst]
    // 说清楚卡在哪：每天在外多少小时、两顿饭占多少，景点还剩多少
    const cap = Math.round(b[worst].cap)
    // 去程、返程那天：路上的时间也说出来
    const leg = worst === days - 1 && endPoi ? '返程' : worst === 0 && origin ? '去程' : ''
    const roadMin = leg ? estPath([b[worst].from, ...daySights[worst].map(x => x.poi), b[worst].to].filter((q): q is Poi => !!q), est) : 0
    unplaced.push({ candidate: drop, reason: leg
      ? `第 ${worst + 1} 天放不下：这天${leg}路上约 ${Math.round(roadMin / 6) / 10} 小时，${fmtHM(c.endBy.value)} 前要${leg === '返程' ? '到家' : '到住处'}`
      : `第 ${worst + 1} 天放不下：每天游玩 ${c.activeMin.value / 60} 小时（不含吃饭），留给景点 ${cap} 分；${fmtHM(c.endBy.value)} 前回住处` })
    free = free.filter(x => x !== drop)
    const pi = pinnedAll.indexOf(drop)
    if (pi >= 0) pinnedAll.splice(pi, 1)
  }
  // 分天后再挪一挪：景点换到更顺路的那天
  daySights = refineDays(daySights, budgets(), x => regionDay(x.day) != null, pace)
  const b0 = budgets()
  const over = daySights.reduce((a, ss, d) => a + Math.max(0, excessOf(b0[d], ss, pace)), 0)
  const playDays = b0.filter((_, d) => !road[d])
  const avgCap = playDays.reduce((a, x) => a + x.cap, 0) / Math.max(1, playDays.length)
  const extraDaysNeeded = (over > 0 ? Math.ceil(over / avgCap) : 0) + shortDays

  // 吃饭的点：指定了日子的按日子，没指定的给离得最近的那天
  const dayFoods: Candidate[][] = Array.from({ length: days }, () => [])
  for (const f of foods) {
    let d = regionDay(f.day ?? f.prefDay)
    if (d == null) {
      let bd = firstRegion, bk = Infinity
      daySights.forEach((ss, i) => { for (const s of ss) { const k = distanceKm(s.poi, f.poi); if (k < bk) { bk = k; bd = i } } })
      d = bd
    }
    dayFoods[d].push(f)
  }

  // 站点 → 它来自哪个候选（排完一天太晚要砍时，放进「放不下」）
  const stopCand = new Map<string, Candidate>()
  const toStop = (c: Candidate): Stop => {
    const id = opts.newId('s')
    stopCand.set(id, c)
    if (c.durationMin != null) fixedDur.add(id)
    return toStopWith(c, id)
  }
  const toStopWith = (c: Candidate, id: string): Stop => ({
    id, kind: c.kind, name: c.name, durationMin: durOf(c, pace), status: 'planned', poi: c.poi,
    priority: c.must ? 1 : 2, ...(c.start ? { start: c.start } : {}), ...(c.suggested ? { suggested: true } : {}), ...(c.why ? { why: c.why } : {}), ...(c.tags ? { tags: c.tags } : {}),
    ...(c.walkKm != null ? { walkKm: c.walkKm } : {}), ...(c.altitudeM != null ? { altitudeM: c.altitudeM } : {}),
  })

  const outDays: Trip['days'] = []
  let prevNight: Poi | undefined = origin
  let prevLodge: Node | undefined
  for (let d = 0; d < days; d++) {
    progress(`排第 ${d + 1}/${days} 天`)
    const c = cons[d]
    const tw = tweakOf(d)
    const startMin = parseHM(startOf(d))
    // 这天的游玩上限：要求排松一点就打八折
    const activeCap = c.activeMin.value * (tw?.lighter ? 0.8 : 1)
    // 自驾长途：有人要求多久停一次就按它；都是大人也 2.5 小时歇一次（路上才有地方吃饭、歇脚）
    const limit = trip.party.mode === 'selfDrive' ? Math.min(c.driveBreakMin.value, 150) : Infinity
    // 最后一天回终点（家）；其余天今晚住处：指定的，或没指定晚上的候选里离今天的点近的
    const endHere = d === days - 1 && !!endRef
    let lodge = night[d]
    if (!endHere && !lodge && looseLodging.length && daySights[d].length) {
      const last = daySights[d][daySights[d].length - 1].poi
      lodge = [...looseLodging].sort((a, b) => distanceKm(a.poi, last) - distanceKm(b.poi, last))[0]
    }

    // 天内顺路（前一晚住处 → 今晚住处），再把固定时刻的点按估算时间插到对得上的位置
    // 看夜景的：晚饭后去（带小孩早回，18:30；否则 18:45），一天排一个；其余的照常
    const eveAt = c.endBy.value <= 20 * 60 ? '18:30' : '18:45'
    let eveUsed = false
    const today = daySights[d].map(s => {
      if (s.bestTime !== 'evening' || s.start || eveUsed) return s
      // 最后一天要回家、离家又不近：不排夜景（天黑前往回走），当白天的景点排
      if (endHere && endPoi && est(s.poi, endPoi) > 45) return s
      eveUsed = true
      const e = { ...s, start: eveAt, why: [s.why, '晚上好看，排在晚饭后'].filter(Boolean).join(' · ') }
      softCands.add(e)
      return e
    })
    const fixed = today.filter(s => s.start).sort((a, b) => parseHM(a.start!) - parseHM(b.start!))
    const seq = twoOpt(chain(today.filter(s => !s.start), prevNight), prevNight, endHere ? endPoi : lodge?.poi)
    // 看日出、赶早市、趁早人少的：当天第一站
    seq.sort((a, b) => Number(b.bestTime === 'morning') - Number(a.bestTime === 'morning'))
    for (const f of fixed) {
      let t = startMin, at = prevNight, k = 0
      let ate = false
      for (; k < seq.length; k++) {
        // 城际长途和展开时一样按高铁、飞机估（按开车估，上海到北京十几个小时，夜景就被排到了第一站）；中午那顿饭也算上
        t += !at ? 0 : mode !== 'selfDrive' && distanceKm(at, seq[k].poi) > LONG_HAUL_KM ? longHaul(at, seq[k].poi).min : estDriveMin(at, seq[k].poi)
        if (!ate && t + durOf(seq[k], pace) > LUNCH + 60) { t = Math.max(t, LUNCH - 60) + pace.mealMin; ate = true }
        if (t + durOf(seq[k], pace) > parseHM(f.start!)) break
        t += durOf(seq[k], pace); at = seq[k].poi
      }
      seq.splice(k, 0, f)
    }
    const nodes: Node[] = seq.map(x => { const stop = toStop(x); if (softCands.has(x)) softStart.add(stop.id); return { stop, poi: x.poi } })

    // 按真实车程展开：超过连续驾驶上限的一段拆成几段，中间停服务区。
    // 生成的服务区记下它在哪两个节点之间，饭点落在路上时可以就地改成「在服务区吃饭」
    const saOf = new Map<string, { gap: number; poi?: Poi; name: string; key: string }>()
    // 饭点落在路上：那次歇脚直接改成吃饭（按当天第几次歇脚记：后面再插站，前面歇脚的次序不变）。不另插一站——插的站定不准位置，会把车程带偏
    const saMeal = new Map<string, { which: 'lunch' | 'dinner'; label: string }>()
    const expand = async (list: Node[]): Promise<Stop[]> => {
      const out: Stop[] = []
      let at = prevNight
      let restNo = 0
      for (let gi = 0; gi < list.length; gi++) {
        const x = list[gi]
        // 这段路的去向：路过的服务区（歇脚、吃饭）不算，写真正要去的那站；回家写终点名
        const dest = list.slice(gi).find(n => !n.stop.tags?.includes('restroom')) ?? x
        const toName = dest.stop.home ? endRef!.name : dest.stop.name
        if (x.poi && at && mode !== 'selfDrive' && distanceKm(at, x.poi) > LONG_HAUL_KM) {
          // 不自驾的城际长途（去程、返程、换城市）：按高铁或飞机估一段，班次自己查
          const h = longHaul(at, x.poi)
          out.push({
            id: opts.newId('s'), kind: 'transit', name: `${h.by === 'rail' ? '高铁' : '飞机'} → ${toName}（估）`, durationMin: h.min, status: 'planned',
            why: h.by === 'rail' ? '按高铁粗估，含进出站约 1 小时；具体班次自己查' : '按飞机粗估，含往返机场、值机候机约 3 小时；具体航班自己查',
          })
          out.push({ ...x.stop, driveMin: undefined })
        } else if (x.poi && at) {
          const raw = await driveMin(at, x.poi)
          const m = trip.party.mode === 'transit' ? Math.round(raw * 1.4) : raw
          if (m > limit) {
            const parts = Math.ceil(m / (limit - 5))
            const each = Math.round(m / parts)
            // 歇脚的地方沿真实路线找（没有路线才用两点连线上的点：绕山路时连线上的点不在路上，找到的服务区在别的高速上）
            const r = await routeOf(at, x.poi)
            for (let i = 0; i < parts; i++) {
              out.push({ id: opts.newId('s'), kind: 'drive', name: `开车 → ${toName}`, durationMin: i === parts - 1 ? m - each * (parts - 1) : each, status: 'planned' })
              if (i < parts - 1) {
                const mid = r?.points.length ? along(r, ((i + 1) * each * r.minutes) / m) : { lng: at.lng + (x.poi.lng - at.lng) * (i + 1) / parts, lat: at.lat + (x.poi.lat - at.lat) * (i + 1) / parts }
                // 路上这一点的走向：沿路线前后各一分钟
                const tm = r?.points.length ? ((i + 1) * each * r.minutes) / m : 0
                const heading = r?.points.length ? (() => { const a = along(r, Math.max(0, tm - 1)), b = along(r, tm + 1); return { dx: b.lng - a.lng, dy: b.lat - a.lat } })() : { dx: x.poi.lng - at.lng, dy: x.poi.lat - at.lat }
                const sa = await pick('serviceArea', mid, true, heading)
                const id = opts.newId('s')
                const key = `rest${restNo++}`
                saOf.set(id, { gap: gi, poi: sa?.poi, name: sa?.name ?? '路上服务区', key })
                const eat = saMeal.get(key)
                out.push(eat
                  ? { id, kind: 'food', name: `${sa?.name ?? '路上服务区'}（${eat.label}）`, durationMin: Math.max(40, pace.mealMin - 15), status: 'planned', ...(sa ? { poi: sa.poi, suggested: true } : {}), priority: 3, tags: ['restroom'], why: `${eat.label}在路上的服务区吃，顺便歇脚` }
                  : { id, kind: 'rest', name: sa?.name ?? '路上服务区歇一歇', durationMin: REST_MIN, status: 'planned', ...(sa ? { poi: sa.poi, suggested: true } : {}), tags: ['restroom'], why: `连续开车 ${c.driveBreakMin.value} 分钟内要停一次` })
              }
            }
            out.push({ ...x.stop, driveMin: undefined })
          } else out.push({ ...x.stop, driveMin: m || undefined })
        } else out.push(x.stop)
        if (x.poi) at = x.poi
      }
      return out
    }
    const timeline = async (list: Node[]) => scheduleDay({ startTime: startOf(d), stops: await expand(list) })

    // —— 收尾：最后一天回到终点；其余天今晚住处（候选里的，或在最后一站附近找一个）。先放上，饭和午睡都排在它前面 ——
    let tail: Node
    if (endHere) {
      tail = { poi: endPoi, stop: { id: opts.newId('s'), kind: 'lodging', name: `回到${endRef!.name}`, durationMin: 0, status: 'planned', poi: endPoi, home: true, why: '行程终点' } }
    } else if (road[d]) {
      // 赶路日：开到当天能开的上限，在那附近找住处；找不到就留个带位置的占位（第二天从这接着开）
      const rd = road[d]!
      const leg = rd.leg === 'out' ? '去程' : '返程'
      const p = await pick('lodging', rd.at)
      tail = p
        ? { poi: p.poi, stop: { id: opts.newId('s'), kind: 'lodging', name: p.name, durationMin: 0, status: 'planned', poi: p.poi, suggested: true, why: `${leg}路上住一晚（今天开约 ${Math.round(rd.min / 6) / 10} 小时）${p.rating ? ` · 评分 ${p.rating}` : ''}；订之前确认电梯、能不能带宠物` } }
        : { poi: rd.at, stop: { id: opts.newId('s'), kind: 'lodging', name: LODGING_PLACEHOLDER, durationMin: 0, status: 'planned', poi: rd.at, why: `${leg}路上住一晚：开到这附近找住处` } }
    } else {
      // 今天没景点（一整天在路上）：住处找在明天第一站附近
      const lastPoi = [...nodes].reverse().find(x => x.poi)?.poi ?? daySights[d + 1]?.[0]?.poi ?? prevNight
      if (lodge) tail = { poi: lodge.poi, stop: { ...toStop(lodge), durationMin: 0 } }
      else if (prevLodge?.poi && lastPoi && distanceKm(prevLodge.poi, lastPoi) <= 10) {
        // 今天还在前一晚附近：连住，不换酒店
        tail = { poi: prevLodge.poi, stop: { ...prevLodge.stop, id: opts.newId('s'), why: '连住，不用换酒店' } }
      } else {
        const p = lastPoi ? await pick('lodging', lastPoi) : undefined
        tail = p
          ? { poi: p.poi, stop: { id: opts.newId('s'), kind: 'lodging', name: p.name, durationMin: 0, status: 'planned', poi: p.poi, suggested: true, why: `离最后一站近${p.rating ? ` · 评分 ${p.rating}` : ''}；订之前确认电梯、能不能带宠物` } }
          : { stop: { id: opts.newId('s'), kind: 'lodging', name: LODGING_PLACEHOLDER, durationMin: 0, status: 'planned' } }
      }
    }
    nodes.push(tail)

    // —— 午饭、晚饭：挑最接近饭点的空档（收尾那站之前）；落在路上就在那个服务区吃 ——
    const mine = [...dayFoods[d]]
    const meal = async (which: 'lunch' | 'dinner') => {
      const label = which === 'lunch' ? '午饭' : '晚饭'
      const target = which === 'lunch' ? LUNCH : DINNER
      const [lo, hi] = which === 'lunch' ? [11 * 60, 13 * 60 + 30] : [17 * 60, 19 * 60 + 30]
      saOf.clear()
      const slots = await timeline(nodes)
      if (slots.some(sl => sl.stop.kind === 'food' && Math.abs(sl.start - target) < 90)) return
      // 最后一天 19:30 前到家：晚饭回家吃
      if (which === 'dinner' && endHere && slots[slots.length - 1].start <= 19 * 60 + 30) { if (!tail.stop.why?.includes('到家吃午饭')) tail.stop = { ...tail.stop, why: '行程终点 · 到家吃晚饭' }; return }
      // 最后一天中午前就到家：午饭回家吃
      if (which === 'lunch' && endHere && slots[slots.length - 1].start <= 12 * 60 + 30) { tail.stop = { ...tail.stop, why: '行程终点 · 到家吃午饭' }; return }
      // 大景区（玩三个小时以上、跨过中午）：在中间切开，午饭在景区附近吃，不拖到逛完下午两三点
      if (which === 'lunch') {
        // 要午睡的：逛到午睡开始以后就切（卧龙逛到 12:47，吃完饭已经过了午睡点）；在午睡前半小时吃上饭，11:15 前不切；到了至少先逛 45 分钟
        const cutAt = c.nap ? Math.max(11 * 60 + 15, Math.min(12 * 60, c.nap.from - 30)) : 12 * 60
        const big = slots.find(sl => sl.stop.kind === 'sight' && sl.stop.durationMin >= (c.nap ? 150 : 180) && sl.start <= cutAt - 45 && sl.end >= (c.nap ? c.nap.from + 15 : 13 * 60))
        const bi = big ? nodes.findIndex(x => x.stop.id === big.stop.id) : -1
        if (big && bi >= 0) {
          const first = Math.max(45, Math.round((cutAt - big.start) / 5) * 5)
          const a = nodes[bi]
          const b: Node = { poi: a.poi, stop: { ...a.stop, id: opts.newId('s'), name: `${a.stop.name}（吃完接着逛）`, durationMin: a.stop.durationMin - first, driveMin: undefined, why: undefined, start: undefined } }
          a.stop = { ...a.stop, durationMin: first }
          if (fixedDur.has(a.stop.id)) fixedDur.add(b.stop.id)
          nodes.splice(bi + 1, 0, b)
          saOf.clear()
          return meal(which)
        }
      }
      const endOf = (i: number) => (i === 0 ? startMin : slots.find(sl => sl.stop.id === nodes[i - 1].stop.id)!.end)
      type Opt = { gap: number; t: number; sa?: { poi?: Poi; name: string; id: string; key: string }; atTail?: boolean; nearNext?: boolean }
      const opts2: Opt[] = []
      for (let i = 0; i < nodes.length; i++) {
        // 晚饭：空档后面是固定时刻的站（晚饭后看夜景），这顿可以在空档里晚点吃，只要赶得上那一站（午饭不这样挪）
        const fixedAt = which === 'dinner' && nodes[i].stop.start ? parseHM(nodes[i].stop.start!) : undefined
        const t0 = endOf(i)
        const t = fixedAt != null ? Math.max(t0, Math.min(target - 30, fixedAt - pace.mealMin - 15)) : t0
        opts2.push({ gap: i, t })
        // 到下一站的路长（45 分钟以上）：也可以先开过去、在它附近吃，按到的时刻算（开了三小时才到，不必等逛完再吃）
        const nx = slots.find(sl => sl.stop.id === nodes[i].stop.id)
        if (nx && nodes[i].poi && !nodes[i].stop.home && nx.start - t0 >= 30 && fixedAt == null) opts2.push({ gap: i, t: nx.start, nearNext: true })
      }
      for (const sl of slots) { const sa = saOf.get(sl.stop.id); if (sa) opts2.push({ gap: sa.gap, t: sl.start, sa: { ...sa, id: sl.stop.id } }) }
      // 转场那天（最后一站到住处要半小时以上，长途拆成几段开车 + 服务区也算在内）：晚饭还可以先开过去、到了在住处附近吃，按到的时刻算
      const tailSlot = slots[slots.length - 1]
      const arrive: Opt | undefined = which === 'dinner' && !endHere && tail.poi && tailSlot.start - endOf(nodes.length - 1) >= 30 ? { gap: nodes.length - 1, t: tailSlot.start, atTail: true } : undefined
      if (arrive) opts2.push(arrive)
      const inWin = opts2.filter(o => o.t >= lo && o.t <= hi)
      const gaps = opts2.filter(o => !o.sa && !o.atTail && !o.nearNext)
      // 饭点都不在窗口里（一整天在路上）：晚饭 21:30 前能到住处就到了再吃，其次路上离饭点最近的服务区，都没有才用最后一个空档
      // （以前退回到「第一个空档」= 出发前，再被推到 17:30，成了吃完晚饭才出发、开到半夜）
      // 路上的服务区只在傍晚以后才算晚饭（中午的服务区吃「晚饭」不像话）
      const onRoad = opts2.filter(o => o.sa && o.t >= 16 * 60 + 30)
      // 午饭窗口里没有空档：只在正常空档里挑（太早的会推到 11:30 再吃）；路上的服务区只认 10:45–14:15 那几次歇脚（不在 9:55 吃「午饭」）
      const lunchOk = opts2.filter(o => !o.atTail && (!o.sa || (o.t >= 10 * 60 + 45 && o.t <= 14 * 60 + 15)))
      const pool = inWin.length ? inWin : which === 'lunch' ? (lunchOk.length ? lunchOk : opts2)
        : arrive && arrive.t <= 21 * 60 + 30 ? [arrive] : onRoad.length ? onRoad : [gaps[gaps.length - 1]]
      // 窗口里有「到了再吃」就让它占点便宜（抵 30 分钟）：路上服务区吃不如到了找个像样的馆子
      // 有午睡：午饭吃完已经过了午睡开始半小时的，扣分（先吃再逛，睡得上）
      const off = (x: Opt) => Math.abs(x.t - target) - (x.atTail ? 30 : 0) + (which === 'lunch' && c.nap && x.t + pace.mealMin > c.nap.from + 30 ? 40 : 0)
      let o = pool.reduce((a, x) => (off(x) < off(a) ? x : a))
      // 一天有两个以上景点、却全排在午饭前：看要不要把最后一个挪到午饭后（有午睡就在午睡后）。
      // 不挪的代价是午饭吃晚了、挤掉午睡；挪的代价是上午干等（剩下的景点拉不长时）。下午空着的交给后面的「就近补一个」
      if (which === 'lunch' && !o.sa) {
        const sightAt = nodes.map((x, i) => (x.stop.kind === 'sight' ? i : -1)).filter(i => i >= 0)
        const last = sightAt[sightAt.length - 1]
        const alt = gaps.find(x => x.gap === last)
        if (sightAt.length >= 2 && sightAt.every(i => i < o.gap) && alt) {
          // 两种排法各算一个代价，挑小的：午饭晚过 12:30 每分钟算 2；有午睡而午饭吃到午睡开始半小时后，再加 60；挪了的话上午干等多少算多少
          const canGrow = sightAt.slice(0, -1).reduce((a, i) => a + (fixedDur.has(nodes[i].stop.id) ? 0 : Math.min(nodes[i].stop.durationMin * (STRETCH_X - 1), STRETCH_MAX - nodes[i].stop.durationMin)), 0)
          const late = (t: number) => Math.max(0, t - (12 * 60 + 30)) * 2 + (c.nap && t + pace.mealMin > c.nap.from + 30 ? 60 : 0)
          const stay = late(o.t)
          const move = Math.max(0, 11 * 60 + 30 - (alt.t + canGrow)) + late(Math.max(alt.t, 11 * 60 + 30))
          if (move < stay) o = alt
        }
      }
      // 要求在哪附近吃这顿：就在那儿找（车程照实算）
      const anchor = which === 'lunch' ? tw?.lunchNear : tw?.dinnerNear
      // 后面接着的是固定时刻的站（晚饭后看夜景），而且离上一站远：先开过去，在它附近吃（不吃完再开夜路）
      // 只管晚饭：午饭后面接着晚上的站（双廊逛完要开三个小时去丽江古城看夜景），午饭照样在双廊吃，不饿着开过去
      const nextFixed = which === 'dinner' && !o.sa && !o.atTail && nodes[o.gap]?.stop.start ? nodes[o.gap] : undefined
      const prevPoi = nodes[o.gap - 1]?.poi ?? prevNight
      const goFirst = !!(nextFixed?.poi && prevPoi && est(prevPoi, nextFixed.poi) >= 25)
      const near = anchor?.poi ?? o.sa?.poi ?? (o.atTail ? tail.poi : undefined) ?? ((goFirst || o.nearNext) ? nodes[o.gap].poi : undefined) ?? nodes[o.gap - 1]?.poi ?? nodes[o.gap]?.poi ?? lodge?.poi ?? prevNight
      let food: Node
      if (anchor && !mine.length) {
        progress(`第 ${d + 1} 天在${anchor.name}附近找${label}`)
        const p = await pick('food', anchor.poi)
        food = p
          ? { poi: p.poi, meal: which, stop: { id: opts.newId('s'), kind: 'food', name: p.name, durationMin: pace.mealMin, status: 'planned', poi: p.poi, priority: 3, suggested: true, why: `按你的要求在${anchor.name}附近吃${p.rating ? ` · 评分 ${p.rating}` : ''}` } }
          : { poi: anchor.poi, meal: which, stop: { id: opts.newId('s'), kind: 'food', name: `${label}（${anchor.name}附近）`, durationMin: pace.mealMin, status: 'planned', poi: anchor.poi, priority: 3, why: `按你的要求在${anchor.name}附近吃，到时就近找` } }
      } else if (mine.length) {
        const f = near ? [...mine].sort((a, b) => distanceKm(a.poi, near) - distanceKm(b.poi, near))[0] : mine[0]
        mine.splice(mine.indexOf(f), 1)
        food = { stop: toStop(f), poi: f.poi, meal: which }
      } else if (o.sa) {
        // 路上那次歇脚改成吃饭，不另插一站
        saMeal.set(o.sa.key, { which, label })
        return
      } else {
        progress(`第 ${d + 1} 天找${label}`)
        const p = near ? await pick('food', near) : undefined
        food = p
          ? { poi: p.poi, meal: which, stop: { id: opts.newId('s'), kind: 'food', name: p.name, durationMin: pace.mealMin, status: 'planned', poi: p.poi, priority: 3, suggested: true, why: o.atTail ? `${label}：到了再吃，离${tail.stop.name}近${p.rating ? ` · 评分 ${p.rating}` : ''}` : `${label}：离${((goFirst || o.nearNext) ? nodes[o.gap] : nodes[o.gap - 1])?.stop.name ?? '住处'}近${p.rating ? ` · 评分 ${p.rating}` : ''}` } }
          : { meal: which, stop: { id: opts.newId('s'), kind: 'food', name: `${label}（附近找）`, durationMin: pace.mealMin, status: 'planned', priority: 3, why: '没找到合适的，到时就近' } }
      }
      // 这顿定在空档里晚一点的时刻（后面接着固定时刻的站）：真等到那时再吃，不然会挨着上一顿排下来
      if (nextFixed && !food.stop.start) {
        const lead = goFirst && prevPoi && food.poi ? est(prevPoi, food.poi) : 0
        const at = Math.max(o.t, endOf(o.gap) + lead)
        if (at > endOf(o.gap) + lead + 10) { food.stop = { ...food.stop, start: fmtHM(Math.ceil(at / 5) * 5) }; softStart.add(food.stop.id) }
      }
      nodes.splice(o.gap, 0, food)
    }
    // 去程、返程那天就算没景点，路上也要吃饭
    const travelDay = (d === 0 && !!origin) || endHere || !!road[d] || (d === firstRegion && d > 0)
    if (daySights[d].length || mine.length || travelDay) { await meal('lunch'); await meal('dinner') }
    for (const f of mine) nodes.splice(nodes.length - 1, 0, { stop: toStop(f), poi: f.poi })

    // 饭点来得太早（逛完了才下午三点）：最后再定，到饭点再吃。前面插了午睡、拆了长途都已经算进去了；后面砍了站还要再推一次
    const deferMeals = async () => {
      for (const which of ['lunch', 'dinner'] as const) {
        const m = nodes.find(x => x.meal === which)
        // 最后一天晚饭在回家路上吃，不为等饭点拖晚到家
        // 路上服务区吃的、赶路日的：不为等饭点停下来干等
        if (!m || m.stop.start || (endHere && which === 'dinner') || m.stop.tags?.includes('restroom')) continue
        saOf.clear()
        const sl = (await timeline(nodes)).find(x => x.stop.id === m.stop.id)!
        if (sl.start < MEAL_AT[which] - 45) { m.stop.start = fmtHM(MEAL_AT[which] - 30); softStart.add(m.stop.id) }
      }
    }
    // 景点全挤在上午、下午干等晚饭（灵隐寺、西溪湿地都在午饭前，下午空着）：把午饭前最后一个挪到午饭后。
    // 挪了不能更晚回住处、路上也不能多开半小时以上
    {
      const li = nodes.findIndex(x => x.meal === 'lunch')
      const di = nodes.findIndex(x => x.meal === 'dinner')
      const end = di >= 0 ? di : nodes.length - 1
      const movable = (x: Node) => x.stop.kind === 'sight' && !x.stop.start && !softStart.has(x.stop.id)
      const am = li > 0 ? nodes.slice(0, li).filter(movable) : []
      const pm = li >= 0 ? nodes.slice(li + 1, end).filter(x => x.stop.kind === 'sight') : []
      if (am.length >= 2 && !pm.length) {
        const mv = am[am.length - 1]
        const moved = nodes.filter(x => x !== mv)
        moved.splice(moved.findIndex(x => x.meal === 'lunch') + 1, 0, mv)
        saOf.clear()
        const before = await timeline(nodes)
        saOf.clear()
        const after = await timeline(moved)
        const drv = (sl: typeof before) => sl.reduce((a, x) => a + x.start - x.departAt, 0)
        const lunchAt = after.find(x => x.stop.id === nodes[li].stop.id)!.start
        if (after[after.length - 1].end <= Math.max(before[before.length - 1].end, c.endBy.value) && drv(after) <= drv(before) + 30 && lunchAt >= 10 * 60 + 30) nodes.splice(0, nodes.length, ...moved)
      }
    }
    // 先把饭点定好，再看午睡：不然这时中午看着空（午饭还没推到饭点、景点还没拉长），就不留午睡了
    await deferMeals()

    // —— 午睡：窗口里能睡的时间（路上、休息、住处、空档）不够一小时，就留一段。
    // 放午饭后还是午饭前、睡多久，逐个试：先保午饭不晚于 13:30，再求睡够，其次睡得久
    if (c.nap && nodes.length) {
      const { from, to } = c.nap
      const ov = (a0: number, a1: number) => Math.max(0, Math.min(a1, to) - Math.max(a0, from))
      const friendly = (k: Stop['kind'], tags?: Stop['tags']) => k === 'drive' || k === 'transit' || k === 'rest' || k === 'lodging' || !!tags?.includes('napOk')
      const napOf = async (list: Node[]) => {
        saOf.clear()
        const slots = await timeline(list)
        const sleep = slots.reduce((a, sl) => a + (friendly(sl.stop.kind, sl.stop.tags) ? ov(sl.start, sl.end) : 0) + ov(sl.departAt, sl.start), 0)
        const busy = slots.reduce((a, sl) => a + ov(sl.departAt, sl.end), 0)
        const lunch = list.find(x => x.meal === 'lunch')
        return { got: sleep + (to - from - busy), lunchAt: lunch ? slots.find(sl => sl.stop.id === lunch.stop.id)!.start : 0, end: slots[slots.length - 1]?.end ?? 0 }
      }
      const base = await napOf(nodes)
      if (base.got < 60) {
        const li = nodes.findIndex(x => x.meal === 'lunch')
        // 回今晚的住处睡（第一天前一晚是家，远；住处先定好了就看它）
        const home = tail.poi ?? lodge?.poi ?? prevNight
        const spots = li >= 0 ? [li + 1, li] : [nodes.length - 1]
        let best: { list: Node[]; got: number } | undefined
        for (const k of spots) {
          const here = nodes[k - 1]?.poi
          const back = !!(here && home && (await driveMin(here, home)) <= 25)
          for (const len of [120, 90, 60].map(m => Math.min(m, to - from))) {
            const nap: Node = back
              ? { poi: home, stop: { id: opts.newId('s'), kind: 'rest', name: '回住处午睡', durationMin: len, status: 'planned', poi: home, tags: ['napOk'], why: `${fmtHM(from)}–${fmtHM(to)} 午睡` } }
              : { stop: { id: opts.newId('s'), kind: 'rest', name: '车上或就近午睡', durationMin: len, status: 'planned', tags: ['napOk'], why: '住处太远，就近找能躺的地方或在车上睡' } }
            const list = [...nodes.slice(0, k), nap, ...nodes.slice(k)]
            const r = await napOf(list)
            // 午饭不能被挤过 13:30（两岁孩子下午三点才吃午饭比少睡一会儿糟）；睡得够的里挑先试到的（饭后、睡得久）
            // 也不能为了午睡拖到回住处太晚（最后一天逛完故宫还要坐五个小时车：孩子在车上睡）
            if (r.lunchAt > 13 * 60 + 30 || r.got < 60 || (r.end > c.endBy.value + LATE_GRACE_MIN && r.end > base.end)) continue
            best = { list, got: r.got }
            break
          }
          if (best) break
        }
        if (best) nodes.splice(0, nodes.length, ...best.list)
        // 怎么排都睡不够：不硬插一段白白拖长一天的休息；午睡只是建议，不另外提醒
      }
    }


    // —— 空档补满：等待时间（到饭点、到预约时刻）先拉长前一个景点；下午还空一大段就就近补一个 ——
    // 路上服务区吃的饭不是单独一站（歇脚改成的），也要算进去
    // 游玩只算景点：吃饭是坐下来歇着
    const activeNow = () => nodes.reduce((a, x) => a + (x.stop.kind === 'sight' ? x.stop.durationMin : 0), 0)
    const baseDur = new Map(nodes.map(x => [x.stop.id, x.stop.durationMin]))
    const stretch = async () => {
      for (let guard = 0; guard < 6; guard++) {
        saOf.clear()
        const slots = await timeline(nodes)
        let changed = false
        for (let i = 1; i < slots.length; i++) {
          const wait = slots[i].departAt - slots[i - 1].end
          if (wait < 20) continue
          const prev = nodes.find(x => x.stop.id === slots[i - 1].stop.id)
          if (!prev || prev.stop.kind !== 'sight' || fixedDur.has(prev.stop.id)) continue
          const b = baseDur.get(prev.stop.id) ?? prev.stop.durationMin
          // 下午自动补的（神田明神这种）最多拉到两小时：本来就是凑空档的，不值得逛三个半小时
          let room = Math.min(wait, b * STRETCH_X - prev.stop.durationMin, STRETCH_MAX - prev.stop.durationMin, activeCap - activeNow(), prev.stop.suggested ? Math.max(b, 120) - prev.stop.durationMin : Infinity)
          // 要午睡、这天又没专门插午睡（中午的空档就是睡觉的时候）：拉长不许伸进午睡时段
          if (c.nap && !nodes.some(x => x.stop.tags?.includes('napOk'))) {
            const endAt = slots[i - 1].end
            room = endAt >= c.nap.from ? (endAt >= c.nap.to ? room : 0) : Math.min(room, c.nap.from - endAt)
          }
          if (room >= 15) { prev.stop = { ...prev.stop, durationMin: prev.stop.durationMin + Math.floor(room / 5) * 5 }; changed = true }
        }
        if (!changed) break
      }
    }
    await stretch()
    // 补的景点避开午睡：有午睡就从午睡结束后开始；每天最多补两个，全天游玩不超过上限。要求排松一点的那天不补
    // 赶路日不补景点：开够了就住下
    if (tools.nearby && !tw?.lighter && !road[d]) {
      for (let added = 0; added < 2; added++) {
        saOf.clear()
        const slots = await timeline(nodes)
        const lunchId = nodes.find(x => x.meal === 'lunch')?.stop.id
        const li = slots.findIndex(sl => sl.stop.id === lunchId)
        let done = false
        for (let i = Math.max(1, li + 1); i < slots.length && !done; i++) {
          const next = nodes.findIndex(x => x.stop.id === slots[i].stop.id)
          const from = [...nodes.slice(0, next)].reverse().find(x => x.poi)?.poi
          const left = activeCap - activeNow()
          const freeFrom = c.nap && slots[i - 1].end < c.nap.to ? Math.max(slots[i - 1].end, c.nap.to) : slots[i - 1].end
          const avail = slots[i].departAt - freeFrom
          if (avail < 90 || left < 60 || next < 0 || !from) continue
          progress(`第 ${d + 1} 天下午空着，就近找一个`)
          const p = await pick('sight', from)
          if (!p) { done = true; break }
          // 按出行方式估（公共交通比开车慢），免得补的景点把晚饭挤晚
          const legIn = est(from, p.poi)
          const to = nodes[next].poi ?? p.poi
          const dur = Math.floor(Math.min(150, avail - legIn - est(p.poi, to) - 10, left) / 5) * 5
          if (dur < 45) continue
          const at = freeFrom + legIn
          nodes.splice(next, 0, { poi: p.poi, stop: {
            id: opts.newId('s'), kind: 'sight', name: p.name, durationMin: dur, status: 'planned', poi: p.poi, priority: 3, suggested: true,
            // 等午睡结束再去
            ...(at > slots[i - 1].end + legIn + 5 ? { start: fmtHM(Math.ceil(at / 5) * 5) } : {}),
            why: `下午空着，就近加一个${p.rating ? ` · 评分 ${p.rating}` : ''}；不想去可以删`,
          } })
          // 按真实车程再排一遍：后面那站（多半是晚饭）被推迟了多少，补的就缩短多少；缩到 45 分钟以下就不补了
          const added = nodes[next]
          saOf.clear()
          const after = (await timeline(nodes)).find(sl => sl.stop.id === slots[i].stop.id)!
          const over = after.start - slots[i].start
          if (over > 0) {
            const cut = Math.floor((dur - over) / 5) * 5
            if (cut < 45) { nodes.splice(next, 1); continue }
            added.stop = { ...added.stop, durationMin: cut }
          }
          done = true
        }
        if (!done) break
      }
    }
    // 补完再拉一次：补的那个逛完离晚饭还早，就多逛会儿，不在门口干等
    await stretch()

    progress(`第 ${d + 1} 天查车程`)
    saOf.clear()
    // 排程自己定的时刻，前面的站没完就让位顺延（不报冲突）
    for (let pass = 0; pass < 3; pass++) {
      saOf.clear()
      const sl = await timeline(nodes)
      const clash = sl.filter(x => x.overlap && softStart.has(x.stop.id))
      if (!clash.length) break
      for (const x of clash) { const n = nodes.find(y => y.stop.id === x.stop.id); if (n) n.stop = { ...n.stop, start: undefined } }
    }
    // 一天排完还是太晚（超过回住处的时刻加宽限）：先去掉下午补的；再在「想去」里逐个试去掉哪个最能提早结束（离得最远、最绕路的那个），
    // 不按「最费时的先砍」——东京第 3 天明治神宫、台场、东京塔各在一头，按时长砍把三个全砍光了，其实去掉台场就够。必去的、自己定了时刻的不动
    for (let k = 0; k < 4 && !road[d]; k++) {
      saOf.clear()
      const sl = await timeline(nodes)
      const endAt = sl[sl.length - 1]?.end ?? 0
      if (endAt <= c.endBy.value + LATE_GRACE_MIN) break
      const pool = nodes.filter(x => x.stop.kind === 'sight' && !x.stop.start && (x.stop.suggested && !stopCand.has(x.stop.id) || (stopCand.has(x.stop.id) && !stopCand.get(x.stop.id)!.must)))
      let drop = pool.find(x => !stopCand.has(x.stop.id))
      if (!drop && pool.length) {
        let best = Infinity
        for (const x of pool) {
          saOf.clear()
          const tl = await timeline(nodes.filter(y => y !== x))
          // 提早得一样多时，先去掉玩得短的（少丢点游玩时间）
          const score = (tl[tl.length - 1]?.end ?? 0) + x.stop.durationMin / 1000
          if (score < best) { best = score; drop = x }
        }
      }
      if (!drop) break
      nodes.splice(nodes.indexOf(drop), 1)
      const cand0 = stopCand.get(drop.stop.id)
      if (cand0) unplaced.push({ candidate: cand0, reason: `第 ${d + 1} 天排到 ${fmtHM(endAt)} 才结束，超过 ${fmtHM(c.endBy.value)} 回住处` })
      await deferMeals()
    }
    const stops = await expand(nodes)
    outDays.push({ startTime: startOf(d), stops })
    // 赶路日、长途拆开后到的那天：开多久前面已经说过了
    if (travelDay && !road[d] && !(d === firstRegion && d > 0)) {
      const legMin = stops.reduce((a, s) => a + (s.kind === 'drive' || s.kind === 'transit' ? s.durationMin : s.driveMin ?? 0), 0)
      if (legMin > 8 * 60) notes.push(`第 ${d + 1} 天${endHere ? '返程' : '去程'}路上约 ${Math.round(legMin / 6) / 10} 小时，太累的话考虑早点出发或中途住一晚`)
    }
    prevNight = tail.poi ?? prevNight
    prevLodge = tail
  }

  const out: Trip = { ...trip, days: outDays }
  const issues = out.days.flatMap((_, i) => checkDay(out, i)).filter(i => i.level !== 'tip')
  const placeholders = out.days.flatMap(d => d.stops).filter(s => !s.poi && s.kind !== 'drive').length
  if (!tools.drive) notes.push('没有高德 Key：车程按直线距离估算')
  if (placeholders) notes.push(`${placeholders} 处吃饭、休息或住处还没定具体地方，到时就近`)
  return { trip: out, unplaced, extraDaysNeeded, issues, notes }
}
