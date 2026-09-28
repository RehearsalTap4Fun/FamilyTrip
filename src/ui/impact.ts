// 改动的影响：面板底部实时告诉你「这样改之后，谁的哪条上限怎么变了、哪些问题解决了或新冒出来」。
// 纯函数，小程序直接复用。
import { deriveConstraints, limitRules, type Constraints } from '@core/constraints'
import { whoForAll } from '@core/explain'
import { partyOnDay } from '@core/party'
import { fmtHM } from '@core/schedule'
import type { Party, Trip } from '@core/types'
import { checkDay, type Issue } from '@core/validate'

type Key = 'activeMin' | 'walkKm' | 'driveBreakMin' | 'driveMin' | 'endBy' | 'altitudeM'
const KEYS: { key: Key; label: string; fmt: (v: number) => string }[] = [
  { key: 'activeMin', label: '游玩', fmt: v => `${v / 60}h` },
  { key: 'walkKm', label: '步行', fmt: v => `${v}km` },
  { key: 'driveBreakMin', label: '连开', fmt: v => `${v}分` },
  { key: 'driveMin', label: '每天驾驶', fmt: v => `${v / 60}h` },
  { key: 'endBy', label: '回住处', fmt: v => fmtHM(v) },
  { key: 'altitudeM', label: '海拔', fmt: v => `${v}m` },
]
const show = (fmt: (v: number) => string, v: number) => (Number.isFinite(v) ? fmt(v) : '不限')

export interface LimitChange {
  label: string
  from: string
  to: string
  /** 收紧（更严）还是放宽 */
  tighter: boolean
  /** 改动后定这条上限的人 */
  who: string[]
  /** 涉及的天（0 起），连续的几天在界面上合并成「第 2–5 天」 */
  days: number[]
}

export interface PartyImpact {
  limits: LimitChange[]
  /** 改动后新出现的组合问题（没有司机、座位不够……） */
  blockers: string[]
}

/** 同行配置改动前后，逐日比较合成的上限 */
export function partyImpact(trip: Trip, after: Party): PartyImpact {
  const merged = new Map<string, LimitChange>()
  const blockers = new Set<string>()
  trip.days.forEach((_, i) => {
    const a: Constraints = deriveConstraints(partyOnDay(trip.party, i))
    const bp = partyOnDay(after, i)
    const b = deriveConstraints(bp)
    for (const { key, label, fmt } of KEYS) {
      if (a[key].value === b[key].value) continue
      const from = show(fmt, a[key].value), to = show(fmt, b[key].value)
      const who = b[key].by === 'base' ? [] : whoForAll(limitRules(b[key]), bp)
      const id = `${key}|${from}|${to}|${who.join(',')}`
      const cur = merged.get(id)
      if (cur) cur.days.push(i)
      else merged.set(id, { label, from, to, tighter: b[key].value < a[key].value, who, days: [i] })
    }
    const had = new Set(a.blockers.map(x => x.code))
    for (const x of b.blockers) if (!had.has(x.code)) blockers.add(x.short)
  })
  return { limits: [...merged.values()], blockers: [...blockers] }
}

export interface DayImpact {
  fixed: Issue[]
  added: Issue[]
  /** 问题还在，但数字变了（连开 130/90 → 115/90） */
  changed: { from: Issue; to: Issue }[]
}

const key = (i: Issue) => `${i.code}|${i.stopId ?? ''}`

/** 某一天改动前后，检查结果的差别（不看「待核实」） */
export function dayImpact(before: Trip, after: Trip, dayIndex: number): DayImpact {
  const a = before.days[dayIndex] ? checkDay(before, dayIndex).filter(i => i.level !== 'tip') : []
  const b = after.days[dayIndex] ? checkDay(after, dayIndex).filter(i => i.level !== 'tip') : []
  const ak = new Set(a.map(key)), bk = new Set(b.map(key))
  const bm = new Map(b.map(i => [key(i), i]))
  const changed = a.filter(i => bm.has(key(i)) && bm.get(key(i))!.short !== i.short).map(i => ({ from: i, to: bm.get(key(i))! }))
  return { fixed: a.filter(i => !bk.has(key(i))), added: b.filter(i => !ak.has(key(i))), changed }
}

/** 「第 2–5 天」「第 1、3 天」「全程」 */
export function daysLabel(days: number[], total: number): string {
  if (days.length === total) return '全程'
  const s = [...days].sort((x, y) => x - y)
  const runs: string[] = []
  for (let i = 0; i < s.length; i++) {
    let j = i
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++
    runs.push(i === j ? `${s[i] + 1}` : `${s[i] + 1}–${s[j] + 1}`)
    i = j
  }
  return `第 ${runs.join('、')} 天`
}
