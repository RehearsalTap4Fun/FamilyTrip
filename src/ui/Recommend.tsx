// AI 推荐方案：填地区（和要求）→ 大模型按同行者的限制出 2–3 个方案 → 挑一个 → 高德核实 → 勾选加进要去的地方 → 排程。
import { useEffect, useRef, useState } from 'react'
import type { Trip } from '@core/types'
import { AmapError, searchPlaces } from '../geo/amap'
import { namesMatch } from '../geo/groundDay'
import { LlmError, PROVIDER_LABEL } from '../llm/client'
import { resolveGuide, type ImportedPlace } from '../llm/importGuide'
import { proposalToGuide, recommend, type Proposal } from '../llm/recommend'
import { Field } from './kit/controls'
import { PickPlaces } from './PickPlaces'
import { useSettings } from './Settings'

interface Props {
  trip: Trip
  /** 新建时选了「只知道大概去哪」：打开就直接推荐 */
  autoRun?: boolean
  onAdd: (places: ImportedPlace[]) => void
  onCancel: () => void
}

type Stage =
  | { kind: 'input' }
  | { kind: 'busy'; msg: string }
  | { kind: 'proposals'; list: Proposal[]; usd: number }
  | { kind: 'pick'; p: Proposal; places: ImportedPlace[]; missing: string[]; list: Proposal[]; usd: number }
  | { kind: 'error'; msg: string }

export function Recommend({ trip, autoRun, onAdd, onCancel }: Props) {
  const { amapKey, llm } = useSettings()
  const [region, setRegion] = useState(trip.plan?.region ?? '')
  const [wishes, setWishes] = useState('')
  const [stage, setStage] = useState<Stage>({ kind: 'input' })
  const ran = useRef(false)

  const errMsg = (e: unknown) => (e instanceof LlmError || e instanceof AmapError ? e.message : '推荐失败：' + (e instanceof Error ? e.message : String(e)))
  const run = async () => {
    if (!region.trim()) return
    setStage({ kind: 'busy', msg: `${PROVIDER_LABEL[llm.provider]} 正在按你们的情况挑` })
    try {
      const { proposals, usage } = await recommend(llm, { trip, region: region.trim(), wishes })
      if (!proposals.length) { setStage({ kind: 'error', msg: '没给出方案，换个说法再试（比如写具体一点的地区）' }); return }
      setStage({ kind: 'proposals', list: proposals, usd: usage.usd })
    } catch (e) { setStage({ kind: 'error', msg: errMsg(e) }) }
  }
  const choose = async (p: Proposal, list: Proposal[], usd: number) => {
    try {
      const { places, missing } = await resolveGuide(proposalToGuide(p, trip.days.length), trip.days.length,
        async (k, city) => (await searchPlaces(k, amapKey, { city })).map(x => ({ name: x.name, area: x.area, poi: x.poi, type: x.type })),
        namesMatch, (i, n, name) => setStage({ kind: 'busy', msg: `在高德里核实 ${i}/${n}：${name}` }))
      setStage({ kind: 'pick', p, places, missing, list, usd })
    } catch (e) { setStage({ kind: 'error', msg: errMsg(e) }) }
  }
  useEffect(() => {
    if (autoRun && !ran.current && region.trim() && llm.apiKey && amapKey) { ran.current = true; run() }
  }, [autoRun]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!llm.apiKey || !amapKey) {
    return (
      <div className="gi">
        <p className="sheet-note">AI 推荐要用大模型出方案、用高德核实地点：先在「同行」页最下面填上{!llm.apiKey ? `${PROVIDER_LABEL[llm.provider]} 的 API Key` : ''}{!llm.apiKey && !amapKey ? '和' : ''}{!amapKey ? '高德 Key' : ''}。</p>
        <button type="button" className="kbtn wide" onClick={onCancel}>返回</button>
      </div>
    )
  }

  if (stage.kind === 'pick') {
    const { p, places, missing, list, usd } = stage
    return (
      <PickPlaces places={places} missing={missing} dayLabel="方案" backLabel="换个方案" onBack={() => setStage({ kind: 'proposals', list, usd })} onAdd={onAdd}
        head={<><b>{p.title}</b><small>AI 推荐 · 约 ${usd.toFixed(3)}</small><p>{p.fit}</p></>} />
    )
  }

  if (stage.kind === 'proposals') {
    return (
      <div className="gi">
        <p className="sheet-note">按 {trip.days.length} 天、这群人的限制挑的，信息可能不是最新的：选中后会在高德里逐个核实。</p>
        {stage.list.map((p, i) => (
          <article key={i} className="rec-card">
            <h4>{p.title}</h4>
            <p className="pitch">{p.pitch}</p>
            <p className="fit">{p.fit}</p>
            <ol>
              {p.days.map(d => <li key={d.day}><b>第 {d.day} 天 · {d.city}</b>{d.places.map(x => x.name).join('、')}</li>)}
            </ol>
            {p.skipped.length > 0 && <p className="skipped">没放进来：{p.skipped.map(x => `${x.name}（${x.reason}）`).join('；')}</p>}
            <button type="button" className="kbtn primary wide" onClick={() => choose(p, stage.list, stage.usd)}>用这个方案</button>
          </article>
        ))}
        <div className="foot-row">
          <button type="button" className="kbtn" onClick={() => setStage({ kind: 'input' })}>改要求</button>
          <button type="button" className="kbtn" onClick={run}>再推荐几个</button>
        </div>
      </div>
    )
  }

  return (
    <div className="gi">
      <Field label="大概去哪">
        <input className="kinput" value={region} onChange={e => setRegion(e.target.value)} disabled={stage.kind === 'busy'} placeholder="比如：滇西北、川西、杭州周边" />
      </Field>
      <Field label="另外的要求" hint="可以不写">
        <input className="kinput" value={wishes} onChange={e => setWishes(e.target.value)} disabled={stage.kind === 'busy'} placeholder="比如：想看雪山、少走路、有一天完全放空" />
      </Field>
      {stage.kind === 'busy' && <div className="replan-wait" aria-live="polite"><i className="replan-dot" aria-hidden="true" /><p>{stage.msg}…</p></div>}
      {stage.kind === 'error' && <p className="issue-msg lv-error" role="alert">{stage.msg}</p>}
      <p className="sheet-note">会按这趟所有同行人的限制挑（海拔、步行、午睡、带宠物……），给 2–3 个不同的方案，也会说明哪些热门的地方故意没放。</p>
      <div className="foot-row">
        <button type="button" className="kbtn" onClick={onCancel}>返回</button>
        <button type="button" className="kbtn primary" disabled={!region.trim() || stage.kind === 'busy'} onClick={run}>推荐方案</button>
      </div>
    </div>
  )
}
