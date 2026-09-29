// 勾选地点：导入攻略、AI 推荐方案出来的地点在这里挑，勾上的加进「要去的地方」。
// 「不适合」的默认不勾（由调用方决定初始勾选），「留意」的照常勾上。
import { useState, type ReactNode } from 'react'
import type { ImportedPlace } from '../llm/importGuide'
import { LineIcon } from './symbols'

interface Props {
  head: ReactNode
  places: ImportedPlace[]
  missing: string[]
  /** 原来是第几天的说法：「原文第 N 天」「方案第 N 天」 */
  dayLabel: string
  tips?: ReactNode
  backLabel: string
  onBack: () => void
  onAdd: (places: ImportedPlace[]) => void
}

export function PickPlaces({ head, places, missing, dayLabel, tips, backLabel, onBack, onAdd }: Props) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(places.filter(p => !p.avoid).map(p => p.id)))
  const toggle = (id: string) => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <div className="gi">
      <div className="gi-head">{head}</div>
      <ol className="gi-list">
        {places.map(p => {
          const on = picked.has(p.id)
          return (
            <li key={p.id}>
              <button type="button" role="checkbox" aria-checked={on} className={'gi-row' + (on ? ' on' : '')} onClick={() => toggle(p.id)}>
                <span className="box" aria-hidden="true">{on ? '✓' : ''}</span>
                <LineIcon name={p.kind} size={18} />
                <span className="b">
                  <b>{p.name}{p.prefDay != null && <em>{dayLabel}第 {p.prefDay + 1} 天</em>}</b>
                  {p.note && <small>{p.note}{p.durationMin ? ` · 约 ${p.durationMin >= 60 ? `${Math.round(p.durationMin / 30) / 2} 小时` : `${p.durationMin} 分`}` : ''}</small>}
                  {p.avoid && <small className="avoid">不适合：{p.avoid}</small>}
                  {p.caution && <small className="caution">留意：{p.caution}</small>}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      {missing.length > 0 && <p className="sheet-note">高德里没找到：{missing.join('、')}。需要的话回去手动搜。</p>}
      {tips}
      <div className="foot-row">
        <button type="button" className="kbtn" onClick={onBack}>{backLabel}</button>
        <button type="button" className="kbtn primary" disabled={!picked.size} onClick={() => onAdd(places.filter(p => picked.has(p.id)))}>加入 {picked.size} 个地方</button>
      </div>
    </div>
  )
}
