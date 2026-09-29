// 把一天的行程点排成具体时刻。规则层、进度跟进都基于排好的时刻，不直接读 stop.start。
import type { Day, Stop } from './types'

/** HH:MM；过了半夜的写成「次日 01:10」「+2天 01:10」（fmtHM 的写法），也认 */
export function parseHM(s: string): number {
  const m = /^(?:(次日)|\+(\d+)天)?\s*(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) throw new Error(`时间格式应为 HH:MM：${s}`)
  const days = m[1] ? 1 : m[2] ? Number(m[2]) : 0
  return days * 1440 + Number(m[3]) * 60 + Number(m[4])
}

/** 当天分钟数 → HH:MM；过了半夜不写成 25:10，写「次日 01:10」（再往后「+2天 01:10」） */
export function fmtHM(min: number): string {
  const total = Math.round(min)
  const days = Math.floor(total / 1440)
  const r = total - days * 1440
  const hm = `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`
  return days <= 0 ? hm : days === 1 ? `次日 ${hm}` : `+${days}天 ${hm}`
}

/** 这个站点贡献的驾驶分钟：drive 站点是它本身，其他站点是「开过来」那段 */
export function driveOf(s: Stop): number {
  return s.kind === 'drive' ? s.durationMin : s.driveMin ?? 0
}

export interface Slot {
  stop: Stop
  /** 开车过来的起点（没有路上时间则等于 start） */
  departAt: number
  start: number
  end: number
  /** 声明的开始时间早于上一站结束，排不开 */
  overlap: boolean
}

export function scheduleDay(day: Day, opts: { includeSkipped?: boolean } = {}): Slot[] {
  let cursor = parseHM(day.startTime ?? '09:00')
  const out: Slot[] = []
  for (const stop of day.stops) {
    if (!opts.includeSkipped && stop.status === 'skipped') continue
    const leg = stop.kind === 'drive' ? 0 : stop.driveMin ?? 0
    const earliest = cursor + leg
    let start = earliest
    let overlap = false
    if (stop.start) {
      const declared = parseHM(stop.start)
      if (declared < earliest) overlap = out.length > 0
      else start = declared
    }
    const end = start + stop.durationMin
    out.push({ stop, departAt: start - leg, start, end, overlap })
    cursor = end
  }
  return out
}
