// 一次旅程 = 一份可多人同时改的同步文档。
// 同行好友拿到这次旅程的同步码就能一起改（加密方式沿用饮食日记的 sync：同步码派生 id 与密钥，服务器只见密文）。
//
// 为什么不整份 Trip 按时间戳覆盖：A 在打卡、B 在加一站、C 在加一只狗，整份覆盖必丢两个人的改动。
// 所以拆成扁平的记录表，每条记录各自「后写赢」，删除留墓碑。互不相干的改动永远都能合上。
import type { Rating } from '@core/ratings'
import type { Member, Party, Pet, Stop, Trip, TripHighlight, TripPlan } from '@core/types'

export interface Rec<T> {
  /** null 是墓碑 */
  v: T | null
  /** 写入时刻（毫秒） */
  t: number
  /** 写入者（设备或成员 id），时刻相同时用它定胜负，保证各端合并结果一致 */
  by: string
}

export interface TripMeta {
  id: string
  title: string
  startDate: string
  mode: Party['mode']
  vehicleSeats?: number
  dayCount: number
  dayStarts: (string | undefined)[]
  /** 新建时的计划（玩法、地区、排程用的地点）：整块后写赢，很少两个人同时改 */
  plan?: TripPlan
  highlights?: TripHighlight[]
}

export type PlacedStop = Stop & { day: number; order: number }

export type Entry =
  | { key: 'meta'; rec: Rec<TripMeta> }
  | { key: `member:${string}`; rec: Rec<Member> }
  | { key: `pet:${string}`; rec: Rec<Pet> }
  | { key: `stop:${string}`; rec: Rec<PlacedStop> }
  | { key: `rating:${string}`; rec: Rec<Rating> }

export type TripDoc = Record<string, Rec<unknown>>

function newer(a: Rec<unknown>, b: Rec<unknown>): boolean {
  return a.t > b.t || (a.t === b.t && a.by > b.by)
}

export function mergeDocs(a: TripDoc, b: TripDoc): TripDoc {
  const out: TripDoc = { ...a }
  for (const [k, rb] of Object.entries(b)) {
    const ra = out[k]
    if (!ra || newer(rb, ra)) out[k] = rb
  }
  return out
}

/**
 * 给每站定 order：能沿用上一版的就沿用，只给新插入或被挪动的站新值。
 * 否则插一站会让后面所有站的 order 都变，跟别人同时在改的那些站（比如打卡）撞车。
 */
function assignOrders(stops: Stop[], day: number, prev?: TripDoc): number[] {
  const prevOrder = (s: Stop): number | undefined => {
    const r = prev?.['stop:' + s.id]?.v as PlacedStop | null | undefined
    return r && r.day === day ? r.order : undefined
  }
  const out: number[] = []
  let last: number | undefined
  stops.forEach((s, i) => {
    const po = prevOrder(s)
    if (po != null && (last == null || po > last)) { out.push(po); last = po; return }
    // 下一个还能沿用旧值的站，作为插入的上界
    let upper: number | undefined
    for (let j = i + 1; j < stops.length; j++) {
      const o = prevOrder(stops[j])
      if (o != null && (last == null || o > last)) { upper = o; break }
    }
    const o = orderBetween(last, upper)
    out.push(o)
    last = o
  })
  return out
}

export function tripToDoc(trip: Trip, ratings: Rating[], t: number, by: string, prev?: TripDoc): TripDoc {
  const doc: TripDoc = {}
  const put = (k: string, v: unknown) => { doc[k] = { v, t, by } }
  put('meta', {
    id: trip.id,
    title: trip.title,
    startDate: trip.startDate,
    mode: trip.party.mode,
    vehicleSeats: trip.party.vehicleSeats,
    dayCount: trip.days.length,
    dayStarts: trip.days.map(d => d.startTime),
    ...(trip.plan ? { plan: trip.plan } : {}),
    ...(trip.highlights?.length ? { highlights: trip.highlights } : {}),
  } satisfies TripMeta)
  for (const m of trip.party.members) put('member:' + m.id, m)
  for (const p of trip.party.pets) put('pet:' + p.id, p)
  trip.days.forEach((d, day) => {
    const orders = assignOrders(d.stops, day, prev)
    d.stops.forEach((s, i) => put('stop:' + s.id, { ...s, day, order: orders[i] } satisfies PlacedStop))
  })
  for (const r of ratings) put('rating:' + r.id, r)
  return doc
}

/**
 * 本地改完后，只给真正变了的记录打新时间戳。
 * 没变的保留旧 rec，避免一个人随手保存就把别人的并发改动全部「盖」掉。
 */
export function diffInto(prev: TripDoc, next: TripDoc, t: number, by: string): TripDoc {
  const out: TripDoc = { ...prev }
  for (const [k, rec] of Object.entries(next)) {
    const old = prev[k]
    if (!old || JSON.stringify(old.v) !== JSON.stringify(rec.v)) out[k] = { v: rec.v, t, by }
  }
  for (const k of Object.keys(prev)) {
    if (!(k in next) && prev[k].v !== null) out[k] = { v: null, t, by }
  }
  return out
}

function live<T>(doc: TripDoc, prefix: string): T[] {
  return Object.entries(doc)
    .filter(([k, r]) => k.startsWith(prefix) && r.v !== null)
    .map(([, r]) => r.v as T)
}

export function docToTrip(doc: TripDoc): { trip: Trip; ratings: Rating[] } {
  const meta = doc.meta?.v as TripMeta | null | undefined
  if (!meta) throw new Error('同步文档缺少 meta')
  const stops = live<PlacedStop>(doc, 'stop:')
  // 别人往后加了一天，本地 meta 还没更新到时，天数按实际出现的站点撑开
  const dayCount = Math.max(meta.dayCount, ...stops.map(s => s.day + 1), 0)
  const days = Array.from({ length: dayCount }, (_, i) => ({
    startTime: meta.dayStarts[i],
    stops: stops
      .filter(s => s.day === i)
      // 两人同时往同一位置插站时 order 相同，按 id 排保证各端顺序一致
      .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
      .map(({ day: _d, order: _o, ...s }) => s as Stop),
  }))
  return {
    trip: {
      id: meta.id,
      title: meta.title,
      startDate: meta.startDate,
      party: { mode: meta.mode, vehicleSeats: meta.vehicleSeats, members: live<Member>(doc, 'member:'), pets: live<Pet>(doc, 'pet:') },
      days,
      ...(meta.plan ? { plan: meta.plan } : {}),
      ...(meta.highlights?.length ? { highlights: meta.highlights } : {}),
    },
    ratings: live<Rating>(doc, 'rating:'),
  }
}

/** 在 a、b 两站之间插入时用的 order（分数排序，不用重排其他站） */
export function orderBetween(a: number | undefined, b: number | undefined): number {
  if (a == null && b == null) return 1
  if (a == null) return b! - 1
  if (b == null) return a + 1
  return (a + b) / 2
}
