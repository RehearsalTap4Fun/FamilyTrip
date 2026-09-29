// 「行程」：每天一张卡，曲线对着当天最严的上限。点开一天：站点可左滑跳过 / 删除、按住把手拖动排序、点一下打开面板。
// 以后主要是 AI 排好、这里微调，所以没有表单，只有面板。
import { useState } from 'react'
import { deriveConstraints } from '@core/constraints'
import { inRange, partyOnDay } from '@core/party'
import { fmtHM, parseHM, scheduleDay } from '@core/schedule'
import type { Trip } from '@core/types'
import { checkDay, checkTrip, LODGING_PLACEHOLDER, type Issue } from '@core/validate'
import { uid } from '../store/state'
import { dayTitle, driveHours, fmtShort, MODE_LABEL, routeCode, stripCode } from './format'
import { Stepper } from './kit/controls'
import { useToast } from './kit/Toast'
import { SwipeList } from './kit/SwipeList'
import { Chip } from './ScopeToday'
import { traceOf } from './scopeMath'
import { AddStopSheet, IssueSheet, removeStop, setStop, StopSheet } from './StopSheet'
import { AmapError, driveBetween } from '../geo/amap'
import type { Rating } from '@core/ratings'
import { ReplanSheet } from './ReplanSheet'
import { TripActions } from './TripSwitcher'
import { HighlightsCard } from './Highlights'
import { RouteBoard } from './RouteBoard'
import { fillDrives } from '../geo/fillDrives'
import { useSettings } from './Settings'

const W = 300
const H = 34

