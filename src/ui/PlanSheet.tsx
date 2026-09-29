// 排程（流程一）：列出要去的点 → 排程引擎按同行人的限制排成每天 → 看结果（放不下的点、剩下的问题）→ 采用。
// 列点：搜高德一个个加，或粘贴一串地名一次加好。每个点可标必去、指定哪天、固定时刻、改成吃饭或住处。
// 排出来的只是候选，采用前不写入；采用后可撤销。地点存进 trip.plan.places，回来能改了再排。
import { useEffect, useRef, useState } from 'react'
import { planTrip, type PlanResult } from '@core/planner'
import type { Rating } from '@core/ratings'
import { fmtHM, scheduleDay } from '@core/schedule'
import type { DayTweak, PlaceRef, PlanDraft, PlanPlace, Poi, Trip } from '@core/types'
import { checkDay } from '@core/validate'
import { inferBestTime } from '@core/timeOfDay'
import { cityOf } from '@core/footprint'
import { AmapError, searchPlaces, type Place } from '../geo/amap'
import { namesMatch } from '../geo/groundDay'
import { makePlanTools } from '../geo/planTools'
import { uid } from '../store/state'
import { endsLine, homeRef, TripEnds } from './Endpoints'
import { partyLine } from './TripSetup'
import { fmtShort } from './format'
import { Field, Segmented, Toggle } from './kit/controls'
import { Sheet } from './kit/Sheet'
import { Chip } from './ScopeToday'
import { GuideImport } from './GuideImport'
import { applyTweaks, readTweaks } from '../llm/tweakPlan'
import { LlmError } from '../llm/client'
import { Recommend } from './Recommend'
import { useSettings } from './Settings'
import { LineIcon } from './symbols'

interface Props {
  open: boolean
  trip: Trip
  ratings: Rating[]
  onApply: (t: Trip) => void
  onClose: () => void
  /** 进度存回行程（没点「采用」也留着）：只改给出的那几项 */
  onDraft: (patch: Partial<PlanDraft>) => void
  /** 改这趟怎么去、谁去 */
  onSetup: () => void
}

/** 存着的「排好了还没采用」还原成结果；规则层的问题现查 */
function restoreResult(trip: Trip, d?: PlanDraft): PlanResult | null {
  const r = d?.result
  if (!r?.days?.length) return null
  const t: Trip = { ...trip, days: r.days, plan: r.plan }
  return { trip: t, unplaced: r.unplaced, extraDaysNeeded: r.extraDaysNeeded, notes: r.notes, issues: t.days.flatMap((_, i) => checkDay(t, i)).filter(i => i.level !== 'tip') }
}

type Stage = { kind: 'list' } | { kind: 'running'; msg: string } | { kind: 'done'; r: PlanResult } | { kind: 'error'; msg: string }

const KIND_LABEL = { sight: '景点', food: '吃饭', lodging: '住处' } as const

/** 高德分类猜是景点、吃饭还是住处 */
const kindOf = (p: Place): PlanPlace['kind'] => (p.type.startsWith('餐饮') ? 'food' : p.type.startsWith('住宿') ? 'lodging' : 'sight')

/** 推荐理由、原文说法留作站点上的说明（「晚上灯亮了最好看」这种排程也要看） */
const withNote = (p: PlanPlace, note?: string): PlanPlace => (p.why || !note?.trim() ? p : { ...p, why: note.trim() })

/** 已经写过的亮点里说了最佳时段（「17:30 以后看日落」）：重排时照着排 */
function withHighlightTimes(trip: Trip, places: PlanPlace[]): PlanPlace[] {
  const when = new Map(trip.days.flatMap(d => d.stops).filter(s => s.highlight).map(s => [s.name, `${s.highlight!.when ?? ''} ${s.highlight!.how}`]))
  return places.map(p => {
    if (p.bestTime || p.kind !== 'sight' || !when.has(p.name)) return p
    const b = inferBestTime(when.get(p.name))
    return b ? { ...p, bestTime: b } : p
  })
}

/** 粘贴的一段文字拆成地名：按顿号、逗号、分号、换行、空格隔开 */
export function splitNames(text: string): string[] {
  return [...new Set(text.split(/[、，,;；\n\r\t]+|\s{2,}/).map(s => s.replace(/^[\d.)）\s-]+/, '').trim()).filter(s => s.length >= 2))]
}

