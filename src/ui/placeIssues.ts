// 注记挂在「改的地方」：连续驾驶挂到下一个能停够 15 分钟的站。两套风格共用。
import type { Day, Stop } from '@core/types'
import type { Issue } from '@core/validate'

export interface Placed {
  issue: Issue
  /** 连续驾驶的补救：在这一站停下 */
  restAt?: Stop
  /** 这一段路上没有能停的地方 */
  noRest?: boolean
}

export function placeIssues(day: Day, issues: Issue[]): Map<string, Placed[]> {
  const out = new Map<string, Placed[]>()
  const put = (id: string, p: Placed) => out.set(id, [...(out.get(id) ?? []), p])
  for (const i of issues) {
    if (!i.stopId || i.level === 'tip') continue
    if (i.code === 'noDriveBreak') {
      const from = day.stops.findIndex(s => s.id === i.stopId)
      const at = day.stops.slice(from + 1).find(s => s.kind !== 'drive' && s.kind !== 'lodging' && s.durationMin >= 15)
      if (at) put(at.id, { issue: i, restAt: at })
      else put(i.stopId, { issue: i, noRest: true })
      continue
    }
    put(i.stopId, { issue: i })
  }
  return out
}
