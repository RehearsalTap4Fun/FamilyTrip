// 叠加模式的核心：把当天同行的每个人、每只宠物、出行方式各自带来的限制合成一份约束。
// 合成规则只有两条——上限取最严（min）、需求取并集——所以任意组合都能叠，
// 并且每一项都记下是哪条规则收紧的，界面上可以说清「为什么今天只排 6 小时」。
import { kidBand, needsChildSeat, type DayParty } from './party'
import type { Member, Tag } from './types'

export interface Limit {
  value: number
  /** 把它收紧到这个值的规则 id；没有被收紧过则为 'base' */
  by: string
  /** 给出同样数值的其他规则（外婆和朵朵都是 6 小时），界面要把他们一起列出来 */
  ties?: string[]
}

export interface Constraints {
  /** 一天游玩总时长（分钟）：景点、吃饭、步行，不含开车和休息——开车另有驾驶上限 */
  activeMin: Limit
  /** 一天累计步行（公里） */
  walkKm: Limit
  /** 一天累计驾驶（分钟），只在自驾时有意义 */
  driveMin: Limit
  /** 连续驾驶多久必须停一次（分钟） */
  driveBreakMin: Limit
  /** 最晚几点回到住处（当天分钟数） */
  endBy: Limit
  /** 海拔上限（米） */
  altitudeM: Limit
  /** 午睡窗口，有低龄小孩才有 */
  nap?: { from: number; to: number; by: string }
  /** 行程点应当具备的标签，缺了会提示 */
  needs: Map<Tag, string[]>
  /** 行程点不应当具备的标签（除非同时具备豁免标签） */
  avoid: Map<Tag, { unless: Tag; by: string[] }>
  /** 住宿至少要满足的标签 */
  lodgingNeeds: Map<Tag, string[]>
  seatsNeeded: number
  childSeats: number
  drivers: number
  /** 组合本身就不成立的问题（跟团带大狗、自驾没人会开车……） */
  blockers: { code: string; message: string; short: string }[]
  /** 实际生效过的规则，按触发顺序 */
  applied: string[]
}

export interface RuleInfo {
  id: string
  label: string
  /** 给用户看的依据 */
  why: string
}

// 数字来自常识与公开建议，不是医学结论；改数字时同步改 why。
export const RULES: Record<string, RuleInfo> = {
  base: { id: 'base', label: '成人默认', why: '成人一天游玩 10 小时、步行 15 公里以内、22:00 前回住处' },
  drive1: { id: 'drive1', label: '单人驾驶', why: '只有一位司机时每天驾驶不超过 5 小时，连续驾驶 2 小时停一次（疲劳驾驶按 4 小时算，这里留余量）' },
  drive2: { id: 'drive2', label: '多人轮换驾驶', why: '有两位以上司机轮换，每天驾驶可放宽到 8 小时' },
  elder: { id: 'elder', label: '老人同行', why: '65 岁以上一天游玩 7 小时、步行 6 公里以内，海拔 3000 米以下，住宿要电梯或低楼层' },
  elder75: { id: 'elder75', label: '75 岁以上', why: '再收紧到游玩 6 小时、步行 4 公里、海拔 2500 米以下，21:00 前回住处' },
  mobSlow: { id: 'mobSlow', label: '走得慢', why: '步行上限 4 公里，避开台阶多的地方' },
  mobCane: { id: 'mobCane', label: '拄拐', why: '步行上限 2 公里，台阶多的地方必须有无障碍通道' },
  mobWheel: { id: 'mobWheel', label: '轮椅', why: '步行（推行）上限 3 公里且全程要无障碍，住宿要电梯' },
  infant: { id: 'infant', label: '1 岁以下', why: '一天游玩 5 小时，要推车通行，12:00–14:30 留出午睡，20:00 前回住处，海拔 2500 米以下' },
  toddler: { id: 'toddler', label: '1–3 岁', why: '一天游玩 6 小时、推车总里程 8 公里内，12:30–14:30 午睡，20:00 前回住处，自驾 1.5 小时停一次' },
  preschool: { id: 'preschool', label: '3–6 岁', why: '一天游玩 7 小时、步行 4 公里，要有儿童餐，21:00 前回住处，自驾 1.5 小时停一次' },
  school: { id: 'school', label: '7–12 岁', why: '一天游玩 9 小时、步行 10 公里' },
  pet: { id: 'pet', label: '带宠物', why: '住宿和景点要能带宠物，自驾 2 小时内停一次给它下车' },
  petLarge: { id: 'petLarge', label: '大型犬', why: '公共交通基本不让上，住宿选择更少' },
  tour: { id: 'tour', label: '跟团', why: '行程由旅行社定，这里只做「这一天适不适合你们这群人」的检查' },
}

