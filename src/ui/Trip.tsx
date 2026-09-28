// 「行程」：整趟旅程的总图。每天一格，列出检查出来的问题和当天同行的人；点开一天就地编辑。
import { useState } from 'react'
import { inRange } from '@core/party'
import { fmtHM, scheduleDay } from '@core/schedule'
import type { Stop, StopKind, StopStatus, Tag, Trip } from '@core/types'
import { checkDay, checkTrip, TAG_LABEL } from '@core/validate'
import { uid } from '../store/state'
import { dayTitle, driveHours, fmtShort, MODE_LABEL, tintOf } from './format'
import { StackTable } from './StackTable'
import { IconDown, IconUp, IconX, LevelMark, PetGlyph, StopSymbol } from './symbols'

const KIND_LABEL: Record<StopKind, string> = { sight: '景点', food: '吃饭', lodging: '住宿', drive: '开车', transit: '换乘', rest: '休息' }
const TAGS = Object.keys(TAG_LABEL) as Tag[]

interface Props { trip: Trip; onTrip: (t: Trip) => void }

export function TripPage({ trip, onTrip }: Props) {
  const [open, setOpen] = useState<number | null>(null)
  const all = checkTrip(trip)
  const errs = all.filter(i => i.level === 'error').length
  const warns = all.filter(i => i.level === 'warn').length
  const last = trip.days.length - 1

  const addDay = () => {
    onTrip({ ...trip, days: [...trip.days, { startTime: '09:00', stops: [{ id: uid('s'), kind: 'lodging', name: '住处', durationMin: 0, status: 'planned' }] }] })
    setOpen(trip.days.length)
  }

  return (
    <div className="trip">
      <header className="head">
        <div>
          <h1 className="title">{trip.title}</h1>
          <p className="sub">{fmtShort(trip.startDate, 0)}–{fmtShort(trip.startDate, Math.max(0, last))} · {trip.days.length} 天 · {MODE_LABEL[trip.party.mode]} · {errs || warns ? `检查 ${errs} 处必改、${warns} 处留意` : '检查没有问题'}</p>
        </div>
      </header>

      <div className="spread">
      <div className="page-l">
      <ol className="days">
        {trip.days.map((d, i) => {
          const issues = checkDay(trip, i)
          const serious = issues.filter(x => x.level !== 'tip')
          const tips = issues.length - serious.length
          const firstPoi = d.stops.find(s => s.poi?.adcode)?.poi?.adcode
          const dh = driveHours(d)
          return (
            <li key={i} className={'day' + (open === i ? ' open' : '')}>
              <button type="button" className="day-hd" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                <span className="no num">{i + 1}<small>{fmtShort(trip.startDate, i)}</small></span>
                <span className="c" style={{ background: tintOf(trip, firstPoi) }}>
                  <span className="rt">{dayTitle(d)}<span>{dh > 0 ? `驾车 ${dh.toFixed(1)} h` : `${d.stops.length} 站`}</span></span>
                  <ul>
                    {serious.map((x, k) => <li key={k} className={'lv-' + x.level}><LevelMark level={x.level} size={13} /><b>{x.level === 'error' ? '必改' : '留意'}</b>{x.message}</li>)}
                    {tips > 0 && <li className="lv-tip"><LevelMark level="tip" size={13} /><b>核</b>{tips} 处待核实</li>}
                    {issues.length === 0 && <li className="ok">这一天没有问题</li>}
                  </ul>
                  <span className="who">
                    {trip.party.members.map(m => <em key={m.id} className={inRange(i, m.days) ? '' : 'off'}>{m.name}</em>)}
                    {trip.party.pets.map(p => <em key={p.id} className={inRange(i, p.days) ? 'pet' : 'pet off'}><PetGlyph size={10} />{p.name}</em>)}
                  </span>
                </span>
              </button>
              {open === i && <div className="mob-only"><DayEditor trip={trip} dayIndex={i} onTrip={onTrip} onRemoved={() => setOpen(null)} /></div>}
            </li>
          )
        })}
      </ol>
      <button type="button" className="add-day" onClick={addDay}>加一天</button>
      </div>
      <div className="page-r desk-only">
        {open != null && trip.days[open] ? (
          <section className="block">
            <h2>第 {open + 1} 天 · {dayTitle(trip.days[open])}<span>{fmtShort(trip.startDate, open)}</span></h2>
            <DayEditor trip={trip} dayIndex={open} onTrip={onTrip} onRemoved={() => setOpen(null)} />
          </section>
        ) : (
          <p className="empty">点左边任意一天，在这一页编辑它的站点。</p>
        )}
        <section className="block">
          <h2>逐日叠加<span>小字是收紧这一项的人</span></h2>
          <StackTable trip={trip} highlight={open ?? undefined} />
        </section>
      </div>
      </div>
    </div>
  )
}

