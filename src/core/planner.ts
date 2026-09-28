// 排程引擎（流程一，也是流程二和导入攻略的公共后半段）：给一组要去的点，按同行人的限制排成每天的行程。
//   分天（地理成串 → 按每天可玩时长切段，靠近当晚住处）→ 放不下就砍「想去」→ 天内顺路 → 固定时刻就位
//   → 插午饭晚饭 → 留午睡 → 真实车程、超连开拆段插服务区 → 住处。
// 车程、周边搜索由调用方注入（网页用高德），这里只管排；没有工具时用直线估算和占位，照样能出一版。
import { deriveConstraints, type Constraints } from './constraints'
import { distanceKm, estDriveMin } from './geo'
import { partyOnDay } from './party'
import { fmtHM, parseHM, scheduleDay } from './schedule'
import type { PlanPlace, Poi, Stop, Trip, TripStyle } from './types'
import { checkDay, LODGING_PLACEHOLDER, type Issue } from './validate'

/** 排程的输入就是行程计划里的地点 */
export type Candidate = PlanPlace

export interface NearbyPlace { name: string; poi: Poi; rating?: number; distanceM?: number }

export type NearbyKind = 'food' | 'lodging' | 'serviceArea'

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
const NEAR_KM = { food: 2.5, lodging: 6, serviceArea: 20 }

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
interface DayBudget { cap: number; span: number; from?: Poi; to?: Poi }

/** 按估算车程串起来的一段路要开多久 */
function estPath(points: Poi[]): number {
  let m = 0
  for (let i = 1; i < points.length; i++) m += estDriveMin(points[i - 1], points[i])
  return m
}

