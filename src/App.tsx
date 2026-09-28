import { useEffect, useState } from 'react'
import { tripProgress } from '@core/progress'
import type { Rating } from '@core/ratings'
import type { Trip } from '@core/types'
import { KEY as STATE_KEY, defaultState, DEVICE_THEMES, THEME_LABEL, loadState, nowOf, saveState, type AppState, type Theme } from './store/state'
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
  const onTrip = (trip: Trip) => setState(s => ({ ...s, trip }))
  const onRatings = (ratings: Rating[]) => setState(s => ({ ...s, ratings }))
  const liveDay = tripProgress(state.trip, now).dayIndex
  const theme: Theme = state.theme ?? 'braun'
  const device = DEVICE_THEMES.includes(theme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    if (device) document.documentElement.dataset.family = 'device'
    else delete document.documentElement.dataset.family
  }, [theme, device])

  return (
    <SettingsCtx.Provider value={{ amapKey: state.amapKey ?? '', llm: { provider: state.llmProvider ?? 'anthropic', apiKey: state.llmKeys?.[state.llmProvider ?? 'anthropic'] ?? '' } }}>
    <ToastProvider>
    <div className="app">
      <main className="sheet" key={tab}>
        <div className="sheet-body">
          {tab === 'today' && (device ? <ScopeToday trip={state.trip} now={now} demo={!!state.demoNow} onTrip={onTrip} /> : <Today trip={state.trip} now={now} demo={!!state.demoNow} onTrip={onTrip} />)}
          {tab === 'trip' && (device ? <ScopeTrip trip={state.trip} onTrip={onTrip} ratings={state.ratings} /> : <TripPage trip={state.trip} onTrip={onTrip} />)}
          {tab === 'party' && <PartyPage trip={state.trip} onTrip={onTrip} demoNow={state.demoNow} onDemoNow={v => setState(s => ({ ...s, demoNow: v }))} onReset={() => setState(s => ({ ...defaultState(), theme: s.theme, amapKey: s.amapKey, llmProvider: s.llmProvider, llmKeys: s.llmKeys }))} theme={theme} onTheme={t => setState(s => ({ ...s, theme: t }))} amapKey={state.amapKey ?? ''} onAmapKey={k => setState(s => ({ ...s, amapKey: k }))}
            llmProvider={state.llmProvider ?? 'anthropic'} llmKeys={state.llmKeys ?? {}} onLlm={(provider, keys) => setState(s => ({ ...s, llmProvider: provider, llmKeys: keys }))} />}
          {tab === 'footprint' && <FootprintPage trips={[...(state.history ?? []), state.trip]} />}
          {tab === 'ratings' && <RatingsPage trip={state.trip} ratings={state.ratings} onRatings={onRatings} dayIndex={liveDay} />}
        </div>
      </main>
      <nav className="tabs" aria-label="页面">
        {TABS.map(t => (
          <button key={t.id} type="button" className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            <TabIcon name={t.id} />{t.label}
          </button>
        ))}
      </nav>
    </div>
    </ToastProvider>
    </SettingsCtx.Provider>
  )
}
