// 云同步什么时候跑（与饮食日记一致）：开启时、打开应用、回到前台、改动后 4 秒。没有定时轮询。
// 改动后 4 秒先打时间戳（离线也记下改的时刻），再联网；同步途中又改了的，回来时一并打上并进去，不会被云端结果冲掉。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applySync, emptySync, fingerprint, mergeSync, prefsOf, stamp } from './account'
import { deleteRemote, SyncError, syncOnce } from './client'
import { loadSync, saveSync, type SyncLocal } from '../store/syncStore'
import type { AppState } from '../store/state'

type Toast = (msg: string, undo?: () => void) => void

export function useCloudSync(state: AppState, setState: (f: (s: AppState) => AppState) => void, toast: Toast) {
  const [sync, setSyncRaw] = useState<SyncLocal>(loadSync)
  const syncRef = useRef(sync)
  const stateRef = useRef(state)
  stateRef.current = state
  const setSync = useCallback((f: (s: SyncLocal) => SyncLocal) => {
    const n = f(syncRef.current)
    syncRef.current = n
    saveSync(n)
    setSyncRaw(n)
  }, [])
  const [syncing, setSyncing] = useState(false)
  const busy = useRef(false)
  const again = useRef(false)

  const run = useCallback(async (manual: boolean) => {
    const s0 = syncRef.current
    if (!s0.enabled || !s0.code) return
    if (busy.current) { again.current = true; return }
    busy.current = true
    setSyncing(true)
    try {
      const stamped = stamp(s0.base, stateRef.current, Date.now(), s0.deviceId)
      const r = await syncOnce(stamped, s0.code)
      // 这一轮途中又改了的：打上时间戳并进合并结果，下一轮再推
      const late = stamp(stamped, stateRef.current, Date.now(), s0.deviceId)
      const changedMeanwhile = fingerprint(late) !== fingerprint(stamped)
      const final = changedMeanwhile ? mergeSync(r.merged, late) : r.merged
      if (r.pulled || changedMeanwhile) setState(cur => applySync(cur, final))
      setSync(x => ({ ...x, base: final, lastSyncAt: Date.now(), version: r.version, lastError: undefined }))
      if (changedMeanwhile) again.current = true
      if (manual) toast(r.pulled ? '已从云端合并最新的行程' : r.pushed ? '已推送到云端' : '云端已是最新')
    } catch (e) {
      const msg = e instanceof SyncError ? e.message : e instanceof Error ? e.message : String(e)
      setSync(x => ({ ...x, lastError: msg }))
      if (manual) toast('同步失败：' + msg)
    } finally {
      busy.current = false
      setSyncing(false)
      if (again.current) { again.current = false; setTimeout(() => run(false), 500) }
    }
  }, [setState, setSync, toast])

  // 改动后 4 秒：先打时间戳，再同步
  const fp = useMemo(() => JSON.stringify([state.trips.filter(t => !t.sample), state.ratings, state.theme, state.llmProvider]), [state.trips, state.ratings, state.theme, state.llmProvider])
  useEffect(() => {
    if (!sync.enabled) return
    const t = setTimeout(() => {
      const s0 = syncRef.current
      const stamped = stamp(s0.base, stateRef.current, Date.now(), s0.deviceId)
      if (fingerprint(stamped) === fingerprint(s0.base)) return
      setSync(x => ({ ...x, base: stamped }))
      run(false)
    }, 4000)
    return () => clearTimeout(t)
  }, [fp, sync.enabled, run, setSync])

  // 打开应用、回到前台
  useEffect(() => {
    if (syncRef.current.enabled) run(false)
    const onVis = () => { if (document.visibilityState === 'visible') run(false) }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [run])

  const enable = useCallback((code: string, mode: 'new' | 'join') => {
    // 接入已有的同步码：云端的偏好（风格、大模型）优先，本机的行程照样并进去
    const base = mode === 'join' ? { ...emptySync(), prefs: { v: prefsOf(stateRef.current), t: 0, by: '' } } : emptySync()
    setSync(x => ({ ...x, enabled: true, code, base, lastError: undefined, lastSyncAt: undefined, version: undefined }))
    toast(mode === 'new' ? '云同步已开启，正在上传…' : '已接入，正在合并云端的行程…')
    setTimeout(() => run(true), 0)
  }, [run, setSync, toast])

  const disable = useCallback(async (removeRemote: boolean) => {
    const code = syncRef.current.code
    setSync(x => ({ ...x, enabled: false, code: undefined, base: emptySync(), lastError: undefined }))
    if (removeRemote && code) {
      try { await deleteRemote(code); toast('已关闭同步，并删除了云端副本') } catch { toast('已在本机关闭；云端副本没删掉（连不上），可以之后再试') }
    } else toast('已在本机关闭云同步')
  }, [setSync, toast])

  return { sync, syncing, syncNow: () => run(true), enable, disable }
}
