// 让 AI 排出来的一天「落地」：新加的站按名字搜高德拿坐标，再按真实路线重算车程。
// 模型只会估车程、也不认地理顺序；落地之后规则层看到的是真实驾驶时长，绕路会变成「连开太久」「游玩太久」这类问题交回模型修。
import type { Poi, Stop, Trip } from '@core/types'
import type { Drive, Place } from './amap'
import { fillDrives } from './fillDrives'
import { distanceKm } from '@core/geo'

export { distanceKm }

export interface GroundTools {
  /** 按名字搜地点；near 是附近一个已知位置，用来限定城市 */
  search: (name: string, near?: Poi) => Promise<Place[]>
  drive: (from: Poi, to: Poi) => Promise<Drive | null>
}

export interface GroundLeg { from: string; to: string; minutes: number; km: number }

export interface GroundReport {
  /** 这次新定到位置的站 */
  located: string[]
  /** 搜不到、或搜到的离这天的路线太远，没定位的站 */
  unlocated: string[]
  /** 高德实测的每一段车程 */
  legs: GroundLeg[]
  /** 改了几处车程 */
  changed: number
}

/** 景点、住处：搜到的地方离附近已知位置超过这个距离就不认（多半是外地同名的店） */
const MAX_KM = 150
/** 服务区、吃饭这类顺路停的站：比直接从前一站开到后一站多绕的直线距离上限 */
const DETOUR_KM = 25

/** 搜到的名字要和站名有连着的两个字相同，防止「车上午睡」这种不是地名的站被随便对上一个地方（2026-09-28 真实联调遇到） */
export function namesMatch(query: string, found: string): boolean {
  const q = query.replace(/[\s·()（）\-—]/g, '')
  if (q.length < 2) return found.includes(q)
  for (let i = 0; i + 2 <= q.length; i++) if (found.includes(q.slice(i, i + 2))) return true
  return false
}

const pk = (p: Poi) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`

/** 同一次重排的几轮修复共用缓存：同名的站、同一段路不重复问高德（个人 Key 额度很低） */
export function makeGrounder(tools: GroundTools) {
  const places = new Map<string, Poi | null>()
  const drives = new Map<string, Drive | null>()

  return async function ground(trip: Trip, dayIndex: number): Promise<{ trip: Trip; report: GroundReport }> {
    const day = trip.days[dayIndex]
    const prevDay = trip.days[dayIndex - 1]
    const prevPoi = prevDay ? [...prevDay.stops].reverse().find(s => s.poi && s.kind !== 'drive')?.poi : undefined
    const stops: Stop[] = day.stops.map(s => ({ ...s }))
    const located: string[] = []
    const unlocated: string[] = []

    // 前后最近的已知位置；前面没有就用前一天的住处
    const prevOf = (i: number): Poi | undefined => {
      for (let k = i - 1; k >= 0; k--) if (stops[k].poi) return stops[k].poi
      return prevPoi
    }
    const nextOf = (i: number): Poi | undefined => {
      for (let k = i + 1; k < stops.length; k++) if (stops[k].poi) return stops[k].poi
      return undefined
    }
    const plausible = (s: Stop, p: Place, before?: Poi, after?: Poi) => {
      if (!namesMatch(s.name, p.name)) return false
      const onTheWay = s.kind === 'rest' || s.kind === 'food' || s.kind === 'transit'
      if (onTheWay && before && after) return distanceKm(before, p.poi) + distanceKm(p.poi, after) - distanceKm(before, after) <= DETOUR_KM
      const near = before ?? after
      return !near || distanceKm(near, p.poi) <= MAX_KM
    }

    for (let i = 0; i < stops.length; i++) {
      const s = stops[i]
      if (s.kind === 'drive' || s.poi) continue
      const before = prevOf(i), after = nextOf(i)
      const key = `${s.kind}:${s.name}@${before ? pk(before) : ''}>${after ? pk(after) : ''}`
      if (!places.has(key)) {
        const found = await tools.search(s.name, before ?? after)
        places.set(key, found.find(p => plausible(s, p, before, after))?.poi ?? null)
      }
      const poi = places.get(key)
      if (poi) { s.poi = poi; located.push(s.name) } else unlocated.push(s.name)
    }

    const nameAt = new Map<string, string>()
    if (prevPoi) nameAt.set(pk(prevPoi), '前一晚住处')
    for (const s of stops) if (s.poi && s.kind !== 'drive') nameAt.set(pk(s.poi), s.name)
    const legs: GroundLeg[] = []
    const grounded = { ...trip, days: trip.days.map((x, i) => (i === dayIndex ? { ...x, stops } : x)) }
    const { trip: out, changes } = await fillDrives(grounded, dayIndex, async (a, b) => {
      const k = pk(a) + '>' + pk(b)
      if (!drives.has(k)) drives.set(k, await tools.drive(a, b))
      const d = drives.get(k)!
      if (d) legs.push({ from: nameAt.get(pk(a)) ?? '?', to: nameAt.get(pk(b)) ?? '?', minutes: d.minutes, km: d.km })
      return d
    })
    return { trip: out, report: { located, unlocated, legs, changed: changes.length } }
  }
}

export type Grounder = ReturnType<typeof makeGrounder>