/** 这一天超出了多少（景点超时、或加上开车全天放不下，取大的那个，单位分钟） */
function excessOf(b: DayBudget, sights: Candidate[], pace: Pace): number {
  const load = sights.reduce((a, s) => a + durOf(s, pace), 0)
  const drive = estPath([b.from, ...sights.map(s => s.poi), b.to].filter((p): p is Poi => !!p))
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
      const near = Math.min(b.from ? distanceKm(p, b.from) : Infinity, b.to ? distanceKm(p, b.to) : Infinity)
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

export async function planTrip(trip: Trip, candidates: Candidate[], tools: PlanTools, opts: { origin?: Poi; newId: (prefix: string) => string }): Promise<PlanResult> {
  const days = trip.days.length
  const pace = paceOf(trip.plan?.styles)
  const cons: Constraints[] = trip.days.map((_, i) => deriveConstraints(partyOnDay(trip.party, i)))
  const notes: string[] = []
  const progress = (m: string) => tools.onProgress?.(m)
  const clampDay = (d?: number) => (d == null ? undefined : Math.max(0, Math.min(days - 1, Math.round(d))))
  const startMin = parseHM(pace.start)

  const sights = candidates.filter(c => c.kind === 'sight')
  const foods = candidates.filter(c => c.kind === 'food')
  const lodgings = candidates.filter(c => c.kind === 'lodging')

  // —— 住处：指定了哪晚就是哪晚；只给了一处又没说哪晚，当整趟的大本营 ——
  const night: (Candidate | undefined)[] = new Array(days).fill(undefined)
  for (const l of lodgings) { const d = clampDay(l.day); if (d != null && !night[d]) night[d] = l }
  const looseLodging = lodgings.filter(l => clampDay(l.day) == null)
  if (looseLodging.length === 1 && lodgings.length === 1) for (let d = 0; d < days; d++) night[d] = looseLodging[0]
  // 没住处的晚上：沿用前一晚（多半是连住）；第一晚没有就留空，排完再在附近找
  const budgets = (): DayBudget[] => cons.map((c, d) => ({
    cap: Math.max(60, c.activeMin.value - 2 * pace.mealMin),
    span: Math.max(120, c.endBy.value - startMin),
    from: d === 0 ? opts.origin : night[d - 1]?.poi,
    to: night[d]?.poi,
  }))

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
    unplaced.push({ candidate: drop, reason: `第 ${worst + 1} 天按每天游玩 ${c.activeMin.value / 60} 小时、${fmtHM(c.endBy.value)} 前回住处放不下` })
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
  // 已经在要去的地方里的店不再被推荐一遍（免得同一家吃两顿）
  const used = new Set<string>(candidates.filter(c => c.kind !== 'sight').map(c => c.name))
  const nearbyCache = new Map<string, NearbyPlace | undefined>()
  const pick = async (what: NearbyKind, at: Poi, reuse = false): Promise<NearbyPlace | undefined> => {
    if (!tools.nearby) return undefined
    const key = `${what}@${at.lng.toFixed(4)},${at.lat.toFixed(4)}`
    if (reuse && nearbyCache.has(key)) return nearbyCache.get(key)
    let list: NearbyPlace[] = []
    try { list = await tools.nearby(what, at) } catch { return undefined }
    const red = (p: NearbyPlace) => (tools.verdictOf?.(p) === 'red' ? 1 : 0)
    const ok = list.filter(p => distanceKm(at, p.poi) <= NEAR_KM[what] && tools.verdictOf?.(p) !== 'black' && (what === 'serviceArea' || !used.has(p.name)))
    ok.sort((a, b) => red(b) - red(a) || (b.rating ?? 0) - (a.rating ?? 0))
    const got = ok[0]
    if (got && what !== 'serviceArea') used.add(got.name)
    nearbyCache.set(key, got)
    return got
  }

  const toStop = (c: Candidate): Stop => ({
    id: opts.newId('s'), kind: c.kind, name: c.name, durationMin: durOf(c, pace), status: 'planned', poi: c.poi,
    priority: c.must ? 1 : 2, ...(c.start ? { start: c.start } : {}), ...(c.tags ? { tags: c.tags } : {}),
    ...(c.walkKm != null ? { walkKm: c.walkKm } : {}), ...(c.altitudeM != null ? { altitudeM: c.altitudeM } : {}),
  })

  const outDays: Trip['days'] = []
  let prevNight: Poi | undefined = opts.origin
  let prevLodge: Node | undefined
  for (let d = 0; d < days; d++) {
    progress(`排第 ${d + 1}/${days} 天`)
    const c = cons[d]
    const limit = trip.party.mode === 'selfDrive' && Number.isFinite(c.driveBreakMin.value) ? c.driveBreakMin.value : Infinity
    // 今晚住处：指定的，或没指定晚上的候选里离今天的点近的
    let lodge = night[d]
    if (!lodge && looseLodging.length && daySights[d].length) {
      const last = daySights[d][daySights[d].length - 1].poi
      lodge = [...looseLodging].sort((a, b) => distanceKm(a.poi, last) - distanceKm(b.poi, last))[0]
    }

    // 天内顺路（前一晚住处 → 今晚住处），再把固定时刻的点按估算时间插到对得上的位置
    const fixed = daySights[d].filter(s => s.start).sort((a, b) => parseHM(a.start!) - parseHM(b.start!))
    const seq = twoOpt(chain(daySights[d].filter(s => !s.start), prevNight), prevNight, lodge?.poi)
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
        if (x.poi && at) {
          const raw = await driveMin(at, x.poi)
          const m = trip.party.mode === 'transit' ? Math.round(raw * 1.4) : raw
          if (m > limit) {
            const parts = Math.ceil(m / (limit - 5))
            const each = Math.round(m / parts)
            for (let i = 0; i < parts; i++) {
              out.push({ id: opts.newId('s'), kind: 'drive', name: `开车 → ${x.stop.name}`, durationMin: i === parts - 1 ? m - each * (parts - 1) : each, status: 'planned' })
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
    const timeline = async (list: Node[]) => scheduleDay({ startTime: pace.start, stops: await expand(list) })

    // —— 午饭、晚饭：挑最接近饭点的空档；落在路上就在那个服务区吃 ——
    const mine = [...dayFoods[d]]
    const meal = async (which: 'lunch' | 'dinner') => {
      const label = which === 'lunch' ? '午饭' : '晚饭'
      const target = which === 'lunch' ? LUNCH : DINNER
      const [lo, hi] = which === 'lunch' ? [11 * 60 + 15, 13 * 60 + 30] : [17 * 60, 19 * 60 + 30]
      saOf.clear()
      const slots = await timeline(nodes)
      if (slots.some(sl => sl.stop.kind === 'food' && Math.abs(sl.start - target) < 90)) return
      const endOf = (i: number) => (i === 0 ? startMin : slots.find(sl => sl.stop.id === nodes[i - 1].stop.id)!.end)
      type Opt = { gap: number; t: number; sa?: { poi?: Poi; name: string; id: string } }
      const opts2: Opt[] = []
      for (let i = 0; i <= nodes.length; i++) opts2.push({ gap: i, t: endOf(i) })
      for (const sl of slots) { const sa = saOf.get(sl.stop.id); if (sa) opts2.push({ gap: sa.gap, t: sl.start, sa: { ...sa, id: sl.stop.id } }) }
      const inWin = opts2.filter(o => o.t >= lo && o.t <= hi)
      const gaps = opts2.filter(o => !o.sa)
      const pool = inWin.length ? inWin : which === 'lunch' ? opts2 : [gaps[gaps.length - 1]]
      const o = pool.reduce((a, x) => (Math.abs(x.t - target) < Math.abs(a.t - target) ? x : a))
      const near = o.sa?.poi ?? nodes[o.gap - 1]?.poi ?? nodes[o.gap]?.poi ?? lodge?.poi ?? prevNight
      let food: Node
      if (mine.length) {
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
    if (daySights[d].length || mine.length) { await meal('lunch'); await meal('dinner') }
    for (const f of mine) nodes.push({ stop: toStop(f), poi: f.poi })

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
        const spots = li >= 0 ? [li + 1, li] : [nodes.length]
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
        else notes.push(`第 ${d + 1} 天午饭后就得赶路，${fmtHM(from)}–${fmtHM(to)} 的午睡只能在车上将就`)
      }
    }

    // —— 今晚住处：候选里的，或在最后一站附近找一个 ——
    const lastPoi = [...nodes].reverse().find(x => x.poi)?.poi ?? prevNight
    let lodgeNode: Node
    if (lodge) lodgeNode = { poi: lodge.poi, stop: { ...toStop(lodge), durationMin: 0 } }
    else if (prevLodge?.poi && lastPoi && distanceKm(prevLodge.poi, lastPoi) <= 10) {
      // 今天还在前一晚附近：连住，不换酒店
      lodgeNode = { poi: prevLodge.poi, stop: { ...prevLodge.stop, id: opts.newId('s'), why: '连住，不用换酒店' } }
    } else {
      const p = lastPoi ? await pick('lodging', lastPoi) : undefined
      lodgeNode = p
        ? { poi: p.poi, stop: { id: opts.newId('s'), kind: 'lodging', name: p.name, durationMin: 0, status: 'planned', poi: p.poi, suggested: true, why: `离最后一站近${p.rating ? ` · 评分 ${p.rating}` : ''}；订之前确认电梯、能不能带宠物` } }
        : { stop: { id: opts.newId('s'), kind: 'lodging', name: LODGING_PLACEHOLDER, durationMin: 0, status: 'planned' } }
    }
    nodes.push(lodgeNode)

    // 饭点来得太早（逛完了才下午三点）：最后再定，到饭点再吃。前面插了午睡、拆了长途都已经算进去了
    for (const which of ['lunch', 'dinner'] as const) {
      const m = nodes.find(x => x.meal === which)
      if (!m || m.stop.start) continue
      saOf.clear()
      const sl = (await timeline(nodes)).find(x => x.stop.id === m.stop.id)!
      if (sl.start < MEAL_AT[which] - 45) m.stop.start = fmtHM(MEAL_AT[which] - 30)
    }

    progress(`第 ${d + 1} 天查车程`)
    saOf.clear()
    outDays.push({ startTime: pace.start, stops: await expand(nodes) })
    prevNight = lodgeNode.poi ?? prevNight
    prevLodge = lodgeNode
  }

  const out: Trip = { ...trip, days: outDays }
  const issues = out.days.flatMap((_, i) => checkDay(out, i)).filter(i => i.level !== 'tip')
  const placeholders = out.days.flatMap(d => d.stops).filter(s => !s.poi && s.kind !== 'drive').length
  if (!tools.drive) notes.push('没有高德 Key：车程按直线距离估算')
  if (placeholders) notes.push(`${placeholders} 处吃饭、休息或住处还没定具体地方，到时就近`)
  return { trip: out, unplaced, extraDaysNeeded, issues, notes }
}
