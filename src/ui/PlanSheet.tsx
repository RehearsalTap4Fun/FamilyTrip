// 排程（流程一）：列出要去的点 → 排程引擎按同行人的限制排成每天 → 看结果（放不下的点、剩下的问题）→ 采用。
// 列点：搜高德一个个加，或粘贴一串地名一次加好。每个点可标必去、指定哪天、固定时刻、改成吃饭或住处。
// 排出来的只是候选，采用前不写入；采用后可撤销。地点存进 trip.plan.places，回来能改了再排。
import { useEffect, useRef, useState } from 'react'
import { planTrip, type PlanResult } from '@core/planner'
import type { Rating } from '@core/ratings'
import { fmtHM, scheduleDay } from '@core/schedule'
import type { PlanPlace, Poi, Trip } from '@core/types'
import { cityOf } from '@core/footprint'
import { AmapError, searchPlaces, type Place } from '../geo/amap'
import { namesMatch } from '../geo/groundDay'
import { makePlanTools } from '../geo/planTools'
import { uid } from '../store/state'
import { fmtShort } from './format'
import { Field, Segmented, Toggle } from './kit/controls'
import { Sheet } from './kit/Sheet'
import { Chip } from './ScopeToday'
import { GuideImport } from './GuideImport'
import { Recommend } from './Recommend'
import { useSettings } from './Settings'
import { LineIcon } from './symbols'

interface Props {
  open: boolean
  trip: Trip
  ratings: Rating[]
  onApply: (t: Trip) => void
  onClose: () => void
}

type Stage = { kind: 'list' } | { kind: 'running'; msg: string } | { kind: 'done'; r: PlanResult } | { kind: 'error'; msg: string }

const KIND_LABEL = { sight: '景点', food: '吃饭', lodging: '住处' } as const

/** 高德分类猜是景点、吃饭还是住处 */
const kindOf = (p: Place): PlanPlace['kind'] => (p.type.startsWith('餐饮') ? 'food' : p.type.startsWith('住宿') ? 'lodging' : 'sight')

/** 粘贴的一段文字拆成地名：按顿号、逗号、分号、换行、空格隔开 */
export function splitNames(text: string): string[] {
  return [...new Set(text.split(/[、，,;；\n\r\t]+|\s{2,}/).map(s => s.replace(/^[\d.)）\s-]+/, '').trim()).filter(s => s.length >= 2))]
}

