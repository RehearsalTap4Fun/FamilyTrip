import { useEffect, useState } from 'react'
import { tripProgress } from '@core/progress'
import type { Rating } from '@core/ratings'
import type { Trip } from '@core/types'
import { KEY as STATE_KEY, currentTrip, DEVICE_THEMES, THEME_LABEL, loadState, nowOf, restoreSamples, saveState, withTrip, type AppState, type Theme } from './store/state'
import { sortTrips } from '@core/trips'
import { NewTripSheet } from './ui/NewTrip'
import { TripSwitcher } from './ui/TripSwitcher'
import { PlanSheet } from './ui/PlanSheet'
import { useToast } from './ui/kit/Toast'
import { StorageSection } from './ui/CloudSync'
import { JoinSheet, ShareCard } from './ui/ShareTrip'
import { joinCodeFromHash } from './sync/share'
import { useCloudSync } from './sync/useCloudSync'
import { backupFileName, exportBackup, importBackup } from './store/backup'
import { PartyPage } from './ui/Party'
import { FootprintPage } from './ui/Footprint'
import { SettingsCtx } from './ui/Settings'
import { ScopeToday } from './ui/ScopeToday'
import { ScopeTrip } from './ui/ScopeTrip'
import { RatingsPage } from './ui/Ratings'
import { ToastProvider } from './ui/kit/Toast'
import { TabIcon } from './ui/symbols'
import { Today } from './ui/Today'
import { TripPage } from './ui/Trip'

type Tab = 'today' | 'trip' | 'party' | 'ratings' | 'footprint'
const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: '今天' },
  { id: 'trip', label: '行程' },
  { id: 'party', label: '同行' },
  { id: 'ratings', label: '红黑榜' },
  { id: 'footprint', label: '足迹' },
]

function initialTab(): Tab {
  const h = location.hash.slice(1) as Tab
  if (TABS.some(x => x.id === h)) return h
  try { const t = sessionStorage.getItem('tonglu.tab') as Tab | null; if (t && TABS.some(x => x.id === t)) return t } catch { /* 忽略 */ }
  return 'today'
}

export function App() {
  return <ToastProvider><AppInner /></ToastProvider>
}

