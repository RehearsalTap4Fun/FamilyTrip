// 多个行程：按日期判断状态、玩法类型的说明、按新建表单生成空行程骨架。
import type { Party, PlanFlow, Trip, TripStyle, TravelMode } from './types'
import { LODGING_PLACEHOLDER } from './validate'

export type TripStatus = 'ongoing' | 'planning' | 'done'

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** 'YYYY-MM-DD' 往后数 n 天 */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return ymd(new Date(y, m - 1, d + n))
}

/** 离出发还有几天：今天出发是 0，已经出发是负数 */
export function daysUntil(startDate: string, now: Date): number {
  const [y, m, d] = startDate.split('-').map(Number)
  const a = new Date(y, m - 1, d).getTime(), b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.round((a - b) / 86400000)
}

/** 状态只看日期，不另存：还没到出发日是计划中，过了最后一天是去过的 */
export function tripStatus(trip: Trip, now: Date): TripStatus {
  const today = ymd(now)
  if (today < trip.startDate) return 'planning'
  if (today > addDays(trip.startDate, Math.max(0, trip.days.length - 1))) return 'done'
  return 'ongoing'
}

export const STATUS_LABEL: Record<TripStatus, string> = { ongoing: '进行中', planning: '计划中', done: '去过的' }

/** 进行中的排最前；计划中的按出发日由近到远；去过的由近到远 */
export function sortTrips(trips: Trip[], now: Date): Trip[] {
  const rank: Record<TripStatus, number> = { ongoing: 0, planning: 1, done: 2 }
  return [...trips].sort((a, b) => {
    const sa = tripStatus(a, now), sb = tripStatus(b, now)
    if (sa !== sb) return rank[sa] - rank[sb]
    return sa === 'planning' ? a.startDate.localeCompare(b.startDate) : b.startDate.localeCompare(a.startDate)
  })
}

export interface StyleInfo {
  label: string
  /** 推荐时偏向哪类地方 */
  seek: string
  /** 排程时的节奏 */
  pace: string
}

export const STYLES: Record<TripStyle, StyleInfo> = {
  scenic: { label: '风景漫游', seek: '自然风光、观景台、湖泊山地', pace: '能接受长一点的车程，日出日落卡好时间' },
  family: { label: '亲子游学', seek: '博物馆、科技馆、动物园、手作体验', pace: '每天一两个主题，一定留午睡，单点不排太久' },
  active: { label: '健康有氧', seek: '步道、绿道、骑行线、湖边环线', pace: '早出发，步行往限制的上沿靠，吃得清淡' },
  heritage: { label: '人文古镇', seek: '古镇、古建、遗址、非遗', pace: '慢逛，傍晚和夜景留时间' },
  resort: { label: '休闲度假', seek: '温泉、度假村、湖边酒店', pace: '少挪窝，一处连住几晚，上午不排点' },
  food: { label: '美食探店', seek: '当地名店、夜市、早市', pace: '以吃为主线，景点穿插在饭点之间' },
}

export const STYLE_ORDER: TripStyle[] = ['scenic', 'family', 'active', 'heritage', 'resort', 'food']

/** 多选最多两个：再选第三个时挤掉最早选的那个 */
export function pickStyles(next: TripStyle[]): TripStyle[] {
  return next.length > 2 ? next.slice(-2) : next
}

export interface NewTripInput {
  title: string
  startDate: string
  days: number
  mode: TravelMode
  party: Party
  flow: PlanFlow
  styles: TripStyle[]
  region?: string
  origin?: string
}

/** 空行程骨架：每天一个住处占位，之后由排程填满或手动加站 */
export function skeletonTrip(input: NewTripInput, newId: (prefix: string) => string): Trip {
  const days = Math.max(1, Math.min(30, Math.round(input.days)))
  const region = input.region?.trim() || undefined
  const origin = input.mode === 'tour' ? undefined : input.origin?.trim() || undefined
  return {
    id: newId('t'),
    title: input.title.trim() || region || '新行程',
    startDate: input.startDate,
    party: { ...input.party, mode: input.mode },
    days: Array.from({ length: days }, () => ({ startTime: '09:00', stops: [{ id: newId('s'), kind: 'lodging' as const, name: LODGING_PLACEHOLDER, durationMin: 0, status: 'planned' as const }] })),
    plan: { flow: input.flow, styles: input.styles.slice(0, 2), region: input.flow === 'region' ? region : undefined, origin },
  }
}

/** 新行程默认沿用最近一次的同行；只保留勾上的人和宠物，中途加入/先走的天数清掉（天数变了没意义） */
export function carryParty(from: Party | undefined, keepIds: Set<string>): Party {
  if (!from) return { mode: 'selfDrive', members: [{ id: 'me', name: '我', role: 'adult', driver: true }], pets: [] }
  const strip = <T extends { days?: unknown }>(x: T): T => { const { days: _d, ...rest } = x; return rest as T }
  return {
    ...from,
    members: from.members.filter(m => keepIds.has(m.id)).map(strip),
    pets: from.pets.filter(p => keepIds.has(p.id)).map(strip),
  }
}
