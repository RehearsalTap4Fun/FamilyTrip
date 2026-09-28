// 示波器页的纯计算：累计游玩曲线、触发时刻、最长连续驾驶。无 DOM 依赖，小程序可直接复用。
import { parseHM, type Slot } from '@core/schedule'

export interface TracePoint { t: number; v: number; done: boolean }

const PLAY = (k: string) => k === 'sight' || k === 'food'

/**
 * 累计游玩分钟随时间的折线。打过卡的站按实际时刻画，没到的站按当前延误平移——
 * 所以曲线是「照现在这样走下去」的推算，而不是早上的计划。
 */
export function traceOf(slots: Slot[], delay = 0): TracePoint[] {
  if (!slots.length) return []
  const shift = (s: Slot) => (s.stop.status === 'done' && s.stop.actualStart ? parseHM(s.stop.actualStart) - s.start : delay)
  const pts: TracePoint[] = [{ t: slots[0].departAt + shift(slots[0]), v: 0, done: slots[0].stop.status === 'done' }]
  let v = 0
  for (const s of slots) {
    const off = shift(s)
    const done = s.stop.status === 'done'
    if (PLAY(s.stop.kind)) {
      pts.push({ t: s.start + off, v, done })
      v += s.stop.durationMin
      pts.push({ t: s.end + off, v, done })
    } else {
      pts.push({ t: s.end + off, v, done })
    }
  }
  return pts
}

/** 曲线第一次到达 level 的时刻；到不了返回 null */
export function crossing(pts: TracePoint[], level: number): number | null {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    if (a.v < level && b.v >= level) return a.t + ((level - a.v) / (b.v - a.v)) * (b.t - a.t)
  }
  return null
}

/** 曲线在某一时刻的值（线性插值），用来画 NOW 游标和它上面的读数 */
export function valueAt(pts: TracePoint[], t: number): number {
  if (!pts.length || t <= pts[0].t) return 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    if (t <= b.t) return b.t === a.t ? b.v : a.v + ((t - a.t) / (b.t - a.t)) * (b.v - a.v)
  }
  return pts[pts.length - 1].v
}

/** 一天里最长的一段连续驾驶（中间停不够 15 分钟不算停），与规则层同一口径 */
export function maxDriveRun(slots: Slot[]): number {
  let run = 0, max = 0
  for (const s of slots) {
    const d = s.stop.kind === 'drive' ? s.stop.durationMin : s.stop.driveMin ?? 0
    run += d
    max = Math.max(max, run)
    if (s.stop.kind !== 'drive' && s.stop.durationMin >= 15) run = 0
  }
  return max
}

/** 通道色：只代表同行者，按名单顺序循环 */
export const CHANNEL_COLORS = ['var(--ch1)', 'var(--ch2)', 'var(--ch3)', 'var(--ch4)', 'var(--ch5)', 'var(--ch6)']

export type Phase = 'dawn' | 'day' | 'dusk' | 'night'

/** 当天时段：海报窗口按它换一组平涂色。清晨 5:00–7:30、白天到 16:30、傍晚到 19:30、其余是夜里 */
export function phaseOf(min: number): Phase {
  if (min >= 300 && min < 450) return 'dawn'
  if (min >= 450 && min < 990) return 'day'
  if (min >= 990 && min < 1170) return 'dusk'
  return 'night'
}
