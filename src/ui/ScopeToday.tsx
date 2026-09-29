// 示波器版「今天」：一条累计游玩曲线扫过每个同行者的触发线。
// 户外手持机的反射式液晶屏：字少、数字大，「谁定的」用通道色点表示，问题只给短标签。
import { daysUntil } from '@core/trips'
import { HowLine } from './Highlights'
import { useMemo, useState } from 'react'
import { deriveConstraints, limitRules, type Limit } from '@core/constraints'
import { whoFor, whoForAll } from '@core/explain'
import { partyOnDay } from '@core/party'
import { checkInPlanned, tripProgress } from '@core/progress'
import { fmtHM, scheduleDay } from '@core/schedule'
import type { Stop, Trip } from '@core/types'
import { checkDay, type Issue } from '@core/validate'
import { dayTitle, fmtShort, routeCode, stripCode } from './format'
import { placeIssues } from './placeIssues'
import { useToast } from './kit/Toast'
import { IssueSheet, removeStop, StopSheet } from './StopSheet'
import { CheckInSheet } from './CheckIn'
import type { Rating } from '@core/ratings'
import { CHANNEL_COLORS, crossing, maxDriveRun, phaseOf, traceOf, valueAt, type Phase } from './scopeMath'

interface Props {
  trip: Trip; now: Date; demo: boolean; onTrip: (t: Trip) => void
  /** 打卡时顺手记的红黑榜；撤销时按 id 删掉 */
  onRating?: (r: Rating) => void
  onUnrate?: (id: string) => void
}

