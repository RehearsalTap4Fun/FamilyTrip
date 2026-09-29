// 排程引擎（流程一，也是流程二和导入攻略的公共后半段）：给一组要去的点，按同行人的限制排成每天的行程。
//   分天（地理成串 → 按每天可玩时长切段，靠近当晚住处）→ 放不下就砍「想去」→ 天内顺路 → 固定时刻就位
//   → 插午饭晚饭 → 留午睡 → 真实车程、超连开拆段插服务区 → 住处。
// 有起点终点（默认现居地）时：第一天从起点出发、最后一天以回到终点收尾，这两段路程算进当天；不自驾的长途按高铁、飞机估。
// 车程、周边搜索由调用方注入（网页用高德），这里只管排；没有工具时用直线估算和占位，照样能出一版。
import { deriveConstraints, type Constraints } from './constraints'
import { distanceKm, estDriveMin, estLegMin, LONG_HAUL_KM, longHaul } from './geo'
import { partyOnDay } from './party'
import { fmtHM, parseHM, scheduleDay } from './schedule'
import type { DayTweak, PlanPlace, Poi, Stop, Trip, TripStyle } from './types'
import { checkDay, LODGING_PLACEHOLDER, type Issue } from './validate'

/** 排程的输入就是行程计划里的地点 */
export type Candidate = PlanPlace

export interface NearbyPlace { name: string; poi: Poi; rating?: number; distanceM?: number }

export type NearbyKind = 'food' | 'lodging' | 'serviceArea' | 'sight'

export interface PlanTools {
  /** 两点真实车程（分钟）；拿不到返回 null，改用估算 */
  drive?: (a: Poi, b: Poi) => Promise<number | null>
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
  return Math.max(load - b.cap, load + 2 * pace.mealMin + drive - b.span)
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
    return r * r + ex * 100 + far + off
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
  const capOf = (d: number) => Math.max(60, (cons[d].activeMin.value - 2 * pace.mealMin) * (tweakOf(d)?.lighter ? 0.75 : 1))
  const maxCap = Math.max(...trip.days.map((_, d) => capOf(d)))
  const sights = candidates.filter(c => c.kind === 'sight').map(c => {
    const dur = durOf(c, pace)
    if (dur <= maxCap) return c
    const fit = Math.floor(maxCap / 10) * 10
    notes.push(`${c.name}估的要玩 ${dur} 分钟，按你们的节奏一天最多 ${fit} 分钟，挑重点逛`)
    return { ...c, durationMin: fit }
  })
  const foods = candidates.filter(c => c.kind === 'food')
  const lodgings = candidates.filter(c => c.kind === 'lodging')

  // —— 住处：指定了哪晚就是哪晚；只给了一处又没说哪晚，当整趟的大本营 ——
  const night: (Candidate | undefined)[] = new Array(days).fill(undefined)
  // 住处：指定的晚上优先；原文 / 方案里说的那晚（prefDay）其次
  for (const l of lodgings) { const d = clampDay(l.day); if (d != null && !night[d]) night[d] = l }
  for (const l of lodgings) { const d = clampDay(l.prefDay); if (l.day == null && d != null && !night[d]) night[d] = l }
  const looseLodging = lodgings.filter(l => clampDay(l.day ?? l.prefDay) == null)
  if (looseLodging.length === 1 && lodgings.length === 1) for (let d = 0; d < days; d++) night[d] = looseLodging[0]
  // 最后一天回终点，不住了
  const endPoi = opts.end?.poi
  if (endPoi) night[days - 1] = undefined
  const mode = trip.party.mode
  const est = (a: Poi, b: Poi) => estLegMin(a, b, mode)
  const local = (q?: Poi) => (q && sights.some(s => distanceKm(s.poi, q) <= 80) ? q : undefined)
  // 没住处的晚上：沿用前一晚（多半是连住）；第一晚没有就留空，排完再在附近找
  const budgets = (): DayBudget[] => cons.map((c, d) => {
    const from = d === 0 ? opts.origin : night[d - 1]?.poi
    const to = d === days - 1 && endPoi ? endPoi : night[d]?.poi
    return { cap: capOf(d), span: Math.max(120, c.endBy.value - parseHM(startOf(d))), from, to, est, near: [local(from), local(to)].filter((q): q is Poi => !!q) }
  })

