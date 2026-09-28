// 同步在本机的记账：同步码、设备 id、上一次打过时间戳的版本、上次同步的结果。
// 单独存一个 key，不进导出的存档：同步码等于钥匙，不能跟着存档文件到处走。
import { emptySync, type SyncState } from '../sync/account'
import type { TripDoc } from '../sync/tripDoc'
import { uid } from './state'

export interface SyncLocal {
  enabled: boolean
  code?: string
  /** 这台设备的 id：同一时刻两边都改了，用它定胜负 */
  deviceId: string
  /** 上一次打过时间戳（或同步回来）的版本，下次只给相对它变了的记录打新时刻 */
  base: SyncState
  lastSyncAt?: number
  version?: number
  lastError?: string
  /** 共享的每一趟：上一次打过时间戳的文档、上次同步的结果 */
  shares?: Record<string, ShareLocal>
}

export interface ShareLocal { base: TripDoc; lastSyncAt?: number; version?: number; lastError?: string }

const KEY = 'tonglu.sync'

export function loadSync(): SyncLocal {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const j = JSON.parse(raw) as SyncLocal
      if (j && typeof j.deviceId === 'string' && j.base?.v === 1) return j
    }
  } catch { /* 读不出来就当没开 */ }
  return { enabled: false, deviceId: uid('d'), base: emptySync() }
}

export function saveSync(s: SyncLocal) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* 存不了就算了 */ }
}