const W = 350
const H = 150
const hm = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`

export function Chip({ issue }: { issue: Issue }) {
  return <span className={'chip-lv lv-' + issue.level} title={issue.message}>{issue.short}</span>
}

export function ScopeToday({ trip, now, demo, onTrip, onRating, onUnrate }: Props) {
  const [checking, setChecking] = useState<Stop | null>(null)
  const prog = tripProgress(trip, now)
  const liveDay = prog.dayIndex >= 0 && prog.dayIndex < trip.days.length ? prog.dayIndex : -1
  const [picked, setPicked] = useState<number | null>(null)
  const [off, setOff] = useState<Set<string>>(new Set())
  const [stopId, setStopId] = useState<string | null>(null)
  const [stopClosing, setStopClosing] = useState(false)
  const openStop = (id: string) => { setStopClosing(false); setStopId(id) }
  const [issue, setIssue] = useState<Issue | null>(null)
  const toast = useToast()
  const dayIndex = picked ?? (liveDay >= 0 ? liveDay : prog.dayIndex < 0 ? 0 : trip.days.length - 1)
  const day = trip.days[dayIndex]
  const live = dayIndex === liveDay
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const delay = live ? Math.max(0, prog.behindMin) : 0

  const { slots, issues } = useMemo(() => ({ slots: day ? scheduleDay(day) : [], issues: day ? checkDay(trip, dayIndex) : [] }), [trip, day, dayIndex])
  if (!day) return <p className="empty">还没有行程。去「行程」页加一天。</p>

  const dp = partyOnDay(trip.party, dayIndex)
  const c = deriveConstraints(dp)
  const pts = traceOf(slots, delay)
  const planned = pts.length ? pts[pts.length - 1].v : 0

  // 通道：每个同行者一路，颜色跟着人走（全程名单里的顺序），触发电平是他自己的游玩上限
  const colorOf = new Map(trip.party.members.map((m, i) => [m.name, CHANNEL_COLORS[i % CHANNEL_COLORS.length]]))
  const channels = dp.members.map(m => ({ id: m.id, name: m.name, color: colorOf.get(m.name)!, level: deriveConstraints({ ...dp, members: [m], pets: [] }).activeMin.value }))
  const dots = (l: Limit) => (l.by === 'base' ? [] : whoForAll(limitRules(l), dp)).map(n => <i key={n} className="dot" style={{ background: colorOf.get(n) ?? 'var(--ink2)' }} title={n} />)
  const hard = c.activeMin.value
  // 午睡窗口是某个人的：用他的通道色（通道色只代表人）
  const napColor = c.nap ? colorOf.get(whoFor(c.nap.by, dp)[0] ?? '') ?? 'var(--seg-dim)' : 'var(--seg-dim)'

  const t0 = Math.floor((pts[0]?.t ?? 480) / 60) * 60
  const t1 = Math.max(t0 + 360, Math.ceil(Math.max(pts[pts.length - 1]?.t ?? 0, c.endBy.value, live ? nowMin : 0) / 60) * 60)
  // 顶上留一格，最高那条触发线不贴边
  const vmax = Math.ceil(Math.max(600, planned, ...channels.map(x => x.level)) / 60) * 60 + 60
  const x = (t: number) => ((t - t0) / (t1 - t0)) * W
  const y = (v: number) => H - (v / vmax) * H
  const path = (ps: { t: number; v: number }[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')

  const cut = live ? nowMin : dayIndex < liveDay || prog.dayIndex >= trip.days.length ? Infinity : -Infinity
  const past = pts.filter(p => p.t <= cut)
  const future = pts.filter(p => p.t >= cut)
  if (Number.isFinite(cut) && past.length && future.length) {
    const mid = { t: cut, v: valueAt(pts, cut), done: false }
    past.push(mid); future.unshift(mid)
  }
  const trig = crossing(pts, hard)
  const played = live ? valueAt(pts, nowMin) : cut === Infinity ? planned : 0
  const drive = maxDriveRun(slots)
  const walk = slots.reduce((a, s) => a + (s.stop.walkKm ?? 0), 0)
  const byStop = placeIssues(day, issues)
  const dayNotes = issues.filter(i => !i.stopId && i.level !== 'tip')
  const tips = issues.filter(i => i.level === 'tip')
  const next = live ? prog.next : undefined
  const nextSlot = next ? slots.find(s => s.stop.id === next.id) : undefined
  // 「到了」打开打卡面板：到达时间默认按计划（往往是事后补点的），能改；可以顺手记红黑榜。跳过直接跳
  const act = (stop: Stop, status: 'done' | 'skipped') => {
    if (status === 'done') { setChecking(stop); return }
    const before = trip
    onTrip(checkInPlanned(trip, dayIndex, stop.id, status))
    toast(`已跳过 ${stripCode(stop.name)}`, () => onTrip(before))
  }
  const checked = (t: Trip, r?: Rating) => {
    const before = trip, stop = checking!
    onTrip(t)
    if (r) onRating?.(r)
    setChecking(null)
    const at = t.days[dayIndex].stops.find(s => s.id === stop.id)?.actualStart
    toast(`已到 ${stripCode(stop.name)} · ${at}${r ? ` · 记进${r.verdict === 'red' ? '红' : '黑'}榜` : ''}`, () => { onTrip(before); if (r) onUnrate?.(r.id) })
  }
  const toggle = (id: string) => setOff(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const shown = (s: typeof slots[number]) => s.stop.status === 'done' && s.stop.actualStart ? s.stop.actualStart : fmtHM(s.start + delay)
  const nextDay = trip.days[dayIndex + 1]
  const nextIssues = nextDay ? checkDay(trip, dayIndex + 1).filter(i => i.level !== 'tip') : []
  const nextFail = nextIssues.filter(i => i.level === 'error').length

  const levels = new Map<number, typeof channels>()
  for (const ch of channels) if (!off.has(ch.id)) levels.set(ch.level, [...(levels.get(ch.level) ?? []), ch])
  const breakOn = Number.isFinite(c.driveBreakMin.value)

  // 海报风格的一句话：此刻最该做的事
  const nextFix = next ? (byStop.get(next.id) ?? [])[0] : undefined
  const firstFail = issues.find(i => i.level === 'error')
  // 没选日子时：出发前说还有几天，走完了就说走完了；选了某一天就讲那一天
  const until = daysUntil(trip.startDate, now)
  const imperative = picked == null && prog.dayIndex < 0 ? (until === 1 ? '明天出发' : `还有 ${until} 天出发`)
    : picked == null && prog.dayIndex >= trip.days.length ? '这趟已经走完了'
    : nextFix?.restAt ? `在${stripCode(nextFix.restAt.name)}歇${nextFix.restAt.durationMin}分`
    : firstFail ? `${firstFail.short}，要改`
    : next && nextSlot ? `${fmtHM(nextSlot.start + delay)} 到${stripCode(next.name)}`
    : live ? '今天走完了' : `第${dayIndex + 1}天 · ${dayTitle(day)}`
  const sunX = live ? Math.min(1, Math.max(0, (nowMin - 360) / (1200 - 360))) : 0.3
  // 只有「今天」跟着真实时段换色；看别的日子一律按白天画
  const phase: Phase = live ? phaseOf(nowMin) : 'day'

  return (
    <div className="scope-today" data-phase={phase}>
      <div className="poster-scene" aria-hidden="true">
        <svg viewBox="0 0 350 110" preserveAspectRatio="xMidYMid slice">
          <rect width="350" height="110" className="pl-sky" />
          {phase === 'night' ? (
            <g>
              {[[40, 16], [92, 29], [150, 13], [205, 25], [262, 12], [318, 32], [120, 42]].map(([sx, sy]) => <circle key={sx} cx={sx} cy={sy} r="1.4" className="pl-star" />)}
              <circle cx="282" cy="30" r="12" className="pl-moon" />
              <circle cx="288" cy="26" r="10.5" className="pl-sky" />
            </g>
          ) : (
            <circle cx={30 + sunX * 290} cy={48 - Math.sin(sunX * Math.PI) * 26} r="13" className="pl-sun" />
          )}
          {/* 山：纵向压扁一点，矮窗口里也放得下完整的太阳 */}
          <g transform="translate(0 -0.5) scale(1 0.737)">
            <path d="M0 96 L46 70 L82 84 L130 48 L176 80 L214 62 L262 88 L300 58 L350 78 L350 150 L0 150 Z" className="pl-far" />
            <path d="M0 112 L60 92 L118 106 L170 86 L236 108 L292 90 L350 104 L350 150 L0 150 Z" className="pl-mid" />
            <path d="M0 132 C60 118 120 138 180 124 S300 116 350 128 L350 150 L0 150 Z" className="pl-near" />
            <path d="M150 150 C164 136 176 130 196 124" className="pl-road" />
          </g>
        </svg>
      </div>
      <p className="poster-caption"><b>{imperative}</b><span>{dayTitle(day)}<br />第 {dayIndex + 1} 天{live ? ` · ${fmtHM(nowMin)}` : ''}{live && demo ? ' 演示' : ''}</span></p>
      <header className="bez-top">
        <h1>{dayTitle(day)}</h1>
        <span className={'run' + (live ? '' : ' hold')}>{live ? fmtHM(nowMin) : `D${dayIndex + 1} 计划`}{live && demo && <small>演示</small>}</span>
      </header>

      <nav className="timebase" aria-label="按天切换">
        {trip.days.map((_, i) => (
          <button key={i} type="button" onClick={() => setPicked(i)} className={(i === dayIndex ? 'on' : '') + (i === liveDay ? ' live' : '')} aria-current={i === dayIndex ? 'page' : undefined} aria-label={`第 ${i + 1} 天 ${fmtShort(trip.startDate, i)}`}>
            {i + 1}<small>{fmtShort(trip.startDate, i)}</small>
          </button>
        ))}
      </nav>

      <div className="chs" role="group" aria-label="同行者：点一下开关他的触发线">
        {channels.map(ch => (
          <button key={ch.id} type="button" className={'ch' + (off.has(ch.id) ? ' off' : '')} style={{ ['--c' as string]: ch.color }} onClick={() => toggle(ch.id)} aria-pressed={!off.has(ch.id)}>
            {ch.name}<b className="mono">{ch.level / 60}h</b>
          </button>
        ))}
      </div>

      <div className="screen">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`累计游玩 ${(planned / 60).toFixed(1)} 小时，最严上限 ${hard / 60} 小时${trig ? `，预计 ${fmtHM(trig)} 碰线` : ''}`}>
          <defs>
            <pattern id="nap" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke={napColor} strokeWidth=".9" opacity=".45" /></pattern>
          </defs>
          <g className="grat">
            {Array.from({ length: (t1 - t0) / 60 - 1 }, (_, i) => <line key={'v' + i} x1={x(t0 + (i + 1) * 60)} x2={x(t0 + (i + 1) * 60)} y1="0" y2={H} />)}
            {Array.from({ length: vmax / 60 - 1 }, (_, i) => <line key={'h' + i} y1={y((i + 1) * 60)} y2={y((i + 1) * 60)} x1="0" x2={W} />)}
          </g>
          <rect x=".5" y=".5" width={W - 1} height={H - 1} className="grat-frame" />
          {c.nap && (<><rect x={x(c.nap.from)} y="0" width={x(c.nap.to) - x(c.nap.from)} height={H} fill="url(#nap)" /><text x={(x(c.nap.from) + x(c.nap.to)) / 2} y={H - 6} textAnchor="middle" className="lbl" fill={napColor}>{whoFor(c.nap.by, dp).join('')}午睡</text></>)}
          {c.endBy.value < t1 && <line x1={x(c.endBy.value)} x2={x(c.endBy.value)} y1="0" y2={H} className="endby" />}
          {[...levels.entries()].map(([lv, chs]) => (
            <g key={lv}>
              {chs.map((ch, k) => <line key={ch.id} x1="0" x2={W} y1={y(lv) + k * 2.4} y2={y(lv) + k * 2.4} stroke={ch.color} className="trig" />)}
              <text x={W - 4} y={y(lv) - 5} textAnchor="end" className="lbl mono strong">{lv / 60}h</text>
            </g>
          ))}
          {future.length > 1 && <path d={`${path(future)} L${x(future[future.length - 1].t).toFixed(1)} ${H} L${x(future[0].t).toFixed(1)} ${H} Z`} className="trace-fill future" />}
          {past.length > 1 && <path d={`${path(past)} L${x(past[past.length - 1].t).toFixed(1)} ${H} L${x(past[0].t).toFixed(1)} ${H} Z`} className="trace-fill" />}
          {future.length > 1 && <path d={path(future)} className="trace-future" />}
          {past.length > 1 && <path d={path(past)} className="trace" pathLength={1} />}
          {trig != null && (<><circle cx={x(trig)} cy={y(hard)} r="5" className="trig-dot" /><text x={x(trig) - 6} y={y(hard) + 16} textAnchor="end" className="lbl mono strong warn-t">{fmtHM(trig)} 碰线</text></>)}
          {live && nowMin >= t0 && nowMin <= t1 && <line x1={x(nowMin)} x2={x(nowMin)} y1="0" y2={H} className="now" />}
        </svg>
        <div className="axis mono"><span>{fmtHM(t0)}</span><span>{fmtHM(t0 + (t1 - t0) / 2)}</span><span>{fmtHM(t1)}</span></div>
      </div>

      <div className="read">
        <div className={'rd' + (planned > hard ? ' warn' : '')}><span className="k">游玩</span><span className="v mono">{hm(played)}<small>/{hm(hard)}</small></span><span className="dots">{dots(c.activeMin)}</span></div>
        <div className={'rd' + (breakOn && drive > c.driveBreakMin.value ? ' warn' : '')}><span className="k">连开</span><span className="v mono">{breakOn ? <>{drive}<small>/{c.driveBreakMin.value}分</small></> : '—'}</span><span className="dots">{dots(c.driveBreakMin)}</span></div>
        <div className={'rd' + (walk > c.walkKm.value ? ' warn' : '')}><span className="k">步行</span><span className="v mono">{walk.toFixed(1)}<small>/{c.walkKm.value}km</small></span><span className="dots">{dots(c.walkKm)}</span></div>
        <div className={'rd' + (live && prog.behindMin > 5 ? ' late' : '')}><span className="k">{live && prog.behindMin < -5 ? '早' : '晚'}</span><span className="v mono">{live ? Math.abs(prog.behindMin) : '—'}<small>分</small></span></div>
      </div>

      {next && nextSlot ? (
        <section className="stop-card">
          <div className="n">{next.name}<span className="t mono">{fmtHM(nextSlot.start + delay)}</span></div>
          <HowLine s={next} />
          {(byStop.get(next.id) ?? []).map((p, k) => <p key={k} className={'fix lv-' + p.issue.level}>{p.restAt ? `停够 ${p.restAt.durationMin} 分，解决「${p.issue.short}」` : p.issue.short}</p>)}
          {prog.suggestSkip.length > 0 && <p className="fix lv-warn">可跳过：{prog.suggestSkip.map(s => s.name).join('、')}</p>}
          <div className="acts">
            <button type="button" className="key primary" onClick={() => act(next, 'done')}>到了</button>
            <button type="button" className="key" onClick={() => act(next, 'skipped')}>跳过</button>
          </div>
        </section>
      ) : !live && liveDay >= 0 ? (
        <button type="button" className="stop-card back" onClick={() => setPicked(null)}>回到今天（第 {liveDay + 1} 天）</button>
      ) : null}

      {dayNotes.length > 0 && <div className="day-chips">{dayNotes.map((n, i) => <button key={i} type="button" className="chip-tap" onClick={() => setIssue(n)}><Chip issue={n} /></button>)}</div>}

      <ol className="log" aria-label="当天站点">
        {slots.map(s => {
          const st = s.stop
          const notes = (byStop.get(st.id) ?? []).map(p => p.issue)
          const tipN = tips.filter(t => t.stopId === st.id).length
          const code = st.kind === 'drive' ? routeCode(st.name) : undefined
          return (
            <li key={st.id} className={'ev k-' + st.kind + (st.status ? ' st-' + st.status : '') + (next?.id === st.id ? ' next' : '')}>
              <button type="button" className="ev-btn" onClick={() => openStop(st.id)} aria-label={`${st.name}，${shown(s)}`}>
                <span className="t mono">{shown(s)}</span>
                <i className="led" aria-hidden="true" />
                <span className="n">{st.kind === 'drive' ? <>{code && <span className="code mono">{code}</span>}<span className="mono dim">{st.durationMin}分</span></> : stripCode(st.name)}</span>
              </button>
              {(notes.length > 0 || tipN > 0) && (
                <span className="ev-chips">
                  {notes.map((n, k) => <button key={k} type="button" className="chip-tap" onClick={() => setIssue(n)}><Chip issue={n} /></button>)}
                  {tipN > 0 && <button type="button" className="chip-tap" onClick={() => setIssue({ ...tips.filter(t => t.stopId === st.id)[0], short: `${tipN} 处待核实`, message: tips.filter(t => t.stopId === st.id).map(t => t.message).join('\n') })}><span className="chip-lv lv-tip">{tipN} 待核</span></button>}
                </span>
              )}
            </li>
          )
        })}
      </ol>

      {nextDay && (
        <button type="button" className="next-sweep" onClick={() => setPicked(dayIndex + 1)}>
          <span className="mono">{dayIndex + 2}</span>{dayTitle(nextDay)}
          <em className={nextFail ? 'fail' : nextIssues.length ? '' : 'ok'}>{nextIssues.length ? `${nextFail ? `${nextFail} 必改 ` : ''}${nextIssues.length - nextFail ? `${nextIssues.length - nextFail} 留意` : ''}` : '没问题'}</em>
        </button>
      )}

      <CheckInSheet open={!!checking} trip={trip} dayIndex={dayIndex} stop={checking ?? undefined} onClose={() => setChecking(null)} onDone={checked} />
      {stopId && <StopSheet trip={trip} dayIndex={dayIndex} id={stopId} onTrip={onTrip} onClose={() => setStopClosing(true)} open={!stopClosing} onExited={() => { setStopId(null); setStopClosing(false) }}
        onRemove={id => { const before = trip; const name = day.stops.find(x => x.id === id)?.name; setStopId(null); onTrip(removeStop(trip, dayIndex, id)); toast(`已删除 ${name}`, () => onTrip(before)) }} />}
      <IssueSheet trip={trip} issue={issue} onClose={() => setIssue(null)} />
    </div>
  )
}