  // —— 分天，放不下就砍 ——
  progress('分天')
  let free = sights.filter(s => clampDay(s.day) == null)
  const pinnedAll = sights.filter(s => clampDay(s.day) != null)
  const unplaced: Unplaced[] = []
  const pinnedOn = () => Array.from({ length: days }, (_, d) => pinnedAll.filter(s => clampDay(s.day) === d))
  let daySights: Candidate[][] = []
  for (let guard = 0; guard < 200; guard++) {
    const order = chainByPref(free, opts.origin ?? night[0]?.poi)
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
    const leg = worst === days - 1 && endPoi ? '返程' : worst === 0 && opts.origin ? '去程' : ''
    const road = leg ? estPath([b[worst].from, ...daySights[worst].map(x => x.poi), b[worst].to].filter((q): q is Poi => !!q), est) : 0
    unplaced.push({ candidate: drop, reason: leg
      ? `第 ${worst + 1} 天放不下：这天${leg}路上约 ${Math.round(road / 6) / 10} 小时，${fmtHM(c.endBy.value)} 前要${leg === '返程' ? '到家' : '到住处'}`
      : `第 ${worst + 1} 天放不下：每天在外 ${c.activeMin.value / 60} 小时（两顿饭占 ${2 * pace.mealMin} 分），留给景点 ${cap} 分；${fmtHM(c.endBy.value)} 前回住处` })
    free = free.filter(x => x !== drop)
    const pi = pinnedAll.indexOf(drop)
    if (pi >= 0) pinnedAll.splice(pi, 1)
  }
  const b0 = budgets()
  const over = daySights.reduce((a, ss, d) => a + Math.max(0, excessOf(b0[d], ss, pace)), 0)
  const avgCap = b0.reduce((a, x) => a + x.cap, 0) / days
  const extraDaysNeeded = over > 0 ? Math.ceil(over / avgCap) : 0

