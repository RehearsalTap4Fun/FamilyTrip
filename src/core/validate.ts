// 规则层：拿当天的叠加约束去逐项检查行程。LLM 给的草案、跟团社给的行程、自己排的，都过这一道。
import { deriveConstraints, foodNeeds, limitRules, ruleLabel, type Constraints, type Limit } from './constraints'
import { partyOnDay } from './party'
import { driveOf, fmtHM, scheduleDay, type Slot } from './schedule'
import type { Stop, Tag, Trip } from './types'

export type Level = 'error' | 'warn' | 'tip'

export interface Issue {
  day: number
  stopId?: string
  level: Level
  code: string
  message: string
  /** 一眼能读的短标签，例如「连开 130/90 分」「海拔 4506 m」；界面空间紧时用它 */
  short: string
  /** 触发这条问题的规则 id，界面据此展示依据 */
  rules: string[]
}

export const TAG_LABEL: Record<Tag, string> = {
  steps: '台阶多',
  accessible: '无障碍',
  stroller: '推车可通行',
  petOk: '可带宠物',
  kidMenu: '儿童餐',
  softFood: '软烂清淡',
  elevator: '电梯/低楼层',
  parking: '好停车',
  restroom: '厕所方便',
  shade: '遮阴/室内',
  napOk: '能补觉',
}

/** 连续驾驶之间，至少停这么久才算休息过 */
const BREAK_MIN = 15
/** 午睡窗口里至少要有这么长的可睡时间 */
const NAP_NEED_MIN = 60

const who = (ids: string[]) => ids.map(ruleLabel).join('、')
/** 一条上限的来源说明：并列的规则一起列出 */
const src = (l: Limit) => who(limitRules(l))
/** 需求只对游玩和吃饭的地方提：服务区、回酒店休息不必有推车道、能带狗 */
const NEEDS_APPLY: Stop['kind'][] = ['sight', 'food']

/**
 * 值得核实的条件：没有就真出问题、而且不少地方确实没有的。
 * 住处的电梯（老人、行动不便）、无障碍（轮椅）、能带宠物；景点的无障碍、能带宠物（不少景区禁宠）。
 * 推车能走、厕所方便、儿童餐、软烂清淡这类大概率都有，只在排程和推荐时考虑，不标「待核」
 */
const CHECK_WORTHY: Partial<Record<Stop['kind'], Tag[]>> = {
  lodging: ['elevator', 'accessible', 'petOk'],
  sight: ['accessible', 'petOk'],
  food: [],
}

