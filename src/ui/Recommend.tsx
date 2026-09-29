// AI 推荐方案：填地区（和要求）→ 大模型按同行者的限制出 2–3 个方案 → 挑一个 → 高德核实 → 勾选加进要去的地方 → 排程。
import { useEffect, useRef, useState } from 'react'
import type { PlanDraft, Trip } from '@core/types'
import { AmapError, searchPlaces } from '../geo/amap'
import { namesMatch } from '../geo/groundDay'
import { LlmError, PROVIDER_LABEL } from '../llm/client'
import { resolveGuide, type ImportedPlace } from '../llm/importGuide'
import { proposalToGuide, recommend, type Proposal } from '../llm/recommend'
import { searchGuides, type WebRef } from '../llm/webSearch'
import { Field } from './kit/controls'
import { PickPlaces } from './PickPlaces'
import { useSettings } from './Settings'

interface Props {
  trip: Trip
  /** 新建时选了「只知道大概去哪」：打开就直接推荐 */
  autoRun?: boolean
  onAdd: (places: ImportedPlace[]) => void
  onCancel: () => void
  /** 上次推荐的结果（存在行程里），打开就接着看 */
  saved?: PlanDraft['recs']
  onSave: (r: PlanDraft['recs']) => void
}

/** 存进行程的推荐结果：方案、花了多少、参考的攻略（只留标题、链接，正文不存），选中过的方案和核实过的点 */
interface Saved { list: Proposal[]; usd: number; web: Web; pick?: { index: number; places: ImportedPlace[]; missing: string[] } }

const slim = (web: Web): Web => ({ ...web, refs: web.refs.map(r => ({ ...r, content: '' })) } as Web)

const fmtAt = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

/** 这次有没有联网：搜到的攻略、搜索花了多少钱（元），或者没搜的原因 */
type Web = { refs: WebRef[]; yuan: number } | { refs: []; why: string }

type Stage =
  | { kind: 'input' }
  | { kind: 'busy'; msg: string }
  | { kind: 'proposals'; list: Proposal[]; usd: number; web: Web }
  | { kind: 'pick'; p: Proposal; places: ImportedPlace[]; missing: string[]; list: Proposal[]; usd: number; web: Web }
  | { kind: 'error'; msg: string }