export function PlanSheet({ open, trip, ratings, onApply, onClose }: Props) {
  const { amapKey } = useSettings()
  const [places, setPlaces] = useState<PlanPlace[]>(trip.plan?.places ?? [])
  const [stage, setStage] = useState<Stage>({ kind: 'list' })
  const [q, setQ] = useState('')
  const [found, setFound] = useState<{ kind: 'idle' } | { kind: 'loading' } | { kind: 'done'; list: Place[] } | { kind: 'error'; msg: string }>({ kind: 'idle' })
  const [bulk, setBulk] = useState(false)
  const [importing, setImporting] = useState(false)
  // 「只知道大概去哪」建的行程、还没有地点：打开就直接让 AI 推荐
  const regionFirst = trip.plan?.flow === 'region' && !(trip.plan?.places?.length)
  const [recommending, setRecommending] = useState(regionFirst)
  const [bulkText, setBulkText] = useState('')
  const [bulkMsg, setBulkMsg] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [days, setDays] = useState(trip.days.length)
  const run = useRef(0)

  useEffect(() => {
    if (!open) return
    setPlaces(trip.plan?.places ?? []); setStage({ kind: 'list' }); setQ(''); setFound({ kind: 'idle' })
    setBulk(false); setImporting(false); setRecommending(regionFirst); setBulkText(''); setBulkMsg(''); setEditing(null); setDays(trip.days.length)
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

  const start = async (nDays = days) => {
    const my = ++run.current
    setStage({ kind: 'running', msg: '准备' })
    try {
      // 出发地是文字：先在高德里定位
      let origin: Poi | undefined
      if (trip.plan?.origin && amapKey) origin = (await searchPlaces(trip.plan.origin, amapKey))[0]?.poi
      const base: Trip = {
        ...trip,
        days: Array.from({ length: nDays }, (_, i) => trip.days[i] ?? { startTime: '09:00', stops: [] }),
        plan: { flow: 'places', styles: [], ...trip.plan, places },
      }
      const tools = makePlanTools(amapKey, ratings, msg => { if (my === run.current) setStage({ kind: 'running', msg }) })
      const r = await planTrip(base, places, tools, { origin, newId: uid })
      if (my === run.current) setStage({ kind: 'done', r })
    } catch (e) {
      if (my === run.current) setStage({ kind: 'error', msg: e instanceof AmapError ? e.message : '排程失败：' + (e instanceof Error ? e.message : String(e)) })
    }
  }
  const close = () => { run.current++; onClose() }
  const sights = places.filter(p => p.kind === 'sight').length
  const done = stage.kind === 'done' ? stage.r : null

  return (
    <Sheet open={open} onClose={close} title={done ? '排好了，看看' : `排「${trip.title}」`}
      done={done ? '采用' : stage.kind === 'running' ? '排着呢' : `开始排${sights ? `（${places.length} 个点）` : ''}`}
      doneDisabled={stage.kind === 'running' || (!done && !sights)}
      onDone={done ? () => onApply(done.trip) : () => start()}
      footer={done ? <button type="button" className="kbtn wide" onClick={() => setStage({ kind: 'list' })}>回去改地点</button> : undefined}>

      {(stage.kind === 'list' || stage.kind === 'error') && (
        <>
          {!amapKey && <p className="sheet-note">先在「同行」页最下面填上高德 Key，才能搜地点、算真实车程。</p>}
          <p className="sheet-note">列出想去的地方，会按同行人的限制分到每天，排好开车、吃饭、午睡和住处。{trip.days.length} 天 · {fmtShort(trip.startDate, 0)} 出发{trip.plan?.origin ? ` · 从${trip.plan.origin}` : ''}</p>
          {recommending ? (
            <Recommend trip={trip} autoRun={regionFirst} onCancel={() => setRecommending(false)} onAdd={list => {
              setPlaces(ps => [...ps, ...list.filter(x => !ps.some(p => p.poi.amapId && p.poi.amapId === x.poi.amapId)).map(({ note: _n, avoid: _a, caution: _c, ...p }) => p)])
              setRecommending(false)
            }} />
          ) : importing ? (
            <GuideImport trip={trip} onCancel={() => setImporting(false)} onAdd={list => {
              // 攻略里的点并进来：同一个高德地点不重复；原文说法、顾虑只在勾选时看，不存
              setPlaces(ps => [...ps, ...list.filter(x => !ps.some(p => p.poi.amapId && p.poi.amapId === x.poi.amapId)).map(({ note: _n, avoid: _a, caution: _c, ...p }) => p)])
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

      {done && <PlanResultView r={done} days={days} onMoreDays={n => { setDays(n); start(n) }} />}
    </Sheet>
  )
}

function PlanResultView({ r, days, onMoreDays }: { r: PlanResult; days: number; onMoreDays: (n: number) => void }) {
  const t = r.trip
  const errs = r.issues.filter(i => i.level === 'error').length
  return (
    <>
      <p className="replan-summary">
        {t.days.length} 天，{t.days.flatMap(d => d.stops).filter(s => s.kind === 'sight').length} 个景点
        {r.unplaced.length ? `，${r.unplaced.length} 个放不下` : '，都排进去了'}
      </p>
      <p className="sheet-note">{r.issues.length ? `还有 ${errs ? `${errs} 处必改、` : ''}${r.issues.length - errs} 处留意` : '按同行人的限制查过，没有问题'}{r.notes.length ? ` · ${r.notes.join('；')}` : ''}</p>

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
                  <span className="dur mono">{sl.stop.kind === 'lodging' ? '住' : `${sl.stop.durationMin}′`}</span>
                </li>
              ))}
            </ol>
          </section>
        )
      })}
    </>
  )
}
