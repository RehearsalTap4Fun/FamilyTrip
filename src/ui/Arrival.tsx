// 已打卡的站：到达时间。打卡时默认按计划时间记，点一下改成实际几点到的（手机上弹出时间选择）。
import { plannedStart, setArrival } from '@core/progress'
import type { Stop, Trip } from '@core/types'

export function ArrivalInput({ trip, dayIndex, stop, onTrip, label = '到达时间' }: { trip: Trip; dayIndex: number; stop: Stop; onTrip: (t: Trip) => void; label?: string }) {
  if (stop.status !== 'done') return null
  const plan = plannedStart(trip, dayIndex, stop.id)
  return (
    <input className="arrive-in num" type="time" value={stop.actualStart ?? plan ?? ''} aria-label={`${stop.name}的${label}${plan ? `（计划 ${plan}）` : ''}`}
      onChange={e => { if (e.target.value) onTrip(setArrival(trip, stop.id, e.target.value)) }} />
  )
}