export function Recommend({ trip, autoRun, onAdd, onCancel, saved, onSave }: Props) {
  const { amapKey, llm, zhipuKey } = useSettings()
  const [region, setRegion] = useState(saved?.region ?? trip.plan?.region ?? '')
  const [wishes, setWishes] = useState(saved?.wishes ?? '')
  // 上次推荐过：直接回到上次看到的地方（选过方案就回到勾选）
  const [stage, setStage] = useState<Stage>(() => {
    const d = saved?.data as Saved | undefined
    if (!d?.list?.length) return { kind: 'input' }
    const p = d.pick && d.list[d.pick.index]
    return p ? { kind: 'pick', p, places: d.pick!.places, missing: d.pick!.missing, list: d.list, usd: d.usd, web: d.web } : { kind: 'proposals', list: d.list, usd: d.usd, web: d.web }
  })
  const ran = useRef(false)
  // 这次打开之前就有的推荐才标「上次推荐的」
  const openedAt = useRef(new Date().toISOString())
  const save = (data: Saved) => onSave({ region: region.trim(), wishes, at: new Date().toISOString(), data: { ...data, web: slim(data.web) } })

  const errMsg = (e: unknown) => (e instanceof LlmError || e instanceof AmapError ? e.message : '推荐失败：' + (e instanceof Error ? e.message : String(e)))
  const run = async () => {
    if (!region.trim()) return
    try {
      // 填了智谱 Key：先上网搜一轮攻略；搜不到或出错就照旧凭模型知识推荐，并说明
      let web: Web = { refs: [], why: '没填智谱 Key，凭 AI 自己的知识推荐' }
      if (zhipuKey) {
        setStage({ kind: 'busy', msg: '正在网上搜攻略' })
        try {
          const r = await searchGuides(trip, region.trim(), zhipuKey)
          web = r.refs.length ? { refs: r.refs, yuan: r.cost } : { refs: [], why: '网上没搜到合适的攻略，凭 AI 自己的知识推荐' }
        } catch (e) { web = { refs: [], why: `联网搜索没成功（${e instanceof Error ? e.message : String(e)}），凭 AI 自己的知识推荐` } }
      }
      setStage({ kind: 'busy', msg: `${PROVIDER_LABEL[llm.provider]} 正在按你们的情况挑${web.refs.length ? `（参考 ${web.refs.length} 篇攻略）` : ''}` })
      const { proposals, usage } = await recommend(llm, { trip, region: region.trim(), wishes, refs: web.refs })
      if (!proposals.length) { setStage({ kind: 'error', msg: '没给出方案，换个说法再试（比如写具体一点的地区）' }); return }
      setStage({ kind: 'proposals', list: proposals, usd: usage.usd, web })
      save({ list: proposals, usd: usage.usd, web })
    } catch (e) { setStage({ kind: 'error', msg: errMsg(e) }) }
  }
  const choose = async (p: Proposal, list: Proposal[], usd: number, web: Web) => {
    try {
      const { places, missing } = await resolveGuide(proposalToGuide(p, trip.days.length), trip.days.length,
        async (k, city) => (await searchPlaces(k, amapKey, { city })).map(x => ({ name: x.name, area: x.area, poi: x.poi, type: x.type })),
        namesMatch, (i, n, name) => setStage({ kind: 'busy', msg: `在高德里核实 ${i}/${n}：${name}` }))
      setStage({ kind: 'pick', p, places, missing, list, usd, web })
      save({ list, usd, web, pick: { index: list.indexOf(p), places, missing } })
    } catch (e) { setStage({ kind: 'error', msg: errMsg(e) }) }
  }
  useEffect(() => {
    if (autoRun && !saved && !ran.current && region.trim() && llm.apiKey && amapKey) { ran.current = true; run() }
  }, [autoRun]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!llm.apiKey || !amapKey) {
    return (
      <div className="gi">
        <p className="sheet-note">AI 推荐要用大模型出方案、用高德核实地点：先在「同行」页右上角的设置里填上{!llm.apiKey ? `${PROVIDER_LABEL[llm.provider]} 的 API Key` : ''}{!llm.apiKey && !amapKey ? '和' : ''}{!amapKey ? '高德 Key' : ''}。</p>
        <button type="button" className="kbtn wide" onClick={onCancel}>返回</button>
      </div>
    )
  }

  if (stage.kind === 'pick') {
    const { p, places, missing, list, usd, web } = stage
    return (
      <PickPlaces places={places} missing={missing} dayLabel="方案" backLabel="换个方案" onBack={() => { setStage({ kind: 'proposals', list, usd, web }); save({ list, usd, web }) }} onAdd={onAdd}
        head={<><b>{p.title}</b><small>AI 推荐 · 约 ${usd.toFixed(3)}{'yuan' in web ? ` + 搜索 ¥${web.yuan.toFixed(2)}` : ''}</small><p>{p.fit}</p><Sources p={p} refs={web.refs} /></>} />
    )
  }

  if (stage.kind === 'proposals') {
    return (
      <div className="gi">
        {saved && saved.at < openedAt.current && <p className="sheet-note rec-saved">上次推荐的（{fmtAt(saved.at)}{saved.region ? ` · ${saved.region}` : ''}），想要新的点下面「再推荐几个」。</p>}
        <p className="sheet-note">{'yuan' in stage.web
          ? `参考了网上 ${stage.web.refs.length} 篇攻略（智谱搜索 · 约 ¥${stage.web.yuan.toFixed(2)}），按 ${trip.days.length} 天、这群人的限制挑的；选中后会在高德里逐个核实。`
          : `${stage.web.why}，信息可能不是最新的：选中后会在高德里逐个核实。`}</p>
        {stage.list.map((p, i) => (
          <article key={i} className="rec-card">
            <h4>{p.title}</h4>
            <p className="pitch">{p.pitch}</p>
            <p className="fit">{p.fit}</p>
            <ol>
              {p.days.map(d => <li key={d.day}><b>第 {d.day} 天 · {d.city}</b>{d.places.map(x => x.name).join('、')}</li>)}
            </ol>
            {p.skipped.length > 0 && <p className="skipped">没放进来：{p.skipped.map(x => `${x.name}（${x.reason}）`).join('；')}</p>}
            <Sources p={p} refs={stage.web.refs} />
            <button type="button" className="kbtn primary wide" onClick={() => choose(p, stage.list, stage.usd, stage.web)}>用这个方案</button>
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

/** 方案参考了哪几篇网上攻略：点开是原帖 */
function Sources({ p, refs }: { p: Proposal; refs: WebRef[] }) {
  const used = [...new Set(p.sources)].map(i => refs[i - 1]).filter((r): r is WebRef => !!r).slice(0, 4)
  if (!used.length) return null
  return (
    <div className="rec-src">
      <span>参考：</span>
      {used.map(r => <a key={r.url} href={r.url} target="_blank" rel="noopener noreferrer">{r.title.slice(0, 18)}<small>{r.site}</small></a>)}
    </div>
  )
}