  // 吃饭的点：指定了日子的按日子，没指定的给离得最近的那天
  const dayFoods: Candidate[][] = Array.from({ length: days }, () => [])
  for (const f of foods) {
    let d = clampDay(f.day ?? f.prefDay)
    if (d == null) {
      let bd = 0, bk = Infinity
      daySights.forEach((ss, i) => { for (const s of ss) { const k = distanceKm(s.poi, f.poi); if (k < bk) { bk = k; bd = i } } })
      d = bd
    }
    dayFoods[d].push(f)
  }

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
  // 已经在要去的地方里的不再被推荐一遍（免得同一家吃两顿、下午补的景点和要去的重复）
  const used = new Set<string>(candidates.map(c => c.name))
  const sightPois = candidates.filter(c => c.kind === 'sight').map(c => c.poi)
  const sightNames = candidates.filter(c => c.kind === 'sight').map(c => c.name.replace(/[（(].*$/, '').replace(/(景区|风景区|旅游区|文化旅游区)$/, '')).filter(n => n.length >= 2)
  const whyText = candidates.map(c => c.why ?? '').join(' ')
  // 用户（或攻略、方案）给了时长的站：补空档时不去拉长它
  const fixedDur = new Set<string>()
  const nearbyCache = new Map<string, NearbyPlace | undefined>()
  const pick = async (what: NearbyKind, at: Poi, reuse = false): Promise<NearbyPlace | undefined> => {
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
    const ok = list.filter(p => distanceKm(at, p.poi) <= NEAR_KM[what] && tools.verdictOf?.(p) !== 'black' && (what === 'serviceArea' || !used.has(p.name)) && !inside(p) && !junk(p))
    // 景点评分和远近一起看（每远 10 公里抵 1 分），免得为了高 0.1 分跑老远；吃饭住处只看评分
    const score = (p: NearbyPlace) => (p.rating ?? 0) - (what === 'sight' ? distanceKm(at, p.poi) / 10 : 0)
    ok.sort((a, b) => red(b) - red(a) || score(b) - score(a))
    const got = ok[0]
    if (got && what !== 'serviceArea') used.add(got.name)
    nearbyCache.set(key, got)
    return got
  }

  const toStop = (c: Candidate): Stop => {
    const id = opts.newId('s')
    if (c.durationMin != null) fixedDur.add(id)
    return toStopWith(c, id)
  }
  const toStopWith = (c: Candidate, id: string): Stop => ({
    id, kind: c.kind, name: c.name, durationMin: durOf(c, pace), status: 'planned', poi: c.poi,
    priority: c.must ? 1 : 2, ...(c.start ? { start: c.start } : {}), ...(c.suggested ? { suggested: true } : {}), ...(c.why ? { why: c.why } : {}), ...(c.tags ? { tags: c.tags } : {}),
    ...(c.walkKm != null ? { walkKm: c.walkKm } : {}), ...(c.altitudeM != null ? { altitudeM: c.altitudeM } : {}),
  })

  const outDays: Trip['days'] = []
  let prevNight: Poi | undefined = opts.origin
  let prevLodge: Node | undefined
  for (let d = 0; d < days; d++) {
    progress(`排第 ${d + 1}/${days} 天`)
    const c = cons[d]
    const tw = tweakOf(d)
    const startMin = parseHM(startOf(d))
    // 这天的游玩上限：要求排松一点就打八折
    const activeCap = c.activeMin.value * (tw?.lighter ? 0.8 : 1)
    const limit = trip.party.mode === 'selfDrive' && Number.isFinite(c.driveBreakMin.value) ? c.driveBreakMin.value : Infinity
    // 最后一天回终点（家）；其余天今晚住处：指定的，或没指定晚上的候选里离今天的点近的
    const endHere = d === days - 1 && !!opts.end
    let lodge = night[d]
    if (!endHere && !lodge && looseLodging.length && daySights[d].length) {
      const last = daySights[d][daySights[d].length - 1].poi
      lodge = [...looseLodging].sort((a, b) => distanceKm(a.poi, last) - distanceKm(b.poi, last))[0]
    }

    // 天内顺路（前一晚住处 → 今晚住处），再把固定时刻的点按估算时间插到对得上的位置
    const fixed = daySights[d].filter(s => s.start).sort((a, b) => parseHM(a.start!) - parseHM(b.start!))
    const seq = twoOpt(chain(daySights[d].filter(s => !s.start), prevNight), prevNight, endHere ? endPoi : lodge?.poi)
    for (const f of fixed) {
      let t = startMin, at = prevNight, k = 0
      for (; k < seq.length; k++) {
        t += at ? estDriveMin(at, seq[k].poi) : 0
        if (t + durOf(seq[k], pace) > parseHM(f.start!)) break
        t += durOf(seq[k], pace); at = seq[k].poi
      }
      seq.splice(k, 0, f)
    }
    const nodes: Node[] = seq.map(x => ({ stop: toStop(x), poi: x.poi }))

    // 按真实车程展开：超过连续驾驶上限的一段拆成几段，中间停服务区。
    // 生成的服务区记下它在哪两个节点之间，饭点落在路上时可以就地改成「在服务区吃饭」
    const saOf = new Map<string, { gap: number; poi?: Poi; name: string }>()
    const expand = async (list: Node[]): Promise<Stop[]> => {
      const out: Stop[] = []
      let at = prevNight
      for (let gi = 0; gi < list.length; gi++) {
        const x = list[gi]
        // 这段路的去向：路过的服务区（歇脚、吃饭）不算，写真正要去的那站；回家写终点名
        const dest = list.slice(gi).find(n => !n.stop.tags?.includes('restroom')) ?? x
        const toName = dest.stop.home ? opts.end!.name : dest.stop.name
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
            for (let i = 0; i < parts; i++) {
              out.push({ id: opts.newId('s'), kind: 'drive', name: `开车 → ${toName}`, durationMin: i === parts - 1 ? m - each * (parts - 1) : each, status: 'planned' })
              if (i < parts - 1) {
                const mid = { lng: at.lng + (x.poi.lng - at.lng) * (i + 1) / parts, lat: at.lat + (x.poi.lat - at.lat) * (i + 1) / parts }
                const sa = await pick('serviceArea', mid, true)
                const id = opts.newId('s')
                saOf.set(id, { gap: gi, poi: sa?.poi, name: sa?.name ?? '路上服务区' })
                out.push({ id, kind: 'rest', name: sa?.name ?? '路上服务区歇一歇', durationMin: REST_MIN, status: 'planned', ...(sa ? { poi: sa.poi, suggested: true } : {}), tags: ['restroom'], why: `连续开车 ${c.driveBreakMin.value} 分钟内要停一次` })
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
      tail = { poi: endPoi, stop: { id: opts.newId('s'), kind: 'lodging', name: `回到${opts.end!.name}`, durationMin: 0, status: 'planned', poi: endPoi, home: true, why: '行程终点' } }
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
      const [lo, hi] = which === 'lunch' ? [11 * 60 + 15, 13 * 60 + 30] : [17 * 60, 19 * 60 + 30]
      saOf.clear()
      const slots = await timeline(nodes)
      if (slots.some(sl => sl.stop.kind === 'food' && Math.abs(sl.start - target) < 90)) return
      // 最后一天 19:30 前到家：晚饭回家吃
      if (which === 'dinner' && endHere && slots[slots.length - 1].start <= 19 * 60 + 30) { tail.stop = { ...tail.stop, why: '行程终点 · 到家吃晚饭' }; return }
      const endOf = (i: number) => (i === 0 ? startMin : slots.find(sl => sl.stop.id === nodes[i - 1].stop.id)!.end)
      type Opt = { gap: number; t: number; sa?: { poi?: Poi; name: string; id: string } }
      const opts2: Opt[] = []
      for (let i = 0; i < nodes.length; i++) opts2.push({ gap: i, t: endOf(i) })
      for (const sl of slots) { const sa = saOf.get(sl.stop.id); if (sa) opts2.push({ gap: sa.gap, t: sl.start, sa: { ...sa, id: sl.stop.id } }) }
      const inWin = opts2.filter(o => o.t >= lo && o.t <= hi)
      const gaps = opts2.filter(o => !o.sa)
      const pool = inWin.length ? inWin : which === 'lunch' ? opts2 : [gaps[gaps.length - 1]]
      let o = pool.reduce((a, x) => (Math.abs(x.t - target) < Math.abs(a.t - target) ? x : a))
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
      const near = anchor?.poi ?? o.sa?.poi ?? nodes[o.gap - 1]?.poi ?? nodes[o.gap]?.poi ?? lodge?.poi ?? prevNight
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
        food = { poi: o.sa.poi, meal: which, stop: { id: opts.newId('s'), kind: 'food', name: `${o.sa.name}（${label}）`, durationMin: Math.max(40, pace.mealMin - 15), status: 'planned', ...(o.sa.poi ? { poi: o.sa.poi } : {}), priority: 3, suggested: true, tags: ['restroom'], why: `${label}在路上的服务区吃，顺便歇脚` } }
      } else {
        progress(`第 ${d + 1} 天找${label}`)
        const p = near ? await pick('food', near) : undefined
        food = p
          ? { poi: p.poi, meal: which, stop: { id: opts.newId('s'), kind: 'food', name: p.name, durationMin: pace.mealMin, status: 'planned', poi: p.poi, priority: 3, suggested: true, why: `${label}：离${nodes[o.gap - 1]?.stop.name ?? '住处'}近${p.rating ? ` · 评分 ${p.rating}` : ''}` } }
          : { meal: which, stop: { id: opts.newId('s'), kind: 'food', name: `${label}（附近找）`, durationMin: pace.mealMin, status: 'planned', priority: 3, why: '没找到合适的，到时就近' } }
      }
      nodes.splice(o.gap, 0, food)
    }
    // 去程、返程那天就算没景点，路上也要吃饭
    const travelDay = (d === 0 && !!opts.origin) || endHere
    if (daySights[d].length || mine.length || travelDay) { await meal('lunch'); await meal('dinner') }
    for (const f of mine) nodes.splice(nodes.length - 1, 0, { stop: toStop(f), poi: f.poi })

    // —— 午睡：窗口里能睡的时间（路上、休息、住处、空档）不够一小时，就留一段。
    // 放午饭后还是午饭前、睡多久，逐个试：先保午饭不晚于 13:30，再求睡够，其次睡得久
    if (c.nap && nodes.length) {
      const { from, to } = c.nap
      const ov = (a0: number, a1: number) => Math.max(0, Math.min(a1, to) - Math.max(a0, from))
      const friendly = (k: Stop['kind'], tags?: Stop['tags']) => k === 'drive' || k === 'rest' || k === 'lodging' || !!tags?.includes('napOk')
      const napOf = async (list: Node[]) => {
        saOf.clear()
        const slots = await timeline(list)
        const sleep = slots.reduce((a, sl) => a + (friendly(sl.stop.kind, sl.stop.tags) ? ov(sl.start, sl.end) : 0) + ov(sl.departAt, sl.start), 0)
        const busy = slots.reduce((a, sl) => a + ov(sl.departAt, sl.end), 0)
        const lunch = list.find(x => x.meal === 'lunch')
        return { got: sleep + (to - from - busy), lunchAt: lunch ? slots.find(sl => sl.stop.id === lunch.stop.id)!.start : 0 }
      }
      const base = await napOf(nodes)
      if (base.got < 60) {
        const li = nodes.findIndex(x => x.meal === 'lunch')
        const home = lodge?.poi ?? prevNight
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
            if (r.lunchAt > 13 * 60 + 30 || r.got < 60) continue
            best = { list, got: r.got }
            break
          }
          if (best) break
        }
        if (best) nodes.splice(0, nodes.length, ...best.list)
        // 怎么排都睡不够：不硬插一段白白拖长一天的休息，照实说
        else {
          // 说清是什么占了午睡时段：午饭后在路上 / 午饭吃得晚 / 被景点排满
          saOf.clear()
          const slots = await timeline(nodes)
          const lunch = slots.find(sl => nodes.find(x => x.stop.id === sl.stop.id)?.meal === 'lunch')
          const road = slots.filter(sl => !lunch || sl.start >= lunch.start).reduce((a, sl) => a + (sl.stop.kind === 'drive' || sl.stop.kind === 'transit' ? ov(sl.start, sl.end) : ov(sl.departAt, sl.start)), 0)
          const busyBy = [...new Set(slots.filter(sl => (sl.stop.kind === 'sight' || sl.stop.kind === 'food') && ov(sl.start, sl.end) >= 20).map(sl => sl.stop.name))]
          const win = `${fmtHM(from)}–${fmtHM(to)}`
          if (road >= 30) notes.push(`第 ${d + 1} 天午饭后就得赶路，${win} 的午睡只能在车上将就`)
          else if (lunch && lunch.start > from) notes.push(`第 ${d + 1} 天午饭 ${fmtHM(lunch.start)} 才吃，赶不上 ${win} 的午睡；可以饭后找地方补一觉，或者上午少排一点`)
          else notes.push(`第 ${d + 1} 天 ${win} 排满了${busyBy.length ? `（${busyBy.join('、')}）` : ''}，午睡没地方睡；想睡就删一个点，或者要求这天排松一点`)
        }
      }
    }

    // 饭点来得太早（逛完了才下午三点）：最后再定，到饭点再吃。前面插了午睡、拆了长途都已经算进去了
    for (const which of ['lunch', 'dinner'] as const) {
      const m = nodes.find(x => x.meal === which)
      // 最后一天晚饭在回家路上吃，不为等饭点拖晚到家
      if (!m || m.stop.start || (endHere && which === 'dinner')) continue
      saOf.clear()
      const sl = (await timeline(nodes)).find(x => x.stop.id === m.stop.id)!
      if (sl.start < MEAL_AT[which] - 45) m.stop.start = fmtHM(MEAL_AT[which] - 30)
    }

    // —— 空档补满：等待时间（到饭点、到预约时刻）先拉长前一个景点；下午还空一大段就就近补一个 ——
    const activeNow = () => nodes.reduce((a, x) => a + (x.stop.kind === 'sight' || x.stop.kind === 'food' ? x.stop.durationMin : 0), 0)
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
          const room = Math.min(wait, b * STRETCH_X - prev.stop.durationMin, STRETCH_MAX - prev.stop.durationMin, activeCap - activeNow())
          if (room >= 15) { prev.stop = { ...prev.stop, durationMin: prev.stop.durationMin + Math.floor(room / 5) * 5 }; changed = true }
        }
        if (!changed) break
      }
    }
    await stretch()
    // 补的景点避开午睡：有午睡就从午睡结束后开始；每天最多补两个，全天游玩不超过上限。要求排松一点的那天不补
    if (tools.nearby && !tw?.lighter) {
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

    progress(`第 ${d + 1} 天查车程`)
    saOf.clear()
    const stops = await expand(nodes)
    outDays.push({ startTime: startOf(d), stops })
    if (travelDay) {
      const road = stops.reduce((a, s) => a + (s.kind === 'drive' || s.kind === 'transit' ? s.durationMin : s.driveMin ?? 0), 0)
      if (road > 8 * 60) notes.push(`第 ${d + 1} 天${endHere ? '返程' : '去程'}路上约 ${Math.round(road / 6) / 10} 小时，太累的话考虑早点出发或中途住一晚`)
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
