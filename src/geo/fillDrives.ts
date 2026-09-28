// 按高德补车程：一天里每两个有坐标的站之间问一次驾车时间。
// 中间有「开车」段的，按原来的比例把时间分给这些段、目的地不再记开过来；没有的，记在目的地的「开过来」上。
import type { Poi, Stop, Trip } from '@core/types'
import type { Drive } from './amap'

export interface DriveChange { stopId: string; name: string; from: number; to: number }

const round5 = (m: number) => Math.max(5, Math.round(m / 5) * 5)

type Ask = (from: Poi, to: Poi) => Promise<Drive | null>

export async function fillDrives(trip: Trip, dayIndex: number, ask: Ask): Promise<{ trip: Trip; changes: DriveChange[] }> {
  const day = trip.days[dayIndex]
  const stops = day.stops.map(s => ({ ...s }))
  const changes: DriveChange[] = []
  const set = (s: Stop, field: 'driveMin' | 'durationMin', v: number | undefined) => {
    const before = (field === 'driveMin' ? s.driveMin : s.durationMin) ?? 0
    if ((v ?? 0) === before) return
    if (field === 'driveMin') s.driveMin = v; else s.durationMin = v ?? 0
    changes.push({ stopId: s.id, name: s.name, from: before, to: v ?? 0 })
  }
  // 起点：前一天最后一个有坐标的站（通常是住处）
  const prevDay = trip.days[dayIndex - 1]
  let anchor: Poi | undefined = prevDay ? [...prevDay.stops].reverse().find(s => s.poi && s.kind !== 'drive')?.poi : undefined
  let between: Stop[] = []
  for (const s of stops) {
    if (s.kind === 'drive') { between.push(s); continue }
    if (!s.poi) continue
    if (anchor && (anchor.lng !== s.poi.lng || anchor.lat !== s.poi.lat)) {
      const d = await ask(anchor, s.poi)
      if (d) {
        if (between.length) {
          const total = between.reduce((a, x) => a + x.durationMin, 0) || between.length
          between.forEach(x => set(x, 'durationMin', round5((d.minutes * (x.durationMin || 1)) / total)))
          set(s, 'driveMin', undefined)
        } else {
          set(s, 'driveMin', round5(d.minutes))
        }
      }
    }
    anchor = s.poi
    between = []
  }
  return { trip: { ...trip, days: trip.days.map((x, i) => (i === dayIndex ? { ...x, stops } : x)) }, changes }
}
