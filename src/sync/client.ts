// 同步客户端：拉取 → 合并 → 需要时推送（版本冲突就再拉再合并再推）。与饮食日记的 sync 同一套协议。
import { decryptJson, deriveKeys, encryptJson, type SyncKeys } from './crypto'
import { fingerprint, mergeSync, type SyncState } from './account'

export interface RemoteRec { version: number; blob: string | null; updatedAt: number }

export interface SyncResult {
  /** 合并后的完整状态：写回应用，同时作为下一次打时间戳的基准 */
  merged: SyncState
  version: number
  pushed: boolean
  /** 云端带来了本机没有的改动 */
  pulled: boolean
}

export class SyncError extends Error {
  constructor(message: string, public readonly kind: 'network' | 'server' | 'decrypt' | 'conflict') { super(message) }
}

/** 线上同站调用；本地开发调线上那一份（服务端允许 localhost:5321 跨域） */
export function syncApi(): string {
  return typeof location !== 'undefined' && location.hostname === '47.109.97.108' ? new URL('./api', location.href).toString().replace(/\/$/, '') : 'https://47.109.97.108/trip/api'
}

async function getRemote(base: string, id: string, f: typeof fetch): Promise<RemoteRec> {
  let res: Response
  try { res = await f(`${base}/sync/${id}?t=${Date.now()}`, { cache: 'no-store' }) } catch (e) { throw new SyncError('连不上同步服务：' + (e instanceof Error ? e.message : String(e)), 'network') }
  if (!res.ok) throw new SyncError(`同步服务返回 ${res.status}`, 'server')
  return (await res.json()) as RemoteRec
}

async function putRemote(base: string, id: string, blob: string, baseVersion: number, f: typeof fetch): Promise<{ ok: true; version: number } | { ok: false; current: RemoteRec }> {
  let res: Response
  try { res = await f(`${base}/sync/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blob, baseVersion }) }) } catch (e) { throw new SyncError('推送失败：' + (e instanceof Error ? e.message : String(e)), 'network') }
  if (res.status === 409) return { ok: false, current: (await res.json()) as RemoteRec }
  if (!res.ok) throw new SyncError(`同步服务返回 ${res.status}`, 'server')
  return { ok: true, version: ((await res.json()) as { version: number }).version }
}

function decode(keys: SyncKeys, rec: RemoteRec): SyncState | null {
  if (!rec.blob) return null
  try { return decryptJson<SyncState>(keys, rec.blob) } catch { throw new SyncError('云端数据解不开：同步码不对，或数据已损坏', 'decrypt') }
}

export async function syncOnce(local: SyncState, code: string, opts: { fetchImpl?: typeof fetch; apiBase?: string } = {}): Promise<SyncResult> {
  const f = opts.fetchImpl ?? fetch
  const base = (opts.apiBase ?? syncApi()).replace(/\/$/, '')
  const keys = deriveKeys(code)
  let rec = await getRemote(base, keys.id, f)
  let pushed = false
  for (let attempt = 0; attempt < 4; attempt++) {
    const remote = decode(keys, rec)
    const merged = remote ? mergeSync(local, remote) : local
    const fp = fingerprint(merged)
    const pulled = fp !== fingerprint(local)
    if (remote && fp === fingerprint(remote)) return { merged, version: rec.version, pushed, pulled }
    const r = await putRemote(base, keys.id, encryptJson(keys, merged), rec.version, f)
    if (r.ok) { pushed = true; return { merged, version: r.version, pushed, pulled } }
    rec = r.current
  }
  throw new SyncError('多次版本冲突，稍后再试', 'conflict')
}

/** 关闭同步时可选择删除云端副本 */
export async function deleteRemote(code: string, opts: { fetchImpl?: typeof fetch; apiBase?: string } = {}): Promise<void> {
  const f = opts.fetchImpl ?? fetch
  const base = (opts.apiBase ?? syncApi()).replace(/\/$/, '')
  await f(`${base}/sync/${deriveKeys(code).id}`, { method: 'DELETE' })
}
