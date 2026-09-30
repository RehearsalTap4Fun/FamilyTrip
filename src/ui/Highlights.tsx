// 「这趟的亮点」卡片（行程页顶部）与站点的「怎么玩」。亮点由 AI 按网上的推荐、好评写（src/llm/highlights.ts），附出处、按行程先后排；写完可撤销、可重写。
import { useState } from 'react'
import type { Stop, Trip } from '@core/types'
import { regionAt } from '../geo/amap'
import { LlmError, PROVIDER_LABEL } from '../llm/client'
import { applyHighlights, searchPlayTips, writeHighlights } from '../llm/highlights'
import { useToast } from './kit/Toast'
import { useSettings } from './Settings'

export function HighlightsCard({ trip, onTrip }: { trip: Trip; onTrip: (t: Trip) => void }) {
  const { llm, zhipuKey, amapKey } = useSettings()
  const toast = useToast()
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const sights = trip.days.flatMap(d => d.stops).filter(s => s.kind === 'sight')
  if (!sights.length && !trip.highlights?.length) return null
  const dayOf = (id?: string) => (id ? trip.days.findIndex(d => d.stops.some(s => s.id === id)) : -1)
  // 按行程先后：拖动换了顺序、改了天也跟着排
  const pos = new Map(trip.days.flatMap(d => d.stops).map((s, i) => [s.id, i]))
  const list = [...(trip.highlights ?? [])].sort((a, b) => (pos.get(a.stopId ?? '') ?? 1e9) - (pos.get(b.stopId ?? '') ?? 1e9))

  const write = async () => {
    setErr('')
    try {
      let refs: Awaited<ReturnType<typeof searchPlayTips>>['refs'] = []
      let yuan = 0
      if (zhipuKey) {
        setBusy('正在网上搜玩法')
        // 有高德 Key 就按坐标问在哪个区县，带着地名搜
        const areaOf = amapKey ? (s: Stop) => (s.poi ? regionAt(s.poi, amapKey) : Promise.resolve(null)) : undefined
        try { ({ refs, yuan } = await searchPlayTips(trip, zhipuKey, 8, fetch, areaOf)) } catch { refs = [] }
      }
      setBusy(`${PROVIDER_LABEL[llm.provider]} 正在写亮点`)
      const { h, usage } = await writeHighlights(llm, trip, refs)
      const before = trip
      const next = applyHighlights(trip, h, refs)
      onTrip(next)
      const n = next.highlights?.length ?? 0
      const what = !zhipuKey ? '写好了各站怎么玩（没填智谱 Key，搜不了网上的推荐，不写亮点）' : n ? `写好了 ${n} 条亮点（都有网上的推荐）` : '网上没搜到这趟地方的推荐，只写了各站怎么玩'
      toast(`${what} · 约 $${usage.usd.toFixed(3)}${yuan ? ` + 搜索 ¥${yuan.toFixed(2)}` : ''}`, () => onTrip(before))
    } catch (e) {
      setErr(e instanceof LlmError ? e.message : '写亮点失败：' + (e instanceof Error ? e.message : String(e)))
    } finally { setBusy('') }
  }

  if (!trip.highlights?.length) {
    return (
      <div className="hl-card empty">
        <b>这趟的亮点</b>
        <p>{zhipuKey ? '按网上对这趟排到的地方的推荐和好评挑亮点、附出处；每个地方怎么玩、什么时候去、要避开的坑，按你们这群人写。' : '每个地方怎么玩、什么时候去、要避开的坑，按你们这群人写。亮点要按网上的推荐来挑：在设置里填智谱 Key 才会写。'}</p>
        {busy ? <p className="hl-busy" aria-live="polite">{busy}…</p> : (
          <button type="button" className="kbtn wide" disabled={!llm.apiKey} onClick={write}>{llm.apiKey ? '让 AI 写这趟的亮点' : '先在设置里填大模型的 Key（「同行」页右上角）'}</button>
        )}
        {err && <p className="issue-msg lv-error" role="alert">{err}</p>}
      </div>
    )
  }
  return (
    <div className="hl-card">
      <div className="hl-hd"><b>这趟的亮点</b>{busy ? <small aria-live="polite">{busy}…</small> : <button type="button" className="linkish" onClick={write} disabled={!llm.apiKey}>重新写</button>}</div>
      <ol>
        {list.map((h, i) => {
          const d = dayOf(h.stopId)
          return (
            <li key={i}>{d >= 0 && <em className="mono">D{d + 1}</em>}{h.text}
              {h.refs?.length ? <span className="hl-src">{h.refs.map((r, k) => <a key={k} href={r.url} target="_blank" rel="noreferrer noopener">{r.site || '出处'}</a>)}</span> : null}
            </li>
          )
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
  // 亮点跟着地方走：重排后这个地方不在行程里了，这条亮点也不要了
  const highlights = before.highlights?.flatMap(h => (h.stopId && idFor.has(h.stopId) ? [{ ...h, stopId: idFor.get(h.stopId) }] : []))
  return { ...after, days, ...(highlights?.length ? { highlights } : {}) }
}
