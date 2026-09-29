// 「这趟的亮点」卡片（行程页顶部）与站点的「怎么玩」。亮点由 AI 写（src/llm/highlights.ts），写完可撤销、可重写。
import { useState } from 'react'
import type { Stop, Trip } from '@core/types'
import { namesMatch } from '../geo/groundDay'
import { LlmError, PROVIDER_LABEL } from '../llm/client'
import { applyHighlights, searchPlayTips, writeHighlights } from '../llm/highlights'
import { useToast } from './kit/Toast'
import { useSettings } from './Settings'

export function HighlightsCard({ trip, onTrip }: { trip: Trip; onTrip: (t: Trip) => void }) {
  const { llm, zhipuKey } = useSettings()
  const toast = useToast()
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const sights = trip.days.flatMap(d => d.stops).filter(s => s.kind === 'sight')
  if (!sights.length && !trip.highlights?.length) return null
  const dayOf = (id?: string) => (id ? trip.days.findIndex(d => d.stops.some(s => s.id === id)) : -1)

  const write = async () => {
    setErr('')
    try {
      let refs: Awaited<ReturnType<typeof searchPlayTips>>['refs'] = []
      let yuan = 0
      if (zhipuKey) {
        setBusy('正在网上搜玩法')
        try { ({ refs, yuan } = await searchPlayTips(trip, zhipuKey)) } catch { refs = [] }
      }
      setBusy(`${PROVIDER_LABEL[llm.provider]} 正在写亮点`)
      const { h, usage } = await writeHighlights(llm, trip, refs)
      const before = trip
      const next = applyHighlights(trip, h, namesMatch)
      onTrip(next)
      toast(`写好了 ${next.highlights?.length ?? 0} 条亮点 · 约 $${usage.usd.toFixed(3)}${yuan ? ` + 搜索 ¥${yuan.toFixed(2)}` : ''}`, () => onTrip(before))
    } catch (e) {
      setErr(e instanceof LlmError ? e.message : '写亮点失败：' + (e instanceof Error ? e.message : String(e)))
    } finally { setBusy('') }
  }

  if (!trip.highlights?.length) {
    return (
      <div className="hl-card empty">
        <b>这趟的亮点</b>
        <p>每个地方最受推崇的玩法、什么时候去最好、要避开的坑，按你们这群人写。</p>
        {busy ? <p className="hl-busy" aria-live="polite">{busy}…</p> : (
          <button type="button" className="kbtn wide" disabled={!llm.apiKey} onClick={write}>{llm.apiKey ? '让 AI 写这趟的亮点' : '先在「同行」页填大模型的 Key'}</button>
        )}
        {err && <p className="issue-msg lv-error" role="alert">{err}</p>}
      </div>
    )
  }
  return (
    <div className="hl-card">
      <div className="hl-hd"><b>这趟的亮点</b>{busy ? <small aria-live="polite">{busy}…</small> : <button type="button" className="linkish" onClick={write} disabled={!llm.apiKey}>重新写</button>}</div>
      <ol>
        {trip.highlights.map((h, i) => {
          const d = dayOf(h.stopId)
          return <li key={i}>{d >= 0 && <em className="mono">D{d + 1}</em>}{h.text}</li>
        })}
      </ol>
      {err && <p className="issue-msg lv-error" role="alert">{err}</p>}
    </div>
  )
}

/** 站点面板里的「怎么玩」 */
export function StopHow({ s }: { s: Stop }) {
  const h = s.highlight
  if (!h) return null
  return (
    <div className="hl-how">
      <b>怎么玩</b>
      <p>{h.how}</p>
      {h.when && <p><span>时间</span>{h.when}</p>}
      {h.tip && <p><span>提醒</span>{h.tip}</p>}
      {h.family && <p><span>你们家</span>{h.family}</p>}
    </div>
  )
}

/** 「今天」页当前站下面的一行 */
export function HowLine({ s }: { s?: Stop }) {
  if (!s?.highlight) return null
  return <p className="hl-line">怎么玩：{s.highlight.how}{s.highlight.when ? ` · ${s.highlight.when}` : ''}</p>
}

/** 重新排程后站点换了：按名字把原来写好的玩法接到新站点上，整趟亮点指向的站点也跟着换 */
export function carryHighlights(before: Trip, after: Trip): Trip {
  const old = before.days.flatMap(d => d.stops).filter(s => s.highlight)
  if (!old.length && !before.highlights?.length) return after
  const byName = new Map(old.map(s => [s.name, s.highlight!]))
  const idFor = new Map<string, string>()
  const days = after.days.map(d => ({ ...d, stops: d.stops.map(s => {
    const prev = before.days.flatMap(x => x.stops).find(x => x.name === s.name)
    if (prev) idFor.set(prev.id, s.id)
    return !s.highlight && byName.has(s.name) ? { ...s, highlight: byName.get(s.name) } : s
  }) }))
  const highlights = before.highlights?.map(h => (h.stopId ? (idFor.has(h.stopId) ? { ...h, stopId: idFor.get(h.stopId) } : { text: h.text }) : h))
  return { ...after, days, ...(highlights?.length ? { highlights } : {}) }
}