function num(v: string): number | undefined {
  if (v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function DayEditor({ trip, dayIndex, onTrip, onRemoved }: Props & { dayIndex: number; onRemoved: () => void }) {
  const day = trip.days[dayIndex]
  const [edit, setEdit] = useState<string | null>(null)
  const [newKind, setNewKind] = useState<StopKind>('sight')
  const slots = new Map(scheduleDay(day, { includeSkipped: true }).map(s => [s.stop.id, s]))

  const setDay = (patch: Partial<typeof day>) => onTrip({ ...trip, days: trip.days.map((d, i) => (i === dayIndex ? { ...d, ...patch } : d)) })
  const setStops = (stops: Stop[]) => setDay({ stops })
  const patch = (id: string, p: Partial<Stop>) => setStops(day.stops.map(s => (s.id === id ? { ...s, ...p } : s)))
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir
    if (j < 0 || j >= day.stops.length) return
    const st = [...day.stops]
    ;[st[idx], st[j]] = [st[j], st[idx]]
    setStops(st)
  }
  const remove = (id: string) => setStops(day.stops.filter(s => s.id !== id))
  const add = () => {
    const s: Stop = { id: uid('s'), kind: newKind, name: KIND_LABEL[newKind], durationMin: newKind === 'drive' ? 60 : newKind === 'lodging' ? 0 : 60, status: 'planned' }
    // 新站插在最后一个住宿之前
    const li = day.stops.map(x => x.kind).lastIndexOf('lodging')
    const st = [...day.stops]
    st.splice(li >= 0 ? li : st.length, 0, s)
    setStops(st)
    setEdit(s.id)
  }
  const removeDay = () => {
    if (trip.days.length <= 1) return
    onTrip({ ...trip, days: trip.days.filter((_, i) => i !== dayIndex) })
    onRemoved()
  }

  return (
    <div className="editor">
      <label className="field inline">出发时间<input type="time" value={day.startTime ?? '09:00'} onChange={e => setDay({ startTime: e.target.value })} /></label>
      <ol className="stops">
        {day.stops.map((s, idx) => {
          const slot = slots.get(s.id)
          const open = edit === s.id
          return (
            <li key={s.id} className={'stop' + (open ? ' open' : '') + (s.status === 'skipped' ? ' skipped' : '')}>
              <div className="stop-hd">
                <svg className="sym" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><StopSymbol kind={s.kind} name={s.name} done={s.status === 'done'} /></svg>
                <span className="num t">{slot ? fmtHM(slot.start) : ''}</span>
                <button type="button" className="nm" onClick={() => setEdit(open ? null : s.id)} aria-expanded={open}>{s.name}<small>{KIND_LABEL[s.kind]} · {s.durationMin} 分</small></button>
                <span className="ops">
                  <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0} aria-label="上移"><IconUp /></button>
                  <button type="button" onClick={() => move(idx, 1)} disabled={idx === day.stops.length - 1} aria-label="下移"><IconDown /></button>
                  <button type="button" onClick={() => remove(s.id)} aria-label="删除"><IconX /></button>
                </span>
              </div>
              {open && (
                <div className="stop-form">
                  <label className="field">名称<input value={s.name} onChange={e => patch(s.id, { name: e.target.value })} /></label>
                  <label className="field">类型<select value={s.kind} onChange={e => patch(s.id, { kind: e.target.value as StopKind })}>{(Object.keys(KIND_LABEL) as StopKind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
                  <label className="field">{s.kind === 'drive' ? '开车（分）' : '停留（分）'}<input inputMode="numeric" value={s.durationMin} onChange={e => patch(s.id, { durationMin: num(e.target.value) ?? 0 })} /></label>
                  {s.kind !== 'drive' && <label className="field">开过来（分）<input inputMode="numeric" value={s.driveMin ?? ''} onChange={e => patch(s.id, { driveMin: num(e.target.value) })} /></label>}
                  <label className="field">定时开始<input type="time" value={s.start ?? ''} onChange={e => patch(s.id, { start: e.target.value || undefined })} /></label>
                  <label className="field">步行（km）<input inputMode="decimal" value={s.walkKm ?? ''} onChange={e => patch(s.id, { walkKm: num(e.target.value) })} /></label>
                  <label className="field">海拔（m）<input inputMode="numeric" value={s.altitudeM ?? ''} onChange={e => patch(s.id, { altitudeM: num(e.target.value) })} /></label>
                  <label className="field">优先级<select value={s.priority ?? 2} onChange={e => patch(s.id, { priority: Number(e.target.value) as 1 | 2 | 3 })}><option value={1}>必去</option><option value={2}>想去</option><option value={3}>可去</option></select></label>
                  <label className="field">状态<select value={s.status ?? 'planned'} onChange={e => patch(s.id, { status: e.target.value as StopStatus })}><option value="planned">计划</option><option value="done">已打卡</option><option value="skipped">跳过</option></select></label>
                  <fieldset className="tags">
                    <legend>这里具备</legend>
                    {TAGS.map(t => {
                      const on = (s.tags ?? []).includes(t)
                      return (
                        <label key={t} className={'chip' + (on ? ' on' : '')}>
                          <input type="checkbox" checked={on} onChange={() => patch(s.id, { tags: on ? (s.tags ?? []).filter(x => x !== t) : [...(s.tags ?? []), t] })} />{TAG_LABEL[t]}
                        </label>
                      )
                    })}
                  </fieldset>
                </div>
              )}
            </li>
          )
        })}
      </ol>
      <div className="add-stop">
        <select value={newKind} onChange={e => setNewKind(e.target.value as StopKind)} aria-label="新站点类型">{(Object.keys(KIND_LABEL) as StopKind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
        <button type="button" onClick={add}>加一站</button>
        <button type="button" className="danger" onClick={removeDay} disabled={trip.days.length <= 1}>删掉这一天</button>
      </div>
    </div>
  )
}
