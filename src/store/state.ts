// 整份状态存一个 localStorage key。读写都包 try/catch：隐私窗口、存储被禁时照常能用，只是不保存。
import type { Rating } from '@core/ratings'
import type { Trip } from '@core/types'
import { SEED_NOW, seedTrip } from '../data/seed'
import { seedHistory } from '../data/seedHistory'

export interface AppState {
  version: 2
  /** 所有行程：进行中、计划中、去过的都在这里，状态按日期算（core/trips.ts） */
  trips: Trip[]
  /** 各页正在看的那个行程 */
  currentId: string
  ratings: Rating[]
  /** 'YYYY-MM-DDTHH:MM'；当前行程是示例时，「今天」页按这个时间算，便于看示例 */
  demoNow: string | null
  /** 视觉风格，缺省博朗面板 × 海报窗口（用户 2026-09-28 选定倾向） */
  theme?: Theme
  /** 高德 Web 服务 Key：只存在本机，以后做同步时不上传 */
  amapKey?: string
  /** 路线推荐用哪家大模型，以及各家的 API Key（只存本机） */
  llmProvider?: 'anthropic' | 'deepseek'
  llmKeys?: { anthropic?: string; deepseek?: string }
}

/** 只支持两套风格（2026-09-28 用户定）：博朗 × 海报（默认，走设备家族页面结构）与地图册 */
export type Theme = 'braun' | 'atlas'

/** 走示波器式页面结构（ScopeToday / ScopeTrip）的风格 */
export const DEVICE_THEMES: Theme[] = ['braun']

export const THEME_LABEL: Record<Theme, string> = {
  braun: '博朗 × 海报',
  atlas: '地图册',
}

export const KEY = 'tonglu.v1'

/** 应用自带的示例：一趟正在进行的大理丽江 + 四趟去过的（足迹页有东西可看） */
export function sampleTrips(): Trip[] {
  return [{ ...seedTrip(), sample: true }, ...seedHistory().map(t => ({ ...t, sample: true }))]
}

export function defaultState(): AppState {
  const trips = sampleTrips()
  return { version: 2, trips, currentId: trips[0].id, ratings: [], demoNow: SEED_NOW }
}

/** 旧存档升级：v1 是「一个行程 + 去过的历史」，升成「所有行程 + 当前是哪个」。认不出来就返回 null */
export function migrate(raw: unknown): AppState | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  let out: AppState
  if (s.version === 2 && Array.isArray(s.trips) && s.trips.length) {
    out = s as unknown as AppState
  } else if (s.version === 1 && s.trip) {
    const { trip, history, version: _v, ...rest } = s as { trip: Trip; history?: Trip[]; version: number }
    const past = (history ?? seedHistory()).map(t => ({ ...t, sample: true }))
    // v1 只有示例这一趟可改，用户在上面改过也还是示例
    out = { ...(rest as Omit<AppState, 'version' | 'trips' | 'currentId'>), version: 2, trips: [{ ...trip, sample: true }, ...past], currentId: trip.id }
  } else return null
  if (!out.trips.some(t => t.id === out.currentId)) out = { ...out, currentId: out.trips[0].id }
  // 已移除的风格（示波器、导览折页、公园海报）回到默认
  if (out.theme && !(out.theme in THEME_LABEL)) out = { ...out, theme: undefined }
  return out
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultState()
    return migrate(JSON.parse(raw)) ?? defaultState()
  } catch {
    return defaultState()
  }
}

export function currentTrip(s: AppState): Trip {
  return s.trips.find(t => t.id === s.currentId) ?? s.trips[0]
}

/** 改当前行程 */
export function withTrip(s: AppState, trip: Trip): AppState {
  return { ...s, trips: s.trips.map(t => (t.id === trip.id ? trip : t)) }
}

/** 恢复示例：示例行程换回初始样子，用户自己建的不动 */
export function restoreSamples(s: AppState): AppState {
  const samples = sampleTrips()
  const own = s.trips.filter(t => !t.sample && !samples.some(x => x.id === t.id))
  return { ...s, trips: [...samples, ...own], currentId: samples[0].id, demoNow: SEED_NOW }
}

export function saveState(s: AppState) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* 存不了就算了 */ }
}

/** 示例按演示时间看；自己建的行程永远按真实时间 */
export function nowOf(s: AppState): Date {
  if (!s.demoNow || !currentTrip(s).sample) return new Date()
  const [d, t] = s.demoNow.split('T')
  const [y, m, dd] = d.split('-').map(Number)
  const [hh, mm] = t.split(':').map(Number)
  return new Date(y, m - 1, dd, hh, mm)
}

export function uid(prefix = 'x'): string {
  return prefix + Math.random().toString(36).slice(2, 9)
}