export function ScopeTrip({ trip, onTrip, ratings, onSwitch, onNew, onPlan, tripCount }: { trip: Trip; onTrip: (t: Trip) => void; ratings: Rating[]; onSwitch: () => void; onNew: () => void; onPlan: () => void; tripCount: number }) {
  const [open, setOpen] = useState<number | null>(null)
  const [stopId, setStopId] = useState<string | null>(null)
  const [stopClosing, setStopClosing] = useState(false)
  const openStop = (id: string) => { setStopClosing(false); setStopId(id) }
  const [adding, setAdding] = useState(false)
  const [issue, setIssue] = useState<Issue | null>(null)
  const [replanning, setReplanning] = useState(false)
  const toast = useToast()
  const { amapKey } = useSettings()
  const [filling, setFilling] = useState<number | null>(null)
  const fill = async (i: number) => {
    if (!amapKey) { toast('先在「同行」页最下面填上高德 Key'); return }
    const before = trip
    setFilling(i)
    try {
      const { trip: t, changes } = await fillDrives(trip, i, (a, b) => driveBetween(a, b, amapKey))
      if (!changes.length) toast('车程和高德一致，不用改')
      else { onTrip(t); toast(`按高德更新了 ${changes.length} 段车程`, () => onTrip(before)) }
    } catch (e) {
      toast(e instanceof AmapError ? e.message : '补车程失败')
    } finally { setFilling(null) }
  }
  // 操作提示只给到第一次左滑或拖动为止
  const [learned, setLearned] = useState(() => { try { return localStorage.getItem('tonglu.learned.swipe') === '1' } catch { return false } })
  const learn = () => { if (learned) return; setLearned(true); try { localStorage.setItem('tonglu.learned.swipe', '1') } catch { /* 存不了就算了 */ } }
  const all = checkTrip(trip)
  const fails = all.filter(i => i.level === 'error').length
  const warns = all.filter(i => i.level === 'warn').length

  const addDay = () => {
    onTrip({ ...trip, days: [...trip.days, { startTime: '09:00', stops: [{ id: uid('s'), kind: 'lodging', name: LODGING_PLACEHOLDER, durationMin: 0, status: 'planned' }] }] })
    setOpen(trip.days.length)
  }
  const removeDay = (i: number) => {
    const before = trip
    onTrip({ ...trip, days: trip.days.filter((_, k) => k !== i) })
    setOpen(null)
    toast(`已删掉第 ${i + 1} 天`, () => onTrip(before))
  }
  const delStop = (dayIndex: number, id: string) => {
    const before = trip
    const name = trip.days[dayIndex].stops.find(s => s.id === id)?.name
    setStopId(null)
    onTrip(removeStop(trip, dayIndex, id))
    toast(`已删除 ${name}`, () => onTrip(before))
  }
  const move = (dayIndex: number, from: number, to: number) => {
    const stops = [...trip.days[dayIndex].stops]
    const [s] = stops.splice(from, 1)
    stops.splice(to, 0, s)
    onTrip({ ...trip, days: trip.days.map((d, i) => (i === dayIndex ? { ...d, stops } : d)) })
  }

  return (
    <div className="scope-trip">
      <header className="bez-top">
        <button type="button" className="trip-switch" onClick={onSwitch} aria-haspopup="dialog" aria-label={`${trip.title}，切换或新建行程`}>
          <h1>{trip.title}<svg className="caret" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg><small>{fmtShort(trip.startDate, 0)}–{fmtShort(trip.startDate, trip.days.length - 1)} {MODE_LABEL[trip.party.mode]}</small></h1>
        </button>
        <span className={'run' + (fails ? ' fail' : warns ? ' hold' : '')}>{fails || warns ? `${fails ? `${fails} 必改 ` : ''}${warns} 留意` : '没问题'}</span>
      </header>
      <TripActions count={tripCount} onSwitch={onSwitch} onNew={onNew} trip={trip} onPlan={onPlan} />
      <HighlightsCard trip={trip} onTrip={onTrip} />
      <RouteBoard trip={trip} onPick={(d, id) => { setOpen(d); openStop(id) }} />
      <ol className="sweeps">
        {trip.days.map((d, i) => {
          const c = deriveConstraints(partyOnDay(trip.party, i))
          const slots = scheduleDay(d, { includeSkipped: true })
          const pts = traceOf(scheduleDay(d))
          const issues = checkDay(trip, i)
          const serious = issues.filter(x => x.level !== 'tip')
          const tips = issues.length - serious.length
          const planned = pts.length ? pts[pts.length - 1].v : 0
          const t0 = pts[0]?.t ?? 480
          const t1 = Math.max(t0 + 360, pts[pts.length - 1]?.t ?? 0)
          const vmax = Math.max(600, planned)
          const px = (t: number) => ((t - t0) / (t1 - t0)) * W
          const py = (v: number) => H - (v / vmax) * H
          const failed = serious.some(x => x.level === 'error')
          const absent = [...trip.party.members, ...trip.party.pets].filter(m => !inRange(i, m.days)).map(m => m.name)
          const isOpen = open === i
          const slotOf = new Map(slots.map(s => [s.stop.id, s]))
          return (
            <li key={i} className={'sw' + (isOpen ? ' open' : '')}>
              <button type="button" className="sw-hd" onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen}>
                <span className="d mono">{i + 1}<small>{fmtShort(trip.startDate, i)}</small></span>
                <span className="b">
                  <span className="rt">{dayTitle(d)}<span>{driveHours(d) > 0 ? `驾车 ${driveHours(d).toFixed(1)}h` : ''}</span></span>
                  <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
                    <line x1="0" x2={W} y1={py(c.activeMin.value)} y2={py(c.activeMin.value)} className="trig" stroke="var(--seg-dim)" />
                    <path d={pts.map((p, k) => `${k ? 'L' : 'M'}${px(p.t).toFixed(1)} ${py(p.v).toFixed(1)}`).join(' ')} className={'trace-mini' + (failed ? ' fail' : planned > c.activeMin.value ? ' warn' : '')} />
                  </svg>
                  <span className="msgs">
                    {serious.map((x, k) => <Chip key={k} issue={x} />)}
                    {tips > 0 && <span className="chip-lv lv-tip">{tips} 待核</span>}
                    {issues.length === 0 && <span className="chip-lv lv-ok">没问题</span>}
                    {absent.length > 0 && <span className="chip-lv lv-off">{absent.join('、')}不在</span>}
                  </span>
                </span>
              </button>
              {isOpen && (
                <div className="planner">
                  <div className="row-field"><span>出发</span>
                    <Stepper label="出发时间" value={parseHM(d.startTime ?? '09:00')} step={15} min={300} max={720} format={fmtHM}
                      onChange={v => onTrip({ ...trip, days: trip.days.map((x, k) => (k === i ? { ...x, startTime: fmtHM(v) } : x)) })} />
                  </div>
                  <SwipeList
                    onOpen={openStop}
                    onLearned={learn}
                    onMove={(from, to) => move(i, from, to)}
                    items={d.stops.map(st => {
                      const sl = slotOf.get(st.id)
                      const mine = serious.filter(x => x.stopId === st.id)
                      const code = st.kind === 'drive' ? routeCode(st.name) : undefined
                      return {
                        id: st.id,
                        content: (
                          <div className={'prow k-' + st.kind + (st.status === 'skipped' ? ' skipped' : '')}>
                            <span className="t mono pin">{sl ? fmtHM(sl.start) : ''}</span>
                            <span className="n pin">
                              {st.kind === 'drive' ? <>{code && <span className="code mono">{code}</span>}{stripCode(st.name)}</> : st.name}
                              {mine.map((x, k) => <span key={k} role="button" tabIndex={0} className="chip-tap" onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setIssue(x) }} onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); setIssue(x) } }}><Chip issue={x} /></span>)}
                            </span>
                            <span className="dur mono">{st.kind === 'lodging' ? '住' : `${st.durationMin}′`}</span>
                          </div>
                        ),
                        actions: [
                          { label: st.status === 'skipped' ? '恢复' : '跳过', onAct: () => onTrip(setStop(trip, i, st.id, { status: st.status === 'skipped' ? 'planned' : 'skipped', actualStart: undefined })) },
                          { label: '删除', tone: 'danger' as const, onAct: () => delStop(i, st.id) },
                        ],
                      }
                    })} />
                  <div className="planner-acts">
                    <button type="button" className="kbtn primary" onClick={() => setAdding(true)}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>加一站</button>
                    <button type="button" className="kbtn" onClick={() => fill(i)} disabled={filling === i} aria-busy={filling === i}>{filling === i ? '正在问高德…' : '按高德补车程'}</button>
                  </div>
                  <button type="button" className="kbtn wide" onClick={() => setReplanning(true)}>
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v2M8 11.5v2M2.5 8h2M11.5 8h2M4.2 4.2l1.4 1.4M10.4 10.4l1.4 1.4M4.2 11.8l1.4-1.4M10.4 5.6l1.4-1.4" /></svg>让 AI 重排这一天
                  </button>
                  {!learned && <p className="planner-hint">左滑跳过或删除，按住把手换顺序</p>}
                  {trip.days.length > 1 && <button type="button" className="kbtn danger wide" onClick={() => removeDay(i)}>删掉这一天</button>}
                </div>
              )}
            </li>
          )
        })}
      </ol>
      <button type="button" className="kbtn wide add-day" onClick={addDay}>加一天</button>

      {open != null && stopId && <StopSheet trip={trip} dayIndex={open} id={stopId} onTrip={onTrip} onClose={() => setStopClosing(true)} open={!stopClosing} onExited={() => { setStopId(null); setStopClosing(false) }} onRemove={id => delStop(open, id)} />}
      {open != null && <AddStopSheet open={adding} trip={trip} dayIndex={open} onClose={() => setAdding(false)} onAdd={(t) => { onTrip(t); setAdding(false) }} />}
      <IssueSheet trip={trip} issue={issue} onClose={() => setIssue(null)} />
      {open != null && (
        <ReplanSheet open={replanning} trip={trip} dayIndex={open} ratings={ratings} onClose={() => setReplanning(false)}
          onApply={(t, summary) => { const before = trip; onTrip(t); setReplanning(false); toast(`已按 AI 重排：${summary}`.slice(0, 40), () => onTrip(before)) }} />
      )}
    </div>
  )
}
