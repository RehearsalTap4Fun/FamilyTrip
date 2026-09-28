// 存档：整份状态导出成一个 JSON 文件，换设备、重装、想留个底时用。各种 Key 不导出。
import { migrate, type AppState } from './state'

export interface Backup { app: 'tonglu'; exportedAt: string; state: AppState }

export function exportBackup(s: AppState, now = new Date()): string {
  const { amapKey: _a, llmKeys: _l, ...rest } = s
  return JSON.stringify({ app: 'tonglu', exportedAt: now.toISOString(), state: rest } satisfies Backup, null, 2)
}

export function backupFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `同路存档-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`
}

/** 读存档：认不出来就报可读的错；旧版存档照常升级。本机的 Key 由调用方保留 */
export function importBackup(text: string): { state: AppState; exportedAt?: string } {
  let j: unknown
  try { j = JSON.parse(text) } catch { throw new Error('不是有效的存档文件（JSON 解析失败）') }
  const b = j as Partial<Backup>
  // 也接受直接粘贴的整份状态（没有外面那层包装）
  const raw = b && b.app === 'tonglu' ? b.state : j
  const st = migrate(raw)
  if (!st) throw new Error('看不懂这个存档：不是同路导出的，或者文件坏了')
  return { state: st, exportedAt: b?.exportedAt }
}
