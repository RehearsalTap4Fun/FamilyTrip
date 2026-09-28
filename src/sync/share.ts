// 单趟行程分享给同行好友：一趟一个分享码，拿到码的人都能看、能改这一趟（含这趟的红黑榜），碰不到各自的其他行程和 Key。
// 分享码和自己的同步码同一种格式、不同的盐（crypto.ts 的 share 用途），服务器照样只存密文。
// 多人同时改：tripDoc 拆成扁平记录各自后写赢——A 在打卡、B 在加一站、C 在加一只狗，都能合上。
import type { Rating } from '@core/ratings'
import type { Trip } from '@core/types'
import { deriveKeys } from './crypto'
import { diffInto, docToTrip, mergeDocs, tripToDoc, type TripDoc } from './tripDoc'
import type { AppState } from '../store/state'

export interface ShareBlob { v: 1; doc: TripDoc }

export const shareKeys = (code: string) => deriveKeys(code, 'share')

export const mergeShare = (a: ShareBlob, b: ShareBlob): ShareBlob => ({ v: 1, doc: mergeDocs(a.doc, b.doc) })

const sortDeep = (x: unknown): unknown => {
  if (Array.isArray(x)) return x.map(sortDeep)
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, sortDeep((x as Record<string, unknown>)[k])]))
  return x
}
export const shareFp = (b: ShareBlob) => JSON.stringify(sortDeep(b.doc))

/** 这趟的改动打时间戳：只有变了的记录才换新时刻 */
export function stampShare(base: TripDoc, trip: Trip, ratings: Rating[], now: number, by: string): TripDoc {
  const mine = ratings.filter(r => r.tripId === trip.id)
  return diffInto(base, tripToDoc(trip, mine, now, by, base), now, by)
}

/** 合并结果写回应用：这趟换成合并后的样子（分享码照旧），这趟的红黑榜按记录更新（别人删了的这边也删） */
export function applyShare(s: AppState, tripId: string, doc: TripDoc): AppState {
  if (!doc.meta?.v) return s
  const { trip, ratings } = docToTrip(doc)
  const local = s.trips.find(t => t.id === tripId)
  const next: Trip = { ...trip, ...(local?.share ? { share: local.share } : {}) }
  const trips = local ? s.trips.map(t => (t.id === tripId ? next : t)) : [...s.trips, next]
  const inDoc = new Set(Object.keys(doc).filter(k => k.startsWith('rating:')).map(k => k.slice(7)))
  return { ...s, trips, ratings: [...s.ratings.filter(r => !inDoc.has(r.id)), ...ratings] }
}

/** 邀请链接：分享码放在 # 后面，不会发到服务器；打开就自动填好 */
export function inviteLink(code: string, origin = 'https://47.109.97.108/trip/'): string {
  return `${origin}#join=${code}`
}

export function inviteText(trip: Trip, code: string): string {
  return `我在「同路」里排了「${trip.title}」，一起看、一起改：打开 ${inviteLink(code)} 就能加入（或在「我的行程」→「加入同行好友的行程」填分享码 ${code}）`
}

/** 链接里带的分享码（#join=XXXX） */
export function joinCodeFromHash(hash: string): string | null {
  const m = /[#&]join=([A-Za-z0-9-]+)/.exec(hash)
  return m ? m[1] : null
}
