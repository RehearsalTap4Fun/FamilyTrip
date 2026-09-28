// 整份状态存一个 localStorage key。读写都包 try/catch：隐私窗口、存储被禁时照常能用，只是不保存。
import type { Rating } from '@core/ratings'
import type { Trip } from '@core/types'
import { SEED_NOW, seedTrip } from '../data/seed'
import { seedHistory } from '../data/seedHistory'

export interface AppState {
  version: 1
  trip: Trip
  ratings: Rating[]
  /** 'YYYY-MM-DDTHH:MM'；有值时「今天」页按这个时间算，便于看示例 */
  demoNow: string | null
  /** 视觉风格，缺省博朗面板 × 海报窗口（用户 2026-09-28 选定倾向） */
  theme?: Theme
  /** 高德 Web 服务 Key：只存在本机，以后做同步时不上传 */
  amapKey?: string
  /** 路线推荐用哪家大模型，以及各家的 API Key（只存本机） */
  llmProvider?: 'anthropic' | 'deepseek'
  llmKeys?: { anthropic?: string; deepseek?: string }
  /** 去过的旅程，足迹页用 */
  history?: Trip[]
}

export type Theme = 'atlas' | 'scope' | 'unigrid' | 'braun' | 'poster'

/** 共用示波器页面结构、只换视觉的一组风格 */
export const DEVICE_THEMES: Theme[] = ['scope', 'unigrid', 'braun', 'poster']

export const THEME_LABEL: Record<Theme, string> = {
  scope: '手持机液晶',
  unigrid: '公园导览折页',
  braun: '博朗 × 海报',
  poster: '公园海报',
  atlas: '地图册',
}

export const KEY = 'tonglu.v1'

export function defaultState(): AppState {
  return { version: 1, trip: seedTrip(), ratings: [], demoNow: SEED_NOW, history: seedHistory() }
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultState()
    const s = JSON.parse(raw) as AppState
    if (s.version !== 1 || !s.trip) return defaultState()
    // 旧存档没有历史旅程：补上示例，足迹页不至于空着
    return s.history ? s : { ...s, history: seedHistory() }
  } catch {
    return defaultState()
  }
}

export function saveState(s: AppState) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* 存不了就算了 */ }
}

export function nowOf(s: AppState): Date {
  if (!s.demoNow) return new Date()
  const [d, t] = s.demoNow.split('T')
  const [y, m, dd] = d.split('-').map(Number)
  const [hh, mm] = t.split(':').map(Number)
  return new Date(y, m - 1, dd, hh, mm)
}

export function uid(prefix = 'x'): string {
  return prefix + Math.random().toString(36).slice(2, 9)
}
