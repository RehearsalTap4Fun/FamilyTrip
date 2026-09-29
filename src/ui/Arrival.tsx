// 已打卡的站：到达时间。打卡时默认按计划时间记，点一下改成实际几点到的（手机上弹出时间选择）。
// 没法自动记录时，一般是一天休整下来再补卡：按计划一次补完（BackfillButton），个别再改——这是保底方案。
import { backfillDay, plannedStart, setArrival } from '@core/progress'
import { useToast } from './kit/Toast'
import type { Stop, Trip } from '@core/types'

export function ArrivalInput({ trip, dayIndex, stop, onTrip, label = '到达时间' }: { trip: Trip; dayIndex: number; stop: Stop; onTrip: (t: Trip) => void; label?: string }) {
  if (stop.status !== 'done') return null
  const plan = plannedStart(trip, dayIndex, stop.id)
  return (
    <input className="arrive-in num" type="time" value={stop.actualStart ?? plan ?? ''} aria-label={`${stop.name}的${label}${plan ? `（计划 ${plan}）` : ''}`}
      onChange={e => { if (e.target.value) onTrip(setArrival(trip, stop.id, e.target.value)) }} />
  )
}

/**
 * 「按计划补打卡」：一天玩下来再补——还没打卡的站一次全按计划时间记上，没去的点那一站选跳过，时间不对的点进去改。
 * 看今天只补计划时间已经过了的；之前的日子整天补；还没到的日子不显示
 */
export function BackfillButton({ trip, dayIndex, live, past, nowMin, onTrip }: { trip: Trip; dayIndex: number; live: boolean; past: boolean; nowMin: number; onTrip: (t: Trip) => void }) {
  const toast = useToast()
  if (!live && !past) return null
  const r = backfillDay(trip, dayIndex, live ? nowMin : undefined)
  if (!r.ids.length) return null
  const go = () => {
    const before = trip
    onTrip(r.trip)
    toast(`已按计划补打 ${r.ids.length} 站 · 没去的点那一站选跳过，时间不对点进去改`, () => onTrip(before))
  }
  return (
    <button type="button" className="kbtn wide backfill" onClick={go}>
      按计划补打卡<small>{live ? `到现在还有 ${r.ids.length} 站没打卡` : `这天还有 ${r.ids.length} 站没打卡`}，都按计划时间记</small>
    </button>
  )
}