const HOUR = 60
const hm = (h: number, m = 0) => h * HOUR + m

function base(): Constraints {
  const b = (value: number): Limit => ({ value, by: 'base' })
  return {
    activeMin: b(10 * HOUR),
    walkKm: b(15),
    driveMin: b(Infinity),
    driveBreakMin: b(Infinity),
    endBy: b(hm(22)),
    altitudeM: b(Infinity),
    needs: new Map(),
    avoid: new Map(),
    lodgingNeeds: new Map(),
    seatsNeeded: 0,
    childSeats: 0,
    drivers: 0,
    blockers: [],
    applied: [],
  }
}

type LimitKey = 'activeMin' | 'walkKm' | 'driveMin' | 'driveBreakMin' | 'endBy' | 'altitudeM'

function tighten(c: Constraints, key: LimitKey, value: number, by: string) {
  const cur = c[key]
  if (value < cur.value) c[key] = { value, by }
  else if (value === cur.value && cur.by !== 'base' && by !== cur.by && !cur.ties?.includes(by)) {
    c[key] = { ...cur, ties: [...(cur.ties ?? []), by] }
  }
}

/** 这条上限由哪些规则共同给出 */
export function limitRules(l: Limit): string[] {
  return [l.by, ...(l.ties ?? [])]
}

function addNeed(map: Map<Tag, string[]>, tag: Tag, by: string) {
  const list = map.get(tag)
  if (!list) map.set(tag, [by])
  else if (!list.includes(by)) list.push(by)
}

function addAvoid(c: Constraints, tag: Tag, unless: Tag, by: string) {
  const cur = c.avoid.get(tag)
  if (!cur) c.avoid.set(tag, { unless, by: [by] })
  else if (!cur.by.includes(by)) cur.by.push(by)
}

function mark(c: Constraints, id: string) {
  if (!c.applied.includes(id)) c.applied.push(id)
}

function setNap(c: Constraints, from: number, to: number, by: string) {
  // 多个小孩时取并集窗口，保证谁都睡得上
  if (!c.nap) c.nap = { from, to, by }
  else c.nap = { from: Math.min(c.nap.from, from), to: Math.max(c.nap.to, to), by: c.nap.by }
}

function applyElder(c: Constraints, m: Member) {
  mark(c, 'elder')
  tighten(c, 'activeMin', 7 * HOUR, 'elder')
  tighten(c, 'walkKm', 6, 'elder')
  tighten(c, 'altitudeM', 3000, 'elder')
  addNeed(c.lodgingNeeds, 'elevator', 'elder')
  addNeed(c.needs, 'restroom', 'elder')
  if ((m.age ?? 0) >= 75) {
    mark(c, 'elder75')
    tighten(c, 'activeMin', 6 * HOUR, 'elder75')
    tighten(c, 'walkKm', 4, 'elder75')
    tighten(c, 'altitudeM', 2500, 'elder75')
    tighten(c, 'endBy', hm(21), 'elder75')
  }
}

function applyMobility(c: Constraints, m: Member) {
  switch (m.mobility) {
    case 'slow':
      mark(c, 'mobSlow')
      tighten(c, 'walkKm', 4, 'mobSlow')
      addAvoid(c, 'steps', 'accessible', 'mobSlow')
      break
    case 'cane':
      mark(c, 'mobCane')
      tighten(c, 'walkKm', 2, 'mobCane')
      addAvoid(c, 'steps', 'accessible', 'mobCane')
      addNeed(c.lodgingNeeds, 'elevator', 'mobCane')
      break
    case 'wheelchair':
      mark(c, 'mobWheel')
      tighten(c, 'walkKm', 3, 'mobWheel')
      addNeed(c.needs, 'accessible', 'mobWheel')
      addAvoid(c, 'steps', 'accessible', 'mobWheel')
      addNeed(c.lodgingNeeds, 'elevator', 'mobWheel')
      addNeed(c.lodgingNeeds, 'accessible', 'mobWheel')
      break
    default:
      break
  }
}