export function PlanSheet({ open, trip, ratings, onApply, onClose, onDraft, onSetup }: Props) {
  const draft = trip.plan?.draft
  const { amapKey, llm, home } = useSettings()
  // 起点终点：行程里存了就用（null 是明确不设）；没存过（旧行程）默认现居地，旧版只存了出发地文字的先空着、排的时候再定位
  const endsOf = (t: Trip): { from?: PlaceRef; to?: PlaceRef } => ({
    from: t.plan?.from === null ? undefined : t.plan?.from ?? (t.plan?.origin ? undefined : homeRef(home)),
    to: t.plan?.to === null ? undefined : t.plan?.to ?? homeRef(home),
  })
  const [ends, setEnds] = useState(() => endsOf(trip))
  const [places, setPlaces] = useState<PlanPlace[]>(draft?.places ?? trip.plan?.places ?? [])
  const [stage, setStage] = useState<Stage>(() => { const r = restoreResult(trip, draft); return r ? { kind: 'done', r } : { kind: 'list' } })
  const [q, setQ] = useState('')
  const [found, setFound] = useState<{ kind: 'idle' } | { kind: 'loading' } | { kind: 'done'; list: Place[] } | { kind: 'error'; msg: string }>({ kind: 'idle' })
  const [bulk, setBulk] = useState(false)
  const [importing, setImporting] = useState(false)
  // 「只知道大概去哪」建的行程、还没有地点：打开就直接让 AI 推荐
  const regionFirst = trip.plan?.flow === 'region' && !(draft?.places ?? trip.plan?.places)?.length
  const [recommending, setRecommending] = useState(regionFirst)
  const [bulkText, setBulkText] = useState('')
  const [bulkMsg, setBulkMsg] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [days, setDays] = useState(draft?.days ?? trip.days.length)
  const run = useRef(0)

  useEffect(() => {
    if (!open) return
    // 上次没做完的接着来：列到一半的地点、排好还没采用的结果
    const r = restoreResult(trip, draft)
    setPlaces(draft?.places ?? trip.plan?.places ?? []); setStage(r ? { kind: 'done', r } : { kind: 'list' }); setQ(''); setFound({ kind: 'idle' })
    setBulk(false); setImporting(false); setRecommending(regionFirst); setTweaks(draft?.tweaks ?? trip.plan?.tweaks ?? []); setLastAsk(null); setBulkText(''); setBulkMsg(''); setEditing(null); setDays(draft?.days ?? trip.days.length); setEnds(endsOf(trip))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps


  // 搜索优先在已经加过的点所在城市附近
  const city = places.length ? cityOf(places[places.length - 1].poi.adcode ?? '') || undefined : undefined
  const add = (p: Place) => setPlaces(ps => (ps.some(x => x.poi.amapId && x.poi.amapId === p.poi.amapId) ? ps
    : [...ps, { id: uid('p'), name: p.name, kind: kindOf(p), poi: p.poi, area: p.area }]))
  const search = async () => {
    if (!q.trim()) return
    setFound({ kind: 'loading' })
    try { setFound({ kind: 'done', list: await searchPlaces(q.trim(), amapKey, { city }) }) } catch (e) { setFound({ kind: 'error', msg: e instanceof AmapError ? e.message : '搜索失败' }) }
  }
  const addBulk = async () => {
    const names = splitNames(bulkText)
    if (!names.length) return
    const miss: string[] = []
    let near = city
    for (const [i, n] of names.entries()) {
      setBulkMsg(`正在找 ${i + 1}/${names.length}：${n}`)
      try {
        const list = await searchPlaces(n, amapKey, { city: near })
        const hit = list.find(p => namesMatch(n, p.name))
        if (hit) { add(hit); near = cityOf(hit.poi.adcode ?? '') || near } else miss.push(n)
      } catch (e) { setBulkMsg(e instanceof AmapError ? e.message : '搜索失败'); return }
    }
    setBulkText(miss.join('、'))
    setBulkMsg(miss.length ? `找到 ${names.length - miss.length} 个；这几个没找到，改个叫法再试：${miss.join('、')}` : `都找到了，加了 ${names.length} 个`)
    if (!miss.length) setBulk(false)
  }
  const patch = (id: string, p: Partial<PlanPlace>) => setPlaces(ps => ps.map(x => (x.id === id ? { ...x, ...p } : x)))

  const start = async (nDays = days, over?: { places: PlanPlace[]; tweaks: DayTweak[] }) => {
    const my = ++run.current
    const usePlaces = withHighlightTimes(trip, over?.places ?? places)
    const useTweaks = over?.tweaks ?? tweaks
    setStage({ kind: 'running', msg: '准备' })
    try {
      // 旧版的出发地只有文字：先在高德里定位
      let origin: Poi | undefined = ends.from?.poi
      let from = ends.from
      if (!origin && trip.plan?.from === undefined && trip.plan?.origin && amapKey) {
        const hit = (await searchPlaces(trip.plan.origin, amapKey))[0]
        if (hit) { origin = hit.poi; from = { name: trip.plan.origin, poi: hit.poi } }
      }
      const base: Trip = {
        ...trip,
        days: Array.from({ length: nDays }, (_, i) => trip.days[i] ?? { startTime: '09:00', stops: [] }),
        plan: { flow: 'places', styles: [], ...trip.plan, places: usePlaces, tweaks: useTweaks.filter(t => t.day < nDays), from: from ?? null, to: ends.to ?? null, draft: undefined },
      }
      const tools = makePlanTools(amapKey, ratings, msg => { if (my === run.current) setStage({ kind: 'running', msg }) })
      const r = await planTrip(base, usePlaces, tools, { origin, end: ends.to, newId: uid })
      if (my === run.current) {
        setStage({ kind: 'done', r })
        // 排好了先存着：没点「采用」关掉，下次打开还在
        onDraft({ result: { days: r.trip.days, plan: r.trip.plan!, unplaced: r.unplaced, extraDaysNeeded: r.extraDaysNeeded, notes: r.notes, at: new Date().toISOString() } })
      }
    } catch (e) {
      if (my === run.current) setStage({ kind: 'error', msg: e instanceof AmapError ? e.message : '排程失败：' + (e instanceof Error ? e.message : String(e)) })
    }
  }
  // 写一句要求再排：大模型只把要求翻成调整，排还是交给排程引擎
  const [tweaks, setTweaks] = useState<DayTweak[]>(trip.plan?.tweaks ?? [])
  const [lastAsk, setLastAsk] = useState<{ understood: string; done: string[]; skipped: string[] } | null>(null)
  // 清单、调整、天数一改就存进行程；和存着的一样就不动（刚打开时）。改了清单，排好的结果就作废
  useEffect(() => {
    if (!open) return
    const saved = { places: draft?.places ?? trip.plan?.places ?? [], tweaks: draft?.tweaks ?? trip.plan?.tweaks ?? [], days: draft?.days ?? trip.days.length }
    if (JSON.stringify(saved) === JSON.stringify({ places, tweaks, days })) return
    onDraft({ places, tweaks, days, result: undefined })
  }, [places, tweaks, days]) // eslint-disable-line react-hooks/exhaustive-deps
  const reask = async (request: string) => {
    if (!done || !request.trim()) return
    const my = ++run.current
    try {
      setStage({ kind: 'running', msg: '正在理解你的要求' })
      const { tweaks: t } = await readTweaks(llm, done.trip, places, request)
      if (my !== run.current) return
      setStage({ kind: 'running', msg: '在高德里找地方' })
      const find = async (name: string, city?: string) => {
        const list = await searchPlaces(name, amapKey, { city })
        const hit = list.find(p => namesMatch(name, p.name)) ?? list[0]
        return hit ? { name: hit.name, poi: hit.poi, area: hit.area } : null
      }
      const a = await applyTweaks(t, places, tweaks, done.trip.days.length, find, uid, namesMatch)
      setPlaces(a.places); setTweaks(a.tweaks)
      setLastAsk({ understood: t.understood, done: a.done, skipped: a.skipped })
      if (my !== run.current) return
      await start(days, { places: a.places, tweaks: a.tweaks })
    } catch (e) {
      if (my === run.current) setStage({ kind: 'error', msg: e instanceof LlmError || e instanceof AmapError ? e.message : '按要求重排失败：' + (e instanceof Error ? e.message : String(e)) })
    }
  }
  const close = () => { run.current++; onClose() }
  const sights = places.filter(p => p.kind === 'sight').length
  const done = stage.kind === 'done' ? stage.r : null

  return (
    <Sheet open={open} onClose={close} title={done ? '排好了，看看' : `排「${trip.title}」`}
      done={done ? '采用' : stage.kind === 'running' ? '排着呢' : `开始排${sights ? `（${places.length} 个点）` : ''}`}
      doneDisabled={stage.kind === 'running' || (!done && !sights)}
      onDone={done ? () => onApply({ ...done.trip, plan: { ...done.trip.plan!, draft: draft?.recs || draft?.guide ? { recs: draft.recs, guide: draft.guide } : undefined } }) : () => start()}
      footer={done ? <button type="button" className="kbtn wide" onClick={() => setStage({ kind: 'list' })}>回去改地点</button> : undefined}>

      {(stage.kind === 'list' || stage.kind === 'error') && (
        <>
          {!amapKey && <p className="sheet-note">先在「同行」页右上角的设置里填上高德 Key，才能搜地点、算真实车程。</p>}
          <p className="sheet-note">列出想去的地方，会按同行人的限制分到每天，排好开车、吃饭、午睡和住处。{trip.days.length} 天 · {fmtShort(trip.startDate, 0)} 出发</p>
          {/* 排之前先看一眼：这趟怎么去、谁去 */}
          <button type="button" className="plan-who" onClick={onSetup}><span>{partyLine(trip.party)}</span><small>改</small></button>
          <details className="more plan-ends">
            <summary>{endsLine({ ...trip, plan: { flow: 'places', styles: [], ...trip.plan, from: ends.from ?? null, to: ends.to ?? null } }) || '起点、终点：不设'}<small>改</small></summary>
            <div><TripEnds from={ends.from} to={ends.to} onChange={(from, to) => setEnds({ from, to })} /><p className="sheet-note">第一天从起点出发、最后一天回到终点，这两段路算进当天；不自驾的长途按高铁、飞机粗估。</p></div>
          </details>
          {recommending ? (
            <Recommend trip={trip} autoRun={regionFirst} saved={draft?.recs} onSave={recs => onDraft({ recs })} onCancel={() => setRecommending(false)} onAdd={list => {
              // AI 推荐的吃饭、住处还没人确认：带上「推荐」标记
              setPlaces(ps => [...ps, ...list.filter(x => !ps.some(p => p.poi.amapId && p.poi.amapId === x.poi.amapId)).map(({ note, avoid: _a, caution: _c, parts: _p, ...p }) => withNote(p.kind === 'sight' ? p : { ...p, suggested: true }, note))])
              setRecommending(false)
            }} />
          ) : importing ? (
            <GuideImport trip={trip} saved={draft?.guide} onSave={guide => onDraft({ guide })} onCancel={() => setImporting(false)} onAdd={list => {
              // 攻略里的点并进来：同一个高德地点不重复；原文说法、顾虑只在勾选时看，不存
              setPlaces(ps => [...ps, ...list.filter(x => !ps.some(p => p.poi.amapId && p.poi.amapId === x.poi.amapId)).map(({ note, avoid: _a, caution: _c, parts: _p, ...p }) => withNote(p, note))])
              setImporting(false)
            }} />
          ) : amapKey && (bulk ? (
            <Field label="一次加好几个" hint="用顿号、逗号或换行隔开">
              <textarea className="kinput" rows={3} value={bulkText} onChange={e => setBulkText(e.target.value)} placeholder="比如：大理古城、双廊、喜洲古镇、丽江古城、束河古镇" />
              <div className="foot-row">
                <button type="button" className="kbtn" onClick={() => { setBulk(false); setBulkMsg('') }}>一个个搜</button>
                <button type="button" className="kbtn primary" onClick={addBulk}>找出来加上</button>
              </div>
              {bulkMsg && <p className="sheet-note" aria-live="polite">{bulkMsg}</p>}
            </Field>
          ) : (
            <>
              <form className="search-row" onSubmit={e => { e.preventDefault(); search() }}>
                <input className="kinput" value={q} onChange={e => setQ(e.target.value)} placeholder="景点、餐厅、酒店" enterKeyHint="search" aria-label="搜地点" />
                <button type="submit" className="kbtn primary">搜</button>
              </form>
              <div className="plan-more">
                <button type="button" className="linkish" onClick={() => setBulk(true)}>有一串地名？一次粘贴</button>
                <button type="button" className="linkish" onClick={() => setImporting(true)}>从攻略导入</button>
                <button type="button" className="linkish" onClick={() => setRecommending(true)}>AI 推荐方案</button>
              </div>
              {found.kind === 'loading' && <p className="sheet-note">正在找…</p>}
              {found.kind === 'error' && <p className="issue-msg lv-error" role="alert">{found.msg}</p>}
              {found.kind === 'done' && (found.list.length === 0 ? <p className="sheet-note">没找到，换个叫法试试</p> : (
                <div className="card-list plan-found">
                  {found.list.slice(0, 6).map(p => {
                    const has = places.some(x => x.poi.amapId && x.poi.amapId === p.poi.amapId)
                    return (
                      <button key={p.poi.amapId ?? p.name + p.poi.lng} type="button" className="card-btn place" disabled={has} onClick={() => add(p)}>
                        <span className="cbody"><span className="cname">{p.name}</span><span className="csub">{p.area} · {KIND_LABEL[kindOf(p)]}</span></span>
                        <span className="add">{has ? '已加' : '＋'}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </>
          ))}

          <div className="section-h"><h2>要去的地方</h2><small>{places.length ? `${sights} 个景点${places.length > sights ? `，${places.length - sights} 个吃饭 / 住处` : ''}` : '还没加'}</small></div>
          <ol className="plan-places">
            {places.map(p => {
              const open = editing === p.id
              return (
                <li key={p.id} className={open ? 'open' : ''}>
                  <button type="button" className="pp-row" onClick={() => setEditing(open ? null : p.id)} aria-expanded={open}>
                    <LineIcon name={p.kind} size={18} />
                    <span className="b"><b>{p.name}</b><small>{p.area}</small></span>
                    <span className="tags">
                      {p.must && <em className="must">必去</em>}
                      {p.day != null ? <em>第 {p.day + 1} {p.kind === 'lodging' ? '晚' : '天'}</em> : p.prefDay != null && <em className="soft">原文第 {p.prefDay + 1} 天</em>}
                      {p.start && <em>{p.start}</em>}
                    </span>
                  </button>
                  {open && (
                    <div className="pp-edit">
                      <Segmented label="类型" value={p.kind} onChange={kind => patch(p.id, { kind, ...(kind === 'lodging' ? { must: undefined, start: undefined } : {}) })}
                        options={(['sight', 'food', 'lodging'] as const).map(k => ({ value: k, label: KIND_LABEL[k] }))} />
                      {p.kind !== 'lodging' && <Toggle on={!!p.must} onChange={v => patch(p.id, { must: v || undefined })} label="必去" hint="排不下时最后才去掉" />}
                      <Field label={p.kind === 'lodging' ? '住哪一晚' : '哪天去'}>
                        <div className="chips" role="radiogroup" aria-label="哪天">
                          {[undefined, ...Array.from({ length: trip.days.length }, (_, i) => i)].map(d => (
                            <button key={String(d)} type="button" role="radio" aria-checked={p.day === d} className={'chipk' + (p.day === d ? ' on' : '')} onClick={() => patch(p.id, { day: d, prefDay: undefined })}>
                              {d == null ? '自动' : `${d + 1}`}
                            </button>
                          ))}
                        </div>
                      </Field>
                      {p.kind !== 'lodging' && (
                        <Field label="固定几点开始" hint="门票预约之类；不填就按顺序排">
                          <input className="kinput" type="time" value={p.start ?? ''} onChange={e => patch(p.id, { start: e.target.value || undefined })} />
                        </Field>
                      )}
                      <button type="button" className="kbtn danger wide" onClick={() => { setPlaces(ps => ps.filter(x => x.id !== p.id)); setEditing(null) }}>不去这里</button>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
          {stage.kind === 'error' && <p className="issue-msg lv-error" role="alert">{stage.msg}</p>}
        </>
      )}

      {stage.kind === 'running' && (
        <div className="replan-wait" aria-live="polite"><i className="replan-dot" aria-hidden="true" /><p>{stage.msg}…</p></div>
      )}

      {done && <PlanResultView r={done} days={days} onMoreDays={n => { setDays(n); start(n) }} canAsk={!!llm.apiKey} lastAsk={lastAsk} onAsk={reask} />}
    </Sheet>
  )
}

function PlanResultView({ r, days, onMoreDays, canAsk, lastAsk, onAsk }: {
  r: PlanResult; days: number; onMoreDays: (n: number) => void
  canAsk: boolean; lastAsk: { understood: string; done: string[]; skipped: string[] } | null; onAsk: (text: string) => void
}) {
  const t = r.trip
  const [ask, setAsk] = useState('')
  const errs = r.issues.filter(i => i.level === 'error').length
  return (
    <>
      <p className="replan-summary">
        {t.days.length} 天，{t.days.flatMap(d => d.stops).filter(s => s.kind === 'sight').length} 个景点
        {r.unplaced.length ? `，${r.unplaced.length} 个放不下` : '，都排进去了'}
      </p>
      <p className="sheet-note">{r.issues.length ? `还有 ${errs ? `${errs} 处必改、` : ''}${r.issues.length - errs} 处留意` : '按同行人的限制查过，没有问题'}{r.notes.length ? ` · ${r.notes.join('；')}` : ''}</p>

      {lastAsk && (
        <div className="ask-done">
          <b>按你的要求：{lastAsk.understood}</b>
          {lastAsk.done.length > 0 && <ul>{lastAsk.done.map(x => <li key={x}>{x}</li>)}</ul>}
          {lastAsk.skipped.length > 0 && <p>{lastAsk.skipped.join('；')}</p>}
        </div>
      )}
      <div className="ask-box">
        <Field label="不满意？写一句要求再排" hint={canAsk ? '限制照样守住' : '先填大模型 Key'}>
          <textarea className="kinput" rows={2} value={ask} onChange={e => setAsk(e.target.value)} disabled={!canAsk}
            placeholder="比如：第二天晚点出发、排松一点；想在双廊吃晚饭；喜洲挪到第三天；不去拉市海" />
        </Field>
        <button type="button" className="kbtn wide" disabled={!canAsk || !ask.trim()} onClick={() => { onAsk(ask); setAsk('') }}>按要求再排</button>
      </div>

      {(r.unplaced.length > 0 || r.extraDaysNeeded > 0) && (
        <div className="plan-unplaced">
          {r.unplaced.length > 0 && <><h4>放不下的点</h4><ul>{r.unplaced.map(u => <li key={u.candidate.id}><b>{u.candidate.name}</b>{u.reason}</li>)}</ul></>}
          {r.extraDaysNeeded > 0 && <p>只算必去的也超了，建议再加 {r.extraDaysNeeded} 天。</p>}
          <button type="button" className="kbtn wide" onClick={() => onMoreDays(days + Math.max(1, r.extraDaysNeeded))}>加 {Math.max(1, r.extraDaysNeeded)} 天再排</button>
        </div>
      )}

      {t.days.map((d, i) => {
        const issues = r.issues.filter(x => x.day === i)
        return (
          <section key={i} className="plan-day">
            <h3><span className="mono">{i + 1}</span>{fmtShort(t.startDate, i)}<small>{d.startTime} 出发</small></h3>
            {issues.length > 0 && <div className="day-chips">{issues.map((x, k) => <Chip key={k} issue={x} />)}</div>}
            <ol className="replan-list">
              {scheduleDay(d).map(sl => (
                <li key={sl.stop.id} className={sl.stop.kind === 'drive' ? 'drive' : ''}>
                  <span className="t mono">{fmtHM(sl.start)}</span>
                  <LineIcon name={sl.stop.kind} size={18} />
                  <span className="b"><b>{sl.stop.name}</b>{sl.stop.why && <small>{sl.stop.why}</small>}</span>
                  <span className="dur mono">{sl.stop.kind === 'lodging' ? (sl.stop.home ? '到家' : '住') : `${sl.stop.durationMin}′`}</span>
                </li>
              ))}
            </ol>
          </section>
        )
      })}
    </>
  )
}
