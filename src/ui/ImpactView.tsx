// 面板底部的影响提示：改完立刻看到谁的哪条上限怎么变了、哪些问题解决或冒出来了。
import type { Issue } from '@core/validate'
import { daysLabel, type DayImpact, type PartyImpact } from './impact'

export function PartyImpactView({ impact, total }: { impact: PartyImpact; total: number }) {
  const none = !impact.limits.length && !impact.blockers.length
  return (
    <div className="impact" aria-live="polite">
      <h3>这样改之后</h3>
      {none ? <p className="none">上限没有变化</p> : (
        <ul>
          {impact.blockers.map(b => <li key={b} className="bad">{b}</li>)}
          {impact.limits.map((l, i) => (
            <li key={i} className={l.tighter ? 'tighter' : 'looser'}>
              {l.label} {l.from} → <b>{l.to}</b>
              <small>{daysLabel(l.days, total)}{l.who.length ? ` · ${l.who.join('、')}` : ''}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function DayImpactView({ impact }: { impact: DayImpact }) {
  const none = !impact.fixed.length && !impact.added.length && !impact.changed.length
  const line = (i: Issue, kind: 'good' | 'bad') => <li key={kind + i.code + (i.stopId ?? '')} className={kind}>{kind === 'good' ? '解决了' : '新问题'}：{i.short}</li>
  return (
    <div className="impact" aria-live="polite">
      <h3>这样改之后</h3>
      {none ? <p className="none">当天的检查结果没有变化</p> : <ul>{impact.fixed.map(i => line(i, 'good'))}{impact.changed.map(c => <li key={'c' + c.to.code + (c.to.stopId ?? '')} className="tighter">{c.from.short} → <b>{c.to.short}</b></li>)}{impact.added.map(i => line(i, 'bad'))}</ul>}
    </div>
  )
}
