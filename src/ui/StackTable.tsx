// 逐日叠加表：每天五项上限，小字是收紧这一项的人。「同行」页、「今天」和「行程」的右页都用它。
import { deriveConstraints, limitRules } from '@core/constraints'
import { whoForAll } from '@core/explain'
import { partyOnDay } from '@core/party'
import { fmtHM } from '@core/schedule'
import type { Trip } from '@core/types'
import { fmtShort } from './format'

type Key = 'activeMin' | 'walkKm' | 'driveBreakMin' | 'endBy' | 'altitudeM'
const COLS: { key: Key; label: string }[] = [
  { key: 'activeMin', label: '游玩' },
  { key: 'walkKm', label: '步行' },
  { key: 'driveBreakMin', label: '连续驾驶' },
  { key: 'endBy', label: '回住处' },
  { key: 'altitudeM', label: '海拔' },
]

export function StackTable({ trip, highlight }: { trip: Trip; highlight?: number }) {
  const days = trip.days.map((_, i) => {
    const dp = partyOnDay(trip.party, i)
    return { i, dp, c: deriveConstraints(dp) }
  })
  const fmt = (key: Key, v: number) => key === 'activeMin' ? `${v / 60}h` : key === 'walkKm' ? `${v}km` : key === 'driveBreakMin' ? `${v}分` : key === 'endBy' ? fmtHM(v) : `${v}m`
  return (
    <div className="stack-wrap">
      <table className="stack">
        <thead><tr><th>天</th>{COLS.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead>
        <tbody>
          {days.map(d => (
            <tr key={d.i} className={d.i === highlight ? 'hl' : undefined}>
              <th className="num">{d.i + 1}<small>{fmtShort(trip.startDate, d.i)}</small></th>
              {COLS.map(({ key }) => {
                const l = d.c[key]
                if (!Number.isFinite(l.value)) return <td key={key} className="na">—</td>
                const who = l.by === 'base' ? [] : whoForAll(limitRules(l), d.dp)
                return <td key={key}><b className="num">{fmt(key, l.value)}</b>{who.length > 0 && <small>{who.join(' ')}</small>}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
