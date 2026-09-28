// 导入攻略：贴链接或正文 → 取正文（链接走服务器代取）→ 大模型提炼路线和地点、标出和同行者冲突的 → 高德核实 → 勾选后加进要去的地方。
// 「不适合」的点默认不勾、「要留意」的照常勾上，让人自己决定；找不到的点列出来，可以回去手动搜。
import { useState } from 'react'
import type { Trip } from '@core/types'
import { AmapError, searchPlaces } from '../geo/amap'
import { namesMatch } from '../geo/groundDay'
import { LlmError, PROVIDER_LABEL } from '../llm/client'
import { fetchGuide, FetchGuideError, findUrl } from '../llm/fetchGuide'
import { extractGuide, resolveGuide, type Guide, type ImportedPlace } from '../llm/importGuide'
import { Field } from './kit/controls'
import { useSettings } from './Settings'
import { PickPlaces } from './PickPlaces'

interface Props {
  trip: Trip
  onAdd: (places: ImportedPlace[]) => void
  onCancel: () => void
}

type Stage =
  | { kind: 'input' }
  | { kind: 'busy'; msg: string }
  | { kind: 'done'; guide: Guide; places: ImportedPlace[]; missing: string[]; source: string; usd: number }
  | { kind: 'error'; msg: string }

export function GuideImport({ trip, onAdd, onCancel }: Props) {
  const { amapKey, llm } = useSettings()
  const [text, setText] = useState('')
  const [stage, setStage] = useState<Stage>({ kind: 'input' })

  const run = async () => {
    const raw = text.trim()
    if (!raw) return
    try {
      let body = raw
      let source = '粘贴的正文'
      const url = findUrl(raw)
      // 只贴了链接（或分享文案里夹着链接、正文很短）：去取正文
      if (url && raw.replace(url, '').replace(/\s/g, '').length < 200) {
        setStage({ kind: 'busy', msg: '正在取正文' })
        const g = await fetchGuide(url)
        if (g.partial) {
          setStage({ kind: 'error', msg: `${g.host.includes('xiaohongshu') || g.host.includes('xhslink') ? '小红书要登录才能看全文，' : g.host.includes('douyin') ? '抖音的内容在视频里，' : '这个网页'}只拿到了开头几句。把正文复制过来贴在这里吧（在 App 里长按正文就能复制）。` })
          return
        }
        body = g.text
        source = g.title || g.host
      }
      setStage({ kind: 'busy', msg: `${PROVIDER_LABEL[llm.provider]} 正在读攻略` })
      const { guide, usage } = await extractGuide(llm, trip, body)
      const { places, missing } = await resolveGuide(guide, trip.days.length,
        async (k, city) => (await searchPlaces(k, amapKey, { city })).map(p => ({ name: p.name, area: p.area, poi: p.poi, type: p.type })),
        namesMatch, (i, n, name) => setStage({ kind: 'busy', msg: `在高德里核实 ${i}/${n}：${name}` }))
      setStage({ kind: 'done', guide, places, missing, source, usd: usage.usd })
    } catch (e) {
      const msg = e instanceof FetchGuideError || e instanceof LlmError || e instanceof AmapError ? e.message : '导入失败：' + (e instanceof Error ? e.message : String(e))
      setStage({ kind: 'error', msg })
    }
  }

  if (!llm.apiKey || !amapKey) {
    return (
      <div className="gi">
        <p className="sheet-note">导入攻略要用大模型读正文、用高德核实地点：先在「同行」页最下面填上{!llm.apiKey ? `${PROVIDER_LABEL[llm.provider]} 的 API Key` : ''}{!llm.apiKey && !amapKey ? '和' : ''}{!amapKey ? '高德 Key' : ''}。</p>
        <button type="button" className="kbtn wide" onClick={onCancel}>返回</button>
      </div>
    )
  }

  if (stage.kind === 'done') {
    const { guide, places, missing, source, usd } = stage
    const tooLong = guide.days != null && guide.days > trip.days.length
    return (
      <PickPlaces places={places} missing={missing} dayLabel="原文" backLabel="换一篇" onBack={() => setStage({ kind: 'input' })} onAdd={onAdd}
        head={<>
          <b>{guide.title}</b>
          <small>{source} · {guide.days ? `原文 ${guide.days} 天 · ` : ''}约 ${usd.toFixed(3)}</small>
          <p>{guide.summary}</p>
          {tooLong && <p className="gi-warn">原文 {guide.days} 天，这趟只有 {trip.days.length} 天：先不按原文分天，排的时候按你们的限制放，放不下的会列出来。</p>}
        </>}
        tips={guide.tips.length > 0 && <div className="gi-tips"><h4>原文的提醒</h4><ul>{guide.tips.map(t => <li key={t}>{t}</li>)}</ul></div>} />
    )
  }

  return (
    <div className="gi">
      <Field label="贴攻略链接或正文" hint="携程游记、公众号文章可以直接贴链接；小红书、抖音请复制正文">
        <textarea className="kinput" rows={5} value={text} onChange={e => setText(e.target.value)} disabled={stage.kind === 'busy'}
          placeholder={'比如：https://you.ctrip.com/travels/…\n或者把游记正文整段粘贴进来'} />
      </Field>
      {stage.kind === 'busy' && <div className="replan-wait" aria-live="polite"><i className="replan-dot" aria-hidden="true" /><p>{stage.msg}…</p></div>}
      {stage.kind === 'error' && <p className="issue-msg lv-error" role="alert">{stage.msg}</p>}
      <p className="sheet-note">会对照这趟的同行情况读一遍：只挑原文里的地方，标出不适合你们的（高海拔、走太远……），不会自己编。</p>
      <div className="foot-row">
        <button type="button" className="kbtn" onClick={onCancel}>返回</button>
        <button type="button" className="kbtn primary" disabled={!text.trim() || stage.kind === 'busy'} onClick={run}>读这篇攻略</button>
      </div>
    </div>
  )
}
