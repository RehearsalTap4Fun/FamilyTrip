// 云同步什么时候跑（与饮食日记一致）：开启时、打开应用、回到前台、改动后 4 秒。没有定时轮询。
// 改动后 4 秒先打时间戳（离线也记下改的时刻），再联网；同步途中又改了的，回来时一并打上并进去，不会被云端结果冲掉。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applySync, emptySync, fingerprint, mergeSync, prefsOf, stamp } from './account'
import { deleteBlob, deleteRemote, readBlob, syncBlob, SyncError, syncOnce } from './client'
import { applyShare, mergeShare, shareFp, shareKeys, stampShare, type ShareBlob } from './share'
import { generateSyncCode, normalizeSyncCode } from './crypto'
import { docToTrip } from './tripDoc'
import type { Trip } from '@core/types'
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

  // ———————— 单趟分享 ————————
  const shareBusy = useRef(new Set<string>())
  const shareAgain = useRef(new Set<string>())
  const [shareSyncing, setShareSyncing] = useState<string[]>([])

  const runTrip = useCallback(async (id: string, manual: boolean) => {
    const trip = stateRef.current.trips.find(t => t.id === id)
    if (!trip?.share) return
    if (shareBusy.current.has(id)) { shareAgain.current.add(id); return }
    shareBusy.current.add(id)
    setShareSyncing(x => [...x, id])
    const code = trip.share.code
    const dev = syncRef.current.deviceId
    const prev = syncRef.current.shares?.[id]
    try {
      const stamped = stampShare(prev?.base ?? {}, trip, stateRef.current.ratings, Date.now(), dev)
      // 同步成功过一次之后，云端空了就是对方停止了分享：不能把自己手里的再推上去（那等于又建了回来）
      const r = await syncBlob<ShareBlob>({ v: 1, doc: stamped }, shareKeys(code), mergeShare, shareFp, { onEmpty: prev?.version ? 'gone' : 'create' })
      const nowTrip = stateRef.current.trips.find(t => t.id === id)
      const late = nowTrip ? stampShare(stamped, nowTrip, stateRef.current.ratings, Date.now(), dev) : stamped
      const changedMeanwhile = shareFp({ v: 1, doc: late }) !== shareFp({ v: 1, doc: stamped })
      const final = changedMeanwhile ? mergeShare(r.merged, { v: 1, doc: late }) : r.merged
      if (r.pulled || changedMeanwhile) setState(cur => (cur.trips.some(t => t.id === id && t.share) ? applyShare(cur, id, final.doc) : cur))
      setSync(x => ({ ...x, shares: { ...x.shares, [id]: { base: final.doc, lastSyncAt: Date.now(), version: r.version } } }))
      if (changedMeanwhile) shareAgain.current.add(id)
      if (manual) toast(r.pulled ? '已合并同行好友的改动' : r.pushed ? '已推送给同行好友' : '这趟已是最新')
    } catch (e) {
      if (e instanceof SyncError && e.kind === 'gone') {
        // 分享停止了：行程留在本机，变回自己的
        setState(cur => ({ ...cur, trips: cur.trips.map(t => (t.id === id ? { ...t, share: undefined } : t)) }))
        setSync(x => { const sh = { ...x.shares }; delete sh[id]; return { ...x, shares: sh } })
        toast(`「${trip.title}」的分享已经停止，这趟留在你这里了`)
      } else {
        const msg = e instanceof Error ? e.message : String(e)
        setSync(x => ({ ...x, shares: { ...x.shares, [id]: { ...(x.shares?.[id] ?? { base: {} }), lastError: msg } } }))
        if (manual) toast('同步这趟失败：' + msg)
      }
    } finally {
      shareBusy.current.delete(id)
      setShareSyncing(x => x.filter(v => v !== id))
      if (shareAgain.current.has(id)) { shareAgain.current.delete(id); setTimeout(() => runTrip(id, false), 500) }
    }
  }, [setState, setSync, toast])

  const sharedIds = state.trips.filter(t => t.share).map(t => t.id).join(',')
  const runAllShares = useCallback(() => { for (const t of stateRef.current.trips) if (t.share) runTrip(t.id, false) }, [runTrip])

  // 共享的那几趟改了：4 秒后打时间戳再同步（只同步真的变了的那趟）
  const shareFpNow = useMemo(() => JSON.stringify(state.trips.filter(t => t.share).map(t => [t, state.ratings.filter(r => r.tripId === t.id)])), [state.trips, state.ratings])
  useEffect(() => {
    if (!sharedIds) return
    const timer = setTimeout(() => {
      for (const t of stateRef.current.trips) {
        if (!t.share) continue
        const prev = syncRef.current.shares?.[t.id]
        const stamped = stampShare(prev?.base ?? {}, t, stateRef.current.ratings, Date.now(), syncRef.current.deviceId)
        if (!prev || shareFp({ v: 1, doc: stamped }) !== shareFp({ v: 1, doc: prev.base })) runTrip(t.id, false)
      }
    }, 4000)
    return () => clearTimeout(timer)
  }, [shareFpNow, sharedIds, runTrip])

  // 打开、回到前台，以及开着应用时每分钟拉一次（旅途中大家要看彼此的打卡）
  useEffect(() => {
    if (!sharedIds) return
    runAllShares()
    const onVis = () => { if (document.visibilityState === 'visible') runAllShares() }
    document.addEventListener('visibilitychange', onVis)
    const iv = setInterval(() => { if (document.visibilityState === 'visible') runAllShares() }, 60000)
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(iv) }
  }, [sharedIds, runAllShares])

  // 删掉了的共享行程：本机的记账一起清掉
  useEffect(() => {
    const ids = new Set(state.trips.map(t => t.id))
    const stale = Object.keys(syncRef.current.shares ?? {}).filter(id => !ids.has(id))
    if (stale.length) setSync(x => { const sh = { ...x.shares }; for (const id of stale) delete sh[id]; return { ...x, shares: sh } })
  }, [state.trips, setSync])

  /** 分享这一趟：生成分享码，先推一版上去 */
  const shareTrip = useCallback((id: string) => {
    const code = generateSyncCode()
    setState(cur => ({ ...cur, trips: cur.trips.map(t => (t.id === id ? { ...t, share: { code, role: 'owner' } } : t)) }))
    setSync(x => ({ ...x, shares: { ...x.shares, [id]: { base: {} } } }))
    setTimeout(() => runTrip(id, true), 0)
    return code
  }, [runTrip, setState, setSync])

  /** 用好友的分享码加入：先只读看看有没有这一趟；已经有了就直接切过去 */
  const joinTrip = useCallback(async (input: string): Promise<Trip> => {
    const code = normalizeSyncCode(input)
    if (!code) throw new Error('分享码格式不对：应该是 24 位（6 组 4 位）')
    const { value, version } = await readBlob<ShareBlob>(shareKeys(code))
    if (!value?.doc?.meta?.v) throw new Error('这个分享码下面没有行程：码抄错了，或者对方已经停止分享')
    const { trip } = docToTrip(value.doc)
    setState(cur => {
      const withShare = applyShare(cur, trip.id, value.doc)
      return { ...withShare, trips: withShare.trips.map(t => (t.id === trip.id ? { ...t, share: t.share ?? { code, role: 'member' }, sample: undefined } : t)), currentId: trip.id }
    })
    setSync(x => ({ ...x, shares: { ...x.shares, [trip.id]: { base: value.doc, lastSyncAt: Date.now(), version } } }))
    return trip
  }, [setState, setSync])

  /** 停止分享（我分享的，可选删掉云端）/ 退出（我加入的）。行程都留在本机 */
  const stopShare = useCallback(async (id: string, deleteCloud: boolean) => {
    const trip = stateRef.current.trips.find(t => t.id === id)
    if (!trip?.share) return
    const { code, role } = trip.share
    setState(cur => ({ ...cur, trips: cur.trips.map(t => (t.id === id ? { ...t, share: undefined } : t)) }))
    setSync(x => { const sh = { ...x.shares }; delete sh[id]; return { ...x, shares: sh } })
    if (deleteCloud && role === 'owner') {
      try { await deleteBlob(shareKeys(code)); toast('已停止分享，云端这趟删掉了；好友那边会留着现在的版本') } catch { toast('已在本机停止；云端没删掉（连不上），可以之后再试') }
    } else toast(role === 'owner' ? '已在本机停止同步这趟；好友那边照常' : `已退出「${trip.title}」，这趟留在你这里`)
  }, [setState, setSync, toast])

  return {
    sync, syncing, syncNow: () => run(true), enable, disable,
    share: { syncing: shareSyncing, syncNow: (id: string) => runTrip(id, true), shareTrip, joinTrip, stopShare },
  }
}