function overlapLen(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

function napFriendly(s: Slot): boolean {
  const k = s.stop.kind
  return k === 'drive' || k === 'transit' || k === 'rest' || k === 'lodging' || (s.stop.tags ?? []).includes('napOk')
}

/** 回住处的时间晚这么多分钟以内不提醒 */
export const LATE_GRACE_MIN = 30

/**
 * 这天午睡时段里能睡多少分钟（路上、休息、住处、空档都算），不够一小时返回 true。
 * 不再作为提醒报出来（午睡只是建议），留给排程测试确认排程时确实留了午睡
 */
export function napMissed(trip: Trip, dayIndex: number): boolean {
  const day = trip.days[dayIndex]
  const c = deriveConstraints(partyOnDay(trip.party, dayIndex))
  if (!day || !c.nap) return false
  const slots = scheduleDay(day)
  const { from, to } = c.nap
  const napTime = slots.reduce((a, s) => a + (napFriendly(s) ? overlapLen(s.start, s.end, from, to) : 0) + overlapLen(s.departAt, s.start, from, to), 0)
  const busy = slots.reduce((a, s) => a + overlapLen(s.departAt, s.end, from, to), 0)
  // 窗口里没排东西的空档也能睡
  return napTime + (to - from - busy) < NAP_NEED_MIN
}

export function checkDay(trip: Trip, dayIndex: number): Issue[] {
  const day = trip.days[dayIndex]
  const dp = partyOnDay(trip.party, dayIndex)
  const c: Constraints = deriveConstraints(dp)
  const fNeeds = foodNeeds(dp)
  const slots = scheduleDay(day)
  const out: Issue[] = []
  const push = (i: Omit<Issue, 'day'>) => out.push({ day: dayIndex, ...i })

  for (const b of c.blockers) push({ level: 'error', code: b.code, message: b.message, short: b.short, rules: [] })
  if (!slots.length) return out

  // —— 时长与回住处时间 ——
  const outings = slots.filter(s => s.stop.kind !== 'lodging')
  if (outings.length) {
    const last = outings[outings.length - 1].end
    const active = slots.filter(s => s.stop.kind === 'sight').reduce((a, s) => a + s.stop.durationMin, 0)
    if (active > c.activeMin.value) {
      const over = active - c.activeMin.value
      push({
        level: over > 90 ? 'error' : 'warn',
        code: 'activeTooLong',
        short: `游玩 ${(active / 60).toFixed(1)}/${c.activeMin.value / 60} h`,
        message: `游玩 ${(active / 60).toFixed(1)} 小时，超过${src(c.activeMin)}的 ${c.activeMin.value / 60} 小时`,
        rules: limitRules(c.activeMin),
      })
    }
    // 晚回 30 分钟以内不算（路上堵一会儿、饭吃久一点都会有）
    if (last > c.endBy.value + LATE_GRACE_MIN) {
      push({ level: 'warn', code: 'lateReturn', short: `${fmtHM(last)} 才回`, message: `${fmtHM(last)} 才结束，${src(c.endBy)}建议 ${fmtHM(c.endBy.value)} 前回住处`, rules: limitRules(c.endBy) })
    }
  }

  // —— 步行 ——
  const walk = slots.reduce((a, s) => a + (s.stop.walkKm ?? 0), 0)
  if (walk > c.walkKm.value) {
    push({
      level: walk > c.walkKm.value * 1.5 ? 'error' : 'warn',
      code: 'walkTooFar',
      short: `步行 ${walk.toFixed(1)}/${c.walkKm.value} km`,
      message: `步行约 ${walk.toFixed(1)} 公里，超过${src(c.walkKm)}的 ${c.walkKm.value} 公里`,
      rules: limitRules(c.walkKm),
    })
  }

  // —— 驾驶总量与连续驾驶 ——
  if (trip.party.mode === 'selfDrive') {
    const drive = slots.reduce((a, s) => a + driveOf(s.stop), 0)
    if (drive > c.driveMin.value) {
      push({
        level: drive > c.driveMin.value + 90 ? 'error' : 'warn',
        code: 'driveTooLong',
        short: `驾驶 ${(drive / 60).toFixed(1)}/${c.driveMin.value / 60} h`,
        message: `驾驶 ${(drive / 60).toFixed(1)} 小时，超过${src(c.driveMin)}的 ${c.driveMin.value / 60} 小时`,
        rules: limitRules(c.driveMin),
      })
    }
    // 驾驶累计到下一次像样的停留（≥15 分钟）才清零；加油 5 分钟不算
    let run = 0
    let runStart: string | undefined
    let reported = false
    for (const s of slots) {
      const d = driveOf(s.stop)
      if (d > 0) {
        if (run === 0) runStart = s.stop.id
        run += d
      }
      if (run > c.driveBreakMin.value && !reported) {
        push({ level: 'warn', code: 'noDriveBreak', stopId: runStart, short: `连开 ${run}/${c.driveBreakMin.value} 分`, message: `连续开车约 ${run} 分钟，${src(c.driveBreakMin)}要求 ${c.driveBreakMin.value} 分钟内停一次`, rules: limitRules(c.driveBreakMin) })
        reported = true
      }
      if (s.stop.kind !== 'drive' && s.stop.durationMin >= BREAK_MIN) { run = 0; reported = false }
    }
  }

  // 午睡只是建议（排程时尽量留，「今天」页画出时段），不单独报冲突（用户 2026-09-29）

  // —— 逐站：海拔、避开项、需求项 ——
  for (const s of slots) {
    const st = s.stop
    const tags = new Set(st.tags ?? [])
    if (s.overlap) push({ level: 'warn', stopId: st.id, code: 'overlap', short: '时间冲突', message: `「${st.name}」定的 ${st.start} 开始，但上一站还没结束`, rules: [] })
    if (st.altitudeM != null && st.altitudeM > c.altitudeM.value) {
      push({ level: 'error', stopId: st.id, code: 'altitude', short: `海拔 ${st.altitudeM} m`, message: `「${st.name}」海拔 ${st.altitudeM} 米，${src(c.altitudeM)}建议不超过 ${c.altitudeM.value} 米`, rules: limitRules(c.altitudeM) })
    }
    if (st.kind === 'drive' || st.kind === 'transit') continue
    for (const [tag, rule] of c.avoid) {
      if (tags.has(tag) && !tags.has(rule.unless)) {
        push({ level: 'warn', stopId: st.id, code: 'avoid:' + tag, short: TAG_LABEL[tag], message: `「${st.name}」${TAG_LABEL[tag]}，没有${TAG_LABEL[rule.unless]}（${who(rule.by)}）`, rules: rule.by })
      }
    }
    if (st.kind !== 'lodging' && !NEEDS_APPLY.includes(st.kind)) continue
    // 回到家不是住宿，不用问电梯、能不能带宠物
    if (st.home) continue
    const needs = st.kind === 'lodging' ? c.lodgingNeeds : st.kind === 'food' ? new Map([...c.needs, ...fNeeds]) : c.needs
    // 还没定的住处（新建行程、加一天时放的「住处」占位，没搜过地点；或排程工具推荐、还没人确认的）：只提示要满足什么，不算问题。
    // 手写了名字（「客栈」）就算定了，照常按缺项报
    const undecided = st.kind === 'lodging' && ((!st.poi && st.name === LODGING_PLACEHOLDER) || !!st.suggested)
    for (const [tag, by] of needs) {
      if (tags.has(tag)) continue
      // 只提醒真正容易出问题的：推车、厕所、儿童餐、软烂这类大多地方都有，不一站站去问（用户 2026-09-29）
      if (!CHECK_WORTHY[st.kind]?.includes(tag)) continue
      // 住宿缺项影响一整晚，是 warn；景点标签常常没人标过，只提示去确认
      push(undecided
        ? { level: 'tip', stopId: st.id, code: 'need:' + tag, short: `${TAG_LABEL[tag]}？`, message: st.suggested ? `「${st.name}」是推荐的，订之前确认${TAG_LABEL[tag]}（${who(by)}）` : `还没定住处，找的时候要${TAG_LABEL[tag]}（${who(by)}）`, rules: by }
        : { level: st.kind === 'lodging' ? 'warn' : 'tip', stopId: st.id, code: 'need:' + tag, short: `${TAG_LABEL[tag]}？`, message: `「${st.name}」未确认${TAG_LABEL[tag]}（${who(by)}）`, rules: by })
    }
  }

  return out
}

/** 新建行程、加一天时住处的占位名 */
export const LODGING_PLACEHOLDER = '住处'

export function checkTrip(trip: Trip): Issue[] {
  return trip.days.flatMap((_, i) => checkDay(trip, i))
}

export function worst(issues: Issue[]): Level | null {
  if (issues.some(i => i.level === 'error')) return 'error'
  if (issues.some(i => i.level === 'warn')) return 'warn'
  return issues.length ? 'tip' : null
}