function AppInner() {
  const [state, setState] = useState<AppState>(() => {
    // ?theme= 只在打开时生效一次，写进设置；之后在「同行」页照常切换
    const s = loadState()
    const t = new URLSearchParams(location.search).get('theme') as Theme | null
    return t && t in THEME_LABEL ? { ...s, theme: t } : s
  })
  const [tab, setTab] = useState<Tab>(initialTab)
  useEffect(() => saveState(state), [state])
  // 同时开着几个标签页时，别处改了存档就跟上，免得这页拿旧状态一保存把别处刚填的 Key、刚打的卡覆盖掉
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === STATE_KEY && e.newValue) setState(loadState()) }
    addEventListener('storage', onStorage)
    return () => removeEventListener('storage', onStorage)
  }, [])
  useEffect(() => { try { sessionStorage.setItem('tonglu.tab', tab) } catch { /* 忽略 */ } }, [tab])

  // 回到应用（从后台切回来、重新聚焦）时重新取一次「现在」：不做定时刷新
  const [, setSeen] = useState(0)
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') setSeen(n => n + 1) }
    document.addEventListener('visibilitychange', again)
    addEventListener('focus', again)
    return () => { document.removeEventListener('visibilitychange', again); removeEventListener('focus', again) }
  }, [])
  const now = nowOf(state)
  const toast = useToast()
  const cloud = useCloudSync(state, setState, toast)
  // 存档：下载一个 JSON 文件（不含 Key）
  const doExport = () => {
    const blob = new Blob([exportBackup(state)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = backupFileName()
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    toast('存档文件已导出')
  }
  // 读存档：没开同步就整份替换；开着同步只合并（整份替换会让存档里没有的行程在所有设备上被删掉）。本机的 Key 保留
  const doImport = (text: string) => {
    let got: AppState
    try { got = importBackup(text).state } catch (e) { toast(e instanceof Error ? e.message : '导入失败'); return }
    const before = state
    setState(s => {
      const keep = { amapKey: s.amapKey, llmKeys: s.llmKeys, zhipuKey: s.zhipuKey }
      if (!cloud.sync.enabled) return { ...got, ...keep }
      const ids = new Set(got.trips.map(t => t.id))
      const rids = new Set(got.ratings.map(r => r.id))
      return { ...s, trips: [...s.trips.filter(t => !ids.has(t.id)), ...got.trips], ratings: [...s.ratings.filter(r => !rids.has(r.id)), ...got.ratings] }
    })
    toast(`已导入 ${got.trips.filter(t => !t.sample).length} 趟行程`, () => setState(before))
  }
  const trip = currentTrip(state)
  const onTrip = (t: Trip) => setState(s => withTrip(s, t))
  const onRatings = (ratings: Rating[]) => setState(s => ({ ...s, ratings }))
  const liveDay = tripProgress(trip, now).dayIndex
  const [switching, setSwitching] = useState(false)
  const [creating, setCreating] = useState(false)
  const [planning, setPlanning] = useState(false)
  // 邀请链接 #join=分享码：打开就弹出加入面板（码在 # 后面，不会发到服务器）
  const [joining, setJoining] = useState<string | null>(() => joinCodeFromHash(location.hash))
  useEffect(() => { if (joinCodeFromHash(location.hash)) history.replaceState(null, '', location.pathname + location.search + '#trip') }, [])
  const theme: Theme = state.theme ?? 'braun'
  const device = DEVICE_THEMES.includes(theme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    if (device) document.documentElement.dataset.family = 'device'
    else delete document.documentElement.dataset.family
  }, [theme, device])

  return (
    <SettingsCtx.Provider value={{ amapKey: state.amapKey ?? '', llm: { provider: state.llmProvider ?? 'anthropic', apiKey: state.llmKeys?.[state.llmProvider ?? 'anthropic'] ?? '' }, zhipuKey: state.zhipuKey ?? '' }}>
    <div className="app">
      <main className="sheet" key={tab}>
        <div className="sheet-body">
          {tab === 'today' && (device ? <ScopeToday trip={trip} now={now} demo={!!state.demoNow} onTrip={onTrip} /> : <Today trip={trip} now={now} demo={!!state.demoNow} onTrip={onTrip} />)}
          {tab === 'trip' && (device ? <ScopeTrip trip={trip} onTrip={onTrip} ratings={state.ratings} onSwitch={() => setSwitching(true)} onNew={() => setCreating(true)} onPlan={() => setPlanning(true)} tripCount={state.trips.length} /> : <TripPage trip={trip} onTrip={onTrip} onSwitch={() => setSwitching(true)} onNew={() => setCreating(true)} onPlan={() => setPlanning(true)} tripCount={state.trips.length} />)}
          {tab === 'party' && <PartyPage trip={trip} onTrip={onTrip} demoNow={state.demoNow} onDemoNow={v => setState(s => ({ ...s, demoNow: v }))} onReset={() => setState(restoreSamples)} theme={theme} onTheme={t => setState(s => ({ ...s, theme: t }))} amapKey={state.amapKey ?? ''} onAmapKey={k => setState(s => ({ ...s, amapKey: k }))}
            llmProvider={state.llmProvider ?? 'anthropic'} llmKeys={state.llmKeys ?? {}} onLlm={(provider, keys) => setState(s => ({ ...s, llmProvider: provider, llmKeys: keys }))}
            zhipuKey={state.zhipuKey ?? ''} onZhipuKey={k => setState(s => ({ ...s, zhipuKey: k || undefined }))}
            shareSlot={<ShareCard trip={trip} status={cloud.sync.shares?.[trip.id]} syncing={cloud.share.syncing.includes(trip.id)}
              onShare={() => { cloud.share.shareTrip(trip.id); toast('已生成分享码，复制邀请发给同行的人') }} onSyncNow={() => cloud.share.syncNow(trip.id)} onStop={del => cloud.share.stopShare(trip.id, del)} />}
            extra={<StorageSection sync={cloud.sync} syncing={cloud.syncing} onEnable={cloud.enable} onDisable={cloud.disable} onSyncNow={cloud.syncNow} onExport={doExport} onImport={doImport} />} />}
          {tab === 'footprint' && <FootprintPage trips={state.trips} />}
          {tab === 'ratings' && <RatingsPage trip={trip} ratings={state.ratings} onRatings={onRatings} dayIndex={liveDay} />}
        </div>
      </main>
      <TripsLayer state={state} setState={setState} now={now} switching={switching} creating={creating} planning={planning}
        onSwitching={setSwitching} onCreating={setCreating} onPlanning={setPlanning} onCreated={() => setTab('trip')}
        onJoin={() => { setSwitching(false); setJoining('') }} />
      <JoinSheet open={joining != null} initialCode={joining ?? ''} onClose={() => setJoining(null)}
        onJoin={async code => { const t = await cloud.share.joinTrip(code); setJoining(null); setTab('trip'); toast(`已加入「${t.title}」`) }} />
      <nav className="tabs" aria-label="页面">
        {TABS.map(t => (
          <button key={t.id} type="button" className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            <TabIcon name={t.id} />{t.label}
          </button>
        ))}
      </nav>
    </div>
    </SettingsCtx.Provider>
  )
}

