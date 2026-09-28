// 「今天」：一天一页地图。高速从上走到下，站点是地图符号，警告是引线注记，底部是图例。
import { Fragment, useMemo, useState } from 'react'
import { deriveConstraints } from '@core/constraints'
import { whoFor } from '@core/explain'
import { cityOf } from '@core/footprint'
import { partyOnDay } from '@core/party'
import { checkIn, tripProgress } from '@core/progress'
import { fmtHM, scheduleDay, type Slot } from '@core/schedule'
import type { Stop, Trip } from '@core/types'
import { checkDay, TAG_LABEL, type Issue } from '@core/validate'
import { regionName } from '../data/regions'
import { dayTitle, fmtDay, fmtShort, partyLine, routeCode, stripCode, tintOf } from './format'
import { Legend } from './Legend'
import { placeIssues } from './placeIssues'
import { StackTable } from './StackTable'
import { LevelMark, ParkMark, Shield, SightMark, StopSymbol } from './symbols'

interface Props {
  trip: Trip
  now: Date
  demo: boolean
  onTrip: (t: Trip) => void
}

const PRIORITY = { 1: '必去', 2: '', 3: '可去' } as const

function Road({ traveled, first, last, children }: { traveled: boolean; first?: boolean; last?: boolean; children?: React.ReactNode }) {
  return (
    <div className={'road' + (traveled ? ' traveled' : '') + (first ? ' first' : '') + (last ? ' last' : '')} aria-hidden="true">
      <i />
      {children && <svg className="sym" viewBox="0 0 20 20">{children}</svg>}
    </div>
  )
}

interface Placed { issue: Issue; remedy?: React.ReactNode }

function Note({ issue, remedy, callout }: Placed & { callout?: boolean }) {
  return (
    <div className={'note lv-' + issue.level + (callout ? ' callout' : '')}>
      <LevelMark level={issue.level} size={20} />
      <p>{issue.message}{remedy && <><br /><span className="remedy">{remedy}</span></>}</p>
    </div>
  )
}