function applyKid(c: Constraints, m: Member, selfDrive: boolean) {
  const band = kidBand(m.age)
  switch (band) {
    case 'infant':
      mark(c, 'infant')
      tighten(c, 'activeMin', 5 * HOUR, 'infant')
      tighten(c, 'endBy', hm(20), 'infant')
      tighten(c, 'altitudeM', 2500, 'infant')
      addNeed(c.needs, 'stroller', 'infant')
      addNeed(c.needs, 'restroom', 'infant')
      setNap(c, hm(12), hm(14, 30), 'infant')
      if (selfDrive) tighten(c, 'driveBreakMin', 90, 'infant')
      break
    case 'toddler':
      mark(c, 'toddler')
      tighten(c, 'activeMin', 6 * HOUR, 'toddler')
      tighten(c, 'walkKm', 8, 'toddler') // 大人推着走，限的是大人推车的总里程
      tighten(c, 'endBy', hm(20), 'toddler')
      tighten(c, 'altitudeM', 2500, 'toddler')
      addNeed(c.needs, 'stroller', 'toddler')
      addNeed(c.needs, 'restroom', 'toddler')
      setNap(c, hm(12, 30), hm(14, 30), 'toddler')
      if (selfDrive) tighten(c, 'driveBreakMin', 90, 'toddler')
      break
    case 'preschool':
      mark(c, 'preschool')
      tighten(c, 'activeMin', 7 * HOUR, 'preschool')
      tighten(c, 'walkKm', 4, 'preschool')
      tighten(c, 'endBy', hm(21), 'preschool')
      addNeed(c.needs, 'restroom', 'preschool')
      if (selfDrive) tighten(c, 'driveBreakMin', 90, 'preschool')
      break
    case 'school':
      mark(c, 'school')
      tighten(c, 'activeMin', 9 * HOUR, 'school')
      tighten(c, 'walkKm', 10, 'school')
      break
    case 'teen':
      break
  }
}

/** 吃饭站点的需求单独给，避免把「儿童餐」要求套到景点上 */
export function foodNeeds(p: DayParty): Map<Tag, string[]> {
  const m = new Map<Tag, string[]>()
  for (const x of p.members) {
    if (x.role === 'kid' && ['infant', 'toddler', 'preschool'].includes(kidBand(x.age))) addNeed(m, 'kidMenu', kidBand(x.age))
    if (x.role === 'elder' && (x.age ?? 0) >= 75) addNeed(m, 'softFood', 'elder75')
  }
  return m
}

export function deriveConstraints(p: DayParty): Constraints {
  const c = base()
  const selfDrive = p.mode === 'selfDrive'

  for (const m of p.members) {
    if (m.role === 'elder') applyElder(c, m)
    if (m.role === 'kid') applyKid(c, m, selfDrive)
    applyMobility(c, m)
  }

  c.seatsNeeded = p.members.length
  c.childSeats = p.members.filter(needsChildSeat).length
  c.drivers = p.members.filter(m => m.driver && m.role !== 'kid').length

  if (p.pets.length) {
    mark(c, 'pet')
    addNeed(c.lodgingNeeds, 'petOk', 'pet')
    addNeed(c.needs, 'petOk', 'pet')
    if (selfDrive) tighten(c, 'driveBreakMin', 120, 'pet')
    if (p.pets.some(x => x.size === 'large')) mark(c, 'petLarge')
  }

  if (selfDrive) {
    if (c.drivers >= 2) { mark(c, 'drive2'); tighten(c, 'driveMin', 8 * HOUR, 'drive2') }
    else { mark(c, 'drive1'); tighten(c, 'driveMin', 5 * HOUR, 'drive1') }
    tighten(c, 'driveBreakMin', 120, c.drivers >= 2 ? 'drive2' : 'drive1')
    if (c.drivers === 0) c.blockers.push({ code: 'noDriver', message: '自驾但没有标记会开车的成人', short: '没有司机' })
    if (p.vehicleSeats != null && p.vehicleSeats < c.seatsNeeded) {
      c.blockers.push({ code: 'seats', message: `车上 ${p.vehicleSeats} 座，当天有 ${c.seatsNeeded} 人`, short: `座位 ${p.vehicleSeats}/${c.seatsNeeded}` })
    }
  } else {
    // 不自驾就没有驾驶上限的概念
    c.driveMin = { value: Infinity, by: 'base' }
    c.driveBreakMin = { value: Infinity, by: 'base' }
  }

  if (p.mode === 'tour') {
    mark(c, 'tour')
    if (p.pets.length) c.blockers.push({ code: 'tourPet', message: '跟团一般不能带宠物，需要提前安排寄养或换自驾', short: '跟团不能带宠物' })
  }
  if (p.mode === 'transit' && p.pets.some(x => x.size === 'large')) {
    c.blockers.push({ code: 'transitLargePet', message: '大型犬基本上不了高铁、飞机客舱和大巴', short: '大狗上不了车' })
  }
  if (!p.members.some(m => m.role !== 'kid')) {
    c.blockers.push({ code: 'noAdult', message: '当天没有成人同行', short: '没有大人' })
  }

  return c
}

export function ruleLabel(id: string): string {
  return RULES[id]?.label ?? id
}
