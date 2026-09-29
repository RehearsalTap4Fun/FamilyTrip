// 红黑榜：吃、住、玩三类，每条都记「谁评的、那天带了谁」。
// 同一个地方多个人评过时合并成一条，并且能按当前这群人过滤——
// 带老人时，「老人不友好」的黑榜要浮到最上面；没带宠物，宠物相关的评价就往后放。
import { kidBand } from './party'
import type { DayParty } from './party'
import type { Poi, StopKind } from './types'

export type RatingKind = 'food' | 'lodging' | 'sight'
export type Verdict = 'red' | 'black'

/** 这条评价跟哪类同行人有关 */
export type FitTag = 'elder' | 'kid' | 'toddler' | 'pet' | 'drive' | 'wheelchair'

export interface Rating {
  id: string
  kind: RatingKind
  name: string
  /** 城市名，没有 poi 时用「城市 + 名字」对齐同一个地方 */
  city?: string
  poi?: Poi
  verdict: Verdict
  note?: string
  fit?: FitTag[]
  by: string
  tripId?: string
  /** 毫秒时间戳 */
  at: number
}

export function placeKey(r: Pick<Rating, 'name' | 'city' | 'poi' | 'kind'>): string {
  if (r.poi?.amapId) return 'amap:' + r.poi.amapId
  const norm = (s: string) => s.replace(/[\s（）()·・\-—]/g, '').toLowerCase()
  return `${r.kind}:${norm(r.city ?? '')}:${norm(r.name)}`
}

export interface PlaceVerdict {
  key: string
  kind: RatingKind
  name: string
  city?: string
  red: number
  black: number
  /** 多数意见；平票算 mixed */
  verdict: Verdict | 'mixed'
  fit: FitTag[]
  notes: string[]
  latest: number
}

export function aggregate(ratings: Rating[]): PlaceVerdict[] {
  const m = new Map<string, PlaceVerdict>()
  for (const r of ratings) {
    const key = placeKey(r)
    let p = m.get(key)
    if (!p) {
      p = { key, kind: r.kind, name: r.name, city: r.city, red: 0, black: 0, verdict: 'mixed', fit: [], notes: [], latest: 0 }
      m.set(key, p)
    }
    p[r.verdict]++
    for (const f of r.fit ?? []) if (!p.fit.includes(f)) p.fit.push(f)
    if (r.note) p.notes.push(r.note)
    p.latest = Math.max(p.latest, r.at)
  }
  for (const p of m.values()) p.verdict = p.red > p.black ? 'red' : p.black > p.red ? 'black' : 'mixed'
  return [...m.values()].sort((a, b) => b.latest - a.latest)
}

/** 当前这群人身上带着哪些 FitTag */
export function partyFit(p: DayParty): Set<FitTag> {
  const s = new Set<FitTag>()
  for (const m of p.members) {
    if (m.role === 'elder') s.add('elder')
    if (m.role === 'kid') {
      s.add('kid')
      const b = kidBand(m.age)
      if (b === 'infant' || b === 'toddler') s.add('toddler')
    }
    if (m.mobility === 'wheelchair') s.add('wheelchair')
  }
  if (p.pets.length) s.add('pet')
  if (p.mode === 'selfDrive') s.add('drive')
  return s
}

/**
 * 按相关度排序：和这群人有关的排前面，其次是黑榜（避坑优先），再按时间。
 * 不过滤掉无关条目，只是往后放。
 */
export function rankForParty(list: PlaceVerdict[], p: DayParty): PlaceVerdict[] {
  const fit = partyFit(p)
  const rel = (v: PlaceVerdict) => v.fit.filter(f => fit.has(f)).length
  return [...list].sort((a, b) =>
    rel(b) - rel(a) ||
    Number(b.verdict === 'black') - Number(a.verdict === 'black') ||
    b.latest - a.latest)
}

const STOP_TO_RATING: Partial<Record<StopKind, RatingKind>> = { food: 'food', lodging: 'lodging', sight: 'sight', rest: 'sight' }

/** 行程点命中了黑榜就返回那条；规则层和 LLM 提示词都会用到 */
export function blacklistHit(stop: { kind: StopKind; name: string; poi?: Poi; home?: boolean }, city: string | undefined, list: PlaceVerdict[]): PlaceVerdict | undefined {
  const kind = STOP_TO_RATING[stop.kind]
  if (!kind || stop.home) return undefined
  const key = placeKey({ kind, name: stop.name, city, poi: stop.poi })
  return list.find(v => v.key === key && v.verdict === 'black')
}

/** 这一站能不能上红黑榜（吃、住、玩；开车、坐车、回家不算） */
export function stopRatingKind(stop: { kind: StopKind; home?: boolean }): RatingKind | undefined {
  return stop.home ? undefined : STOP_TO_RATING[stop.kind]
}

/**
 * 打卡时顺手记一笔红榜或黑榜：理由必须写（一句话就行），没写就不记。
 * 地方按站点的高德 id 对齐（没有就按城市 + 名字），带上这趟的人群标签
 */
export function ratingFromStop(
  stop: { kind: StopKind; name: string; poi?: Poi; home?: boolean },
  verdict: Verdict, note: string,
  o: { id: string; at: number; by: string; tripId?: string; city?: string; fit?: FitTag[] },
): Rating | null {
  const kind = stopRatingKind(stop)
  const why = note.trim()
  if (!kind || !why) return null
  return { id: o.id, kind, name: stop.name, ...(o.city ? { city: o.city } : {}), ...(stop.poi ? { poi: stop.poi } : {}), verdict, note: why, ...(o.fit?.length ? { fit: o.fit } : {}), by: o.by, ...(o.tripId ? { tripId: o.tripId } : {}), at: o.at }
}