/** 切换行程与新建行程的两个面板；放在 ToastProvider 里面，删除才能给撤销 */
function TripsLayer({ state, setState, now, switching, creating, planning, onSwitching, onCreating, onPlanning, onCreated, onJoin }: {
  state: AppState
  setState: React.Dispatch<React.SetStateAction<AppState>>
  now: Date
  switching: boolean
  creating: boolean
  planning: boolean
  onSwitching: (v: boolean) => void
  onCreating: (v: boolean) => void
  onPlanning: (v: boolean) => void
  onJoin: () => void
  onCreated: () => void
}) {
  const toast = useToast()
  // 新行程沿用最近一趟的同行：进行中 > 最近出发的计划中 > 最近去过的
  const base = sortTrips(state.trips, now)[0]?.party
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const remove = (id: string) => {
    const before = state
    const t = state.trips.find(x => x.id === id)
    setState(s => {
      const trips = s.trips.filter(x => x.id !== id)
      return { ...s, trips, currentId: s.currentId === id ? sortTrips(trips, now)[0].id : s.currentId }
    })
    toast(`已删除「${t?.title ?? ''}」`, () => setState(before))
  }
  return (
    <>
      <TripSwitcher open={switching} trips={state.trips} currentId={state.currentId} now={now}
        onPick={id => { setState(s => ({ ...s, currentId: id })); onSwitching(false) }}
        onDelete={remove} onNew={() => { onSwitching(false); onCreating(true) }} onJoin={onJoin} onClose={() => onSwitching(false)} />
      <NewTripSheet open={creating} base={base} today={today} onClose={() => onCreating(false)}
        onCreate={t => {
          setState(s => ({ ...s, trips: [...s.trips, t], currentId: t.id }))
          onCreating(false); onCreated()
          // 建好直接去排：「我知道要去哪些地方」列点，「只知道大概去哪」让 AI 推荐
          onPlanning(true)
        }} />
      <PlanSheet open={planning} trip={currentTrip(state)} ratings={state.ratings} onClose={() => onPlanning(false)}
        onApply={t => {
          const before = state
          setState(s => withTrip(s, t))
          onPlanning(false)
          toast(`已排好「${t.title}」`, () => setState(before))
        }} />
    </>
  )
}
