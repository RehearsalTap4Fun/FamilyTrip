// 单次旅程进度：今天第几天、到哪一站了、比计划慢了多少、慢了该砍什么。
import { parseHM, scheduleDay } from './schedule'
import type { Stop, Trip } from './types'

export interface Progress {
  /** 旅程第几天（0 起）；未开始为 -1，已结束为 days.length */
  dayIndex: number
  done: number
  skipped: number
  total: number
  /** 当天下一站：第一个还没打卡的非开车站（开车段不用打卡，到了下一站就算开完） */
  next?: Stop
  /** 下一站计划开始时刻（当天分钟数） */
  nextPlanned?: number
  /** 比计划晚了多少分钟，负数是提前。取「最近一次打卡的迟到」与「已过下一站计划时间」两者较大的 */
  behindMin: number
  /** 按目前的延误推算，当前时刻落在当天第几个站点之前（界面把「现在」画在它上面） */
  nowBefore: number
  /** 落后较多时建议跳过的站点，按优先级从低到高 */
  suggestSkip: Stop[]
}

/** 落后多少分钟开始给砍站建议 */
export const BEHIND_ALERT_MIN = 45

function dayDiff(startDate: string, now: Date): number {
  const [y, m, d] = startDate.split('-').map(Number)
  const start = new Date(y, m - 1, d)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((today.getTime() - start.getTime()) / 86400000)
}

export function tripProgress(trip: Trip, now: Date): Progress {
  const all = trip.days.flatMap(d => d.stops)
  const done = all.filter(s => s.status === 'done').length
  const skipped = all.filter(s => s.status === 'skipped').length
  const base = { done, skipped, total: all.length, behindMin: 0, suggestSkip: [] as Stop[] }

  const dayIndex = dayDiff(trip.startDate, now)
  if (dayIndex < 0) return { ...base, dayIndex: -1, nowBefore: 0 }
  if (dayIndex >= trip.days.length) return { ...base, dayIndex: trip.days.length, nowBefore: 0 }

  const day = trip.days[dayIndex]
  const slots = scheduleDay(day)
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const idx = slots.findIndex(s => s.stop.status !== 'done' && s.stop.kind !== 'drive')
  const lastDone = [...slots].reverse().find(s => s.stop.status === 'done' && s.stop.actualStart)
  const shift = lastDone ? parseHM(lastDone.stop.actualStart!) - lastDone.start : 0
  // 按延误平移后的计划时刻，找出「现在」落在哪一站之前
  const nowPos = slots.findIndex(s => s.stop.status !== 'done' && s.start + Math.max(0, shift) >= nowMin)
  const nowBefore = nowPos < 0 ? day.stops.length : day.stops.indexOf(slots[nowPos].stop)
  if (idx < 0) return { ...base, dayIndex, nowBefore, behindMin: Math.max(0, shift) }

  const nextSlot = slots[idx]
  const behindMin = Math.max(shift, nowMin - nextSlot.start)

  let suggestSkip: Stop[] = []
  if (behindMin >= BEHIND_ALERT_MIN) {
    // 从剩下的站里挑可砍的：优先级 3 先砍，再 2；必去和住宿、交通不动。砍到能追回为止。
    const rest = slots.slice(idx).map(s => s.stop)
      .filter(s => (s.priority ?? 2) > 1 && (s.kind === 'sight' || s.kind === 'rest'))
      .sort((a, b) => (b.priority ?? 2) - (a.priority ?? 2))
    let saved = 0
    for (const s of rest) {
      if (saved >= behindMin) break
      suggestSkip.push(s)
      saved += s.durationMin
    }
  }

  return { ...base, dayIndex, next: nextSlot.stop, nextPlanned: nextSlot.start, behindMin, suggestSkip, nowBefore }
}

/** 打卡：写入实际到达时间，返回新的 trip（不修改入参） */
export function checkIn(trip: Trip, stopId: string, at: string, status: 'done' | 'skipped' = 'done'): Trip {
  parseHM(at)
  return {
    ...trip,
    days: trip.days.map(d => ({
      ...d,
      stops: d.stops.map(s => (s.id === stopId ? { ...s, status, actualStart: status === 'done' ? at : undefined } : s)),
    })),
  }
}

/** 这一站的计划开始时刻（HH:MM）；找不到就返回 undefined */
export function plannedStart(trip: Trip, dayIndex: number, stopId: string): string | undefined {
  const d = trip.days[dayIndex]
  const sl = d ? scheduleDay(d).find(s => s.stop.id === stopId) : undefined
  return sl ? `${String(Math.floor(sl.start / 60)).padStart(2, '0')}:${String(sl.start % 60).padStart(2, '0')}` : undefined
}

/**
 * 打卡默认按计划时间记（点「到了」往往是事后补点的，按点击那一刻记会把延误算错）；实际几点到的可以再改（setArrival）
 */
export function checkInPlanned(trip: Trip, dayIndex: number, stopId: string, status: 'done' | 'skipped' = 'done'): Trip {
  return checkIn(trip, stopId, plannedStart(trip, dayIndex, stopId) ?? '09:00', status)
}

/** 手动改到达时间（已打卡的站） */
export function setArrival(trip: Trip, stopId: string, at: string): Trip {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) throw new Error(`到达时间看不懂：${at}`)
  return { ...trip, days: trip.days.map(d => ({ ...d, stops: d.stops.map(s => (s.id === stopId && s.status === 'done' ? { ...s, actualStart: at } : s)) })) }
}