export function Today({ trip, now, demo, onTrip }: Props) {
  const prog = tripProgress(trip, now)
  const liveDay = prog.dayIndex >= 0 && prog.dayIndex < trip.days.length ? prog.dayIndex : -1
  const [picked, setPicked] = useState<number | null>(null)
  const dayIndex = picked ?? (liveDay >= 0 ? liveDay : prog.dayIndex < 0 ? 0 : trip.days.length - 1)
  const day = trip.days[dayIndex]
  const live = dayIndex === liveDay
  const dp = partyOnDay(trip.party, dayIndex)
  const c = deriveConstraints(dp)
  const nowMin = now.getHours() * 60 + now.getMinutes()

  const { slots, issues } = useMemo(() => ({
    slots: day ? scheduleDay(day) : [],
    issues: day ? checkDay(trip, dayIndex) : [],
  }), [trip, day, dayIndex])

  if (!day) return <p className="empty">还没有行程。去「行程」页加一天。</p>

  const slotOf = new Map(slots.map(s => [s.stop.id, s]))
  const byStop = new Map([...placeIssues(day, issues)].map(([id, ps]) => [id, ps.map(p => ({
    issue: p.issue,
    remedy: p.restAt ? <>在 {p.restAt.name.includes('服务区') && <ParkMark />} <b>{p.restAt.name}</b> 停够 {p.restAt.durationMin} 分就行；想早点歇，前面加一站。</> : p.noRest ? '这一段路上没有能停的地方，加一个休息站。' : undefined,
  }))]))
  const tips = issues.filter(i => i.level === 'tip')
  const blockers = issues.filter(i => !i.stopId && i.rules.length === 0 && i.level === 'error')
  const dayNotes = issues.filter(i => !i.stopId && i.level !== 'tip' && !blockers.includes(i))
  const tipFor = (id: string) => tips.filter(t => t.stopId === id).map(t => TAG_LABEL[t.code.slice(5) as keyof typeof TAG_LABEL]).filter(Boolean)

  const nextId = live ? prog.next?.id : undefined
  const nextIdx = nextId ? day.stops.findIndex(s => s.id === nextId) : -1
  const nowIdx = live ? prog.nowBefore : -1
  const traveledAt = (i: number) => (live ? i < nowIdx : dayIndex < liveDay || (liveDay < 0 && prog.dayIndex >= trip.days.length))

  const played = slots.filter(s => s.stop.status === 'done' && (s.stop.kind === 'sight' || s.stop.kind === 'food')).reduce((a, s) => a + s.stop.durationMin, 0)
  const planned = slots.filter(s => s.stop.kind === 'sight' || s.stop.kind === 'food').reduce((a, s) => a + s.stop.durationMin, 0)
  const napWho = c.nap ? whoFor(c.nap.by, dp).join(' ') : ''
  const inNap = (s?: Slot) => !!(c.nap && s && s.departAt < c.nap.to && s.end > c.nap.from)
  let napLabelShown = false

  const act = (stop: Stop, status: 'done' | 'skipped') => onTrip(checkIn(trip, stop.id, fmtHM(nowMin), status))

  // 经纬度刻在图廓上：取当天有坐标的点
  const lngs = day.stops.map(s => s.poi?.lng).filter((x): x is number => x != null)
  const deg = (v: number) => `${Math.floor(v)}°${String(Math.round((v % 1) * 60)).padStart(2, '0')}′E`

  let lastCity: string | undefined
  let lastAdcode: string | undefined

  const behind = prog.behindMin
  // 今天还没走到的站，按目前的延误推算时刻
  const delay = live ? Math.max(0, behind) : 0
  const shown = (slot: Slot | undefined, stop: Stop) => !slot ? '—' : stop.status === 'done' ? (stop.actualStart ?? fmtHM(slot.start)) : fmtHM(slot.start + delay)
  const behindText = behind > 5 ? `比计划晚 ${behind} 分` : behind < -5 ? `比计划早 ${-behind} 分` : '按计划'
  const next = trip.days[dayIndex + 1]
  const nextSerious = next ? checkDay(trip, dayIndex + 1).filter(i => i.level !== 'tip') : []

  return (
    <div className="today">
      <div className="page-l">
      {lngs.length > 1 && (
        <div className="ticks" aria-hidden="true">
          <span style={{ left: '28%' }}>{deg(Math.min(...lngs))}</span>
          <span style={{ left: '70%' }}>{deg(Math.max(...lngs))}</span>
        </div>
      )}
      <header className="head">
        <div>
          <h1 className="title">{dayTitle(day)}</h1>
          <p className="sub">第 {dayIndex + 1} 天 · {fmtDay(trip.startDate, dayIndex)} · {partyLine(trip, dayIndex)}</p>
        </div>
        <nav className="index" aria-label="接图表：按天切换">
          {trip.days.map((_, i) => (
            <button key={i} type="button" onClick={() => setPicked(i)} aria-current={i === dayIndex ? 'page' : undefined}
              className={(i === dayIndex ? 'on ' : '') + (liveDay >= 0 && i < liveDay ? 'done ' : '') + (i === liveDay ? 'live' : '')}
              title={`第 ${i + 1} 天 ${fmtShort(trip.startDate, i)}`}>{i + 1}</button>
          ))}
        </nav>
      </header>

      {!live && (
        <p className="banner">
          {prog.dayIndex < 0 ? `旅程 ${fmtDay(trip.startDate, 0)}出发，这是第 ${dayIndex + 1} 天的计划。` : liveDay >= 0 ? `正在看第 ${dayIndex + 1} 天的计划，今天是第 ${liveDay + 1} 天。` : '旅程已经结束，这是当时的路线。'}
          {liveDay >= 0 && <button type="button" onClick={() => setPicked(null)}>回到今天</button>}
        </p>
      )}
      {blockers.map((b, i) => <Note key={'b' + i} issue={b} />)}

      <ol className="strip">
        {day.stops.map((stop, i) => {
          const slot = slotOf.get(stop.id)
          const traveled = traveledAt(i)
          const adcode = stop.poi?.adcode ?? lastAdcode
          lastAdcode = adcode
          const city = adcode ? cityOf(adcode) : undefined
          const cityChanged = city !== lastCity && city != null
          const border = cityChanged && lastCity != null
          lastCity = city
          const style = { backgroundColor: tintOf(trip, adcode) }
          const nap = inNap(slot)
          const napLabel = nap && !napLabelShown && c.nap ? `${fmtHM(c.nap.from)}–${fmtHM(c.nap.to)} ${napWho}午睡${stop.kind === 'drive' ? ' · 车上' : ''}` : null
          if (napLabel) napLabelShown = true
          const notes = byStop.get(stop.id) ?? []
          const showNow = live && i === nowIdx
          const cls = 'row' + (nap ? ' nap' : '') + (stop.status === 'skipped' ? ' skipped' : '') + (border ? ' border' : '')
          const regionEl = cityChanged && city ? <span className="region">{regionName(city)}</span> : null

          const nowRow = showNow && (
            <li className="row now-row" style={style}>
              <span className="t num">{fmtHM(nowMin)}</span>
              <Road traveled={false}>
                <g transform="translate(10 10)"><circle r="9.5" fill="var(--hwy)" opacity=".18" /><path d="M0 7 L5.5 -5 L0 -2.5 L-5.5 -5 Z" fill="var(--hwy)" stroke="#fff" strokeWidth="1" /></g>
              </Road>
              <div className="body">
                <div className="n now">现在 · {behindText}{demo && <small> 演示时间</small>}</div>
                {prog.suggestSkip.length > 0 && (
                  <div className="m">落后较多，可以跳过：{prog.suggestSkip.map(s => (
                    <button key={s.id} type="button" className="link" onClick={() => act(s, 'skipped')}>{s.name}</button>
                  ))}</div>
                )}
              </div>
            </li>
          )

          if (stop.kind === 'drive') {
            const code = routeCode(stop.name)
            return (
              <Fragment key={stop.id}>
                {nowRow}
                <li className={cls + ' drive-row'} style={{ ...style, minHeight: Math.max(40, Math.min(76, stop.durationMin * 0.36)) }}>
                  <span className={'t num' + (delay && stop.status !== 'done' ? ' est' : '')} title={delay ? `计划 ${slot ? fmtHM(slot.start) : ''}` : undefined}>{shown(slot, stop)}</span>
                  <Road traveled={traveled}>{null}</Road>
                  {code && <span className="shield-on-road"><Shield code={code} /></span>}
                  <div className="body">
                    {regionEl}
                    <div className="drive-label"><span>{stripCode(stop.name)} · {stop.durationMin} 分</span></div>
                    {napLabel && <div className="nap-label">{napLabel}</div>}
                    {notes.map((n, k) => <Note key={k} {...n} callout />)}
                  </div>
                </li>
              </Fragment>
            )
          }

          const tipTags = tipFor(stop.id)
          const liveHere = live && i === nextIdx
          return (
            <Fragment key={stop.id}>
              {nowRow}
              <li className={cls} style={style}>
                <span className={'t num' + (delay && stop.status !== 'done' ? ' est' : '')} title={delay ? `计划 ${slot ? fmtHM(slot.start) : ''}` : undefined}>{shown(slot, stop)}</span>
                <Road traveled={traveled} first={i === 0} last={i === day.stops.length - 1}>
                  <StopSymbol kind={stop.kind} name={stop.name} done={stop.status === 'done'} />
                </Road>
                <div className="body">
                  {regionEl}
                  <div className={'n k-' + stop.kind + (stop.priority === 1 ? ' must' : '')}>
                    {stop.kind === 'sight' && <SightMark />}{stop.name}
                    {stop.priority && PRIORITY[stop.priority] && <span className="prio">{PRIORITY[stop.priority]}</span>}
                  </div>
                  <div className="m">
                    {[
                      stop.status === 'done' && <span key="d">已打卡{stop.actualStart ? ` ${stop.actualStart}` : ''}</span>,
                      stop.status === 'skipped' && <span key="s">已跳过</span>,
                      !!stop.driveMin && <span key="dr">开车 {stop.driveMin} 分</span>,
                      stop.kind !== 'lodging' && stop.durationMin > 0 && <span key="du">停 {stop.durationMin} 分</span>,
                      !!stop.walkKm && <span key="w">步行 {stop.walkKm} km</span>,
                      stop.altitudeM != null && <span key="a">海拔 {stop.altitudeM} m</span>,
                      tipTags.length > 0 && <em key="t">{tipTags.join('、')}未确认</em>,
                    ].filter(Boolean).flatMap((el, k) => (k ? [' ', el] : [el]))}
                  </div>
                  {napLabel && <div className="nap-label">{napLabel}</div>}
                  {notes.map((n, k) => <Note key={k} {...n} callout />)}
                  {liveHere && stop.status !== 'done' && (
                    <div className="acts">
                      <button type="button" className="primary" onClick={() => act(stop, 'done')}>到了 · 打卡</button>
                      <button type="button" onClick={() => act(stop, 'skipped')}>跳过</button>
                    </div>
                  )}
                </div>
              </li>
            </Fragment>
          )
        })}
      </ol>

      </div>

      <div className="page-r">
      {dayNotes.length > 0 && <div className="day-notes">{dayNotes.map((n, i) => <Note key={i} issue={n} />)}</div>}
      {tips.length > 0 && (
        <details className="tips">
          <summary>{tips.length} 处待核实</summary>
          <ul>{tips.map((t, i) => <li key={i}>{t.message}</li>)}</ul>
        </details>
      )}

      {next && (
        <button type="button" className="jie" onClick={() => setPicked(dayIndex + 1)}>
          <span>接第 {dayIndex + 2} 图</span><b>{dayTitle(next)}</b>
          <em>{nextSerious.length ? `${nextSerious.filter(i => i.level === 'error').length ? `必改 ${nextSerious.filter(i => i.level === 'error').length} 处 · ` : ''}${nextSerious[0].message}` : '没有需要改的'}</em>
          <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true"><path d="M0 7h18M13 2l6 5-6 5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
        </button>
      )}
      </div>

      <section className="desk-only stack-page">
        <h3>逐日叠加<span>小字是收紧这一项的人</span></h3>
        <StackTable trip={trip} highlight={dayIndex} />
      </section>

      <Legend c={c} dp={dp} played={played} planned={planned} title={live ? '今日限制' : `第 ${dayIndex + 1} 天限制`} />
    </div>
  )
}
