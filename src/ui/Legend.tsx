// 图例：红圈限制牌 + 比例尺。叠加的结果和来源都在这里说清楚。
import { useState } from 'react'
import { deriveConstraints, limitRules, RULES, type Constraints, type Limit } from '@core/constraints'
import { whoForAll } from '@core/explain'
import type { DayParty } from '@core/party'
import { fmtHM } from '@core/schedule'

interface DiskSpec { key: string; label: string; limit: Limit; value: string; unit?: string }

export function disksOf(c: Constraints): DiskSpec[] {
  const out: DiskSpec[] = [
    { key: 'walk', label: '步行', limit: c.walkKm, value: String(c.walkKm.value), unit: 'km' },
  ]
  if (Number.isFinite(c.driveBreakMin.value)) out.push({ key: 'break', label: '连续驾驶', limit: c.driveBreakMin, value: String(c.driveBreakMin.value), unit: '分' })
  out.push({ key: 'end', label: '回住处', limit: c.endBy, value: fmtHM(c.endBy.value) })
  if (Number.isFinite(c.altitudeM.value)) out.push({ key: 'alt', label: '海拔', limit: c.altitudeM, value: String(c.altitudeM.value), unit: 'm' })
  else if (Number.isFinite(c.driveMin.value)) out.push({ key: 'drive', label: '每天驾驶', limit: c.driveMin, value: String(c.driveMin.value / 60), unit: 'h' })
  return out
}

export function Disk({ d, who, on, onClick }: { d: DiskSpec; who: string[]; on?: boolean; onClick?: () => void }) {
  const long = d.value.length >= 4
  return (
    <button type="button" className={'disk' + (on ? ' on' : '')} onClick={onClick} aria-expanded={on} aria-label={`${d.label} ${d.value}${d.unit ?? ''}，${who.join('、') || '默认'}`}>
      <span className={'dk' + (long ? ' long' : '')}>{d.value}{d.unit && <small>{d.unit}</small>}</span>
      <em>{who.length ? who.join(' ') : '默认'}</em>
      <u>{d.label}</u>
    </button>
  )
}

function Why({ rules, dp }: { rules: string[]; dp: DayParty }) {
  return (
    <ul className="why">
      {rules.map(id => {
        const who = whoForAll([id], dp)
        return (
          <li key={id}>
            <b>{RULES[id]?.label ?? id}</b>
            {who.length > 0 && <span className="who-inline">{who.join('、')}</span>}
            <p>{RULES[id]?.why}</p>
          </li>
        )
      })}
    </ul>
  )
}

/** 游玩时长比例尺：每个人各自的上限都在尺上（淡），最严的压实标红 */
export function ActiveScale({ c, dp, played, planned }: { c: Constraints; dp: DayParty; played: number; planned: number }) {
  const personal = new Map<number, string[]>()
  for (const m of dp.members) {
    const v = deriveConstraints({ ...dp, members: [m], pets: [] }).activeMin.value
    personal.set(v, [...(personal.get(v) ?? []), m.name])
  }
  const max = Math.max(600, planned, ...personal.keys())
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`
  const hard = c.activeMin.value
  const cells = Math.round(max / 60)
  return (
    <div className="scale">
      <div className="scale-head">
        <span>游玩时长</span>
        <span className="num">{(played / 60).toFixed(1)} / {hard / 60} h{planned > hard && <b> · 计划 {(planned / 60).toFixed(1)} h 超了</b>}</span>
      </div>
      <div className="scale-bar-wrap">
        <div className="scale-played" style={{ width: pct(played) }} />
        <div className="scale-bar">{Array.from({ length: cells }, (_, i) => <s key={i} />)}</div>
        {planned > 0 && <div className={'scale-plan' + (planned > hard ? ' over' : '')} style={{ left: pct(planned) }} title="计划游玩时长" />}
      </div>
      <div className="scale-marks">
        <span style={{ left: 0 }}>0</span>
        {[...personal.entries()].sort((a, b) => a[0] - b[0]).map(([v, names]) => (
          <span key={v} className={v === hard ? 'hard' : 'ghost'} style={{ left: pct(v) }}>
            {v / 60} h<br />{names.join(' ')}
          </span>
        ))}
      </div>
    </div>
  )
}

export function Legend({ c, dp, played, planned, title = '今日限制' }: { c: Constraints; dp: DayParty; played: number; planned: number; title?: string }) {
  const [full, setFull] = useState(false)
  const disks = disksOf(c)
  // 展开后说明哪一块牌子：默认第一块，点别的牌子换
  const [pick, setPick] = useState<string | null>(null)
  const opened = full ? disks.find(d => d.key === pick) ?? disks[0] : undefined
  const over = planned > c.activeMin.value
  const toggle = () => setFull(!full)
  return (
    <section className={'legend' + (full ? ' full' : '')} aria-label={title}>
      {/* 整条标题栏都能点：展开 / 收起写在明处 */}
      <button type="button" className="legend-head" onClick={toggle} aria-expanded={full}>
        <span className="legend-title">{title}</span>
        <span className="legend-sum">游玩 <b className={over ? 'over' : ''}>{(played / 60).toFixed(1)}/{c.activeMin.value / 60} h</b></span>
        <span className="legend-more">{full ? '收起' : '展开'}<svg viewBox="0 0 12 12" aria-hidden="true"><path d={full ? 'M2.5 7.5 6 4l3.5 3.5' : 'M2.5 4.5 6 8l3.5-3.5'} /></svg></span>
      </button>
      <div className="disks">
        {disks.map(d => (
          <Disk key={d.key} d={d} who={whoForAll(limitRules(d.limit), dp)} on={opened?.key === d.key}
            onClick={() => { if (!full) setFull(true); setPick(d.key) }} />
        ))}
      </div>
      {opened && (
        <div className="legend-why">
          <p className="legend-hint">{opened.label}是谁定的、为什么{disks.length > 1 && <small>（点上面的限制牌换一项）</small>}</p>
          <Why rules={limitRules(opened.limit)} dp={dp} />
        </div>
      )}
      <div className="scale-slot"><ActiveScale c={c} dp={dp} played={played} planned={planned} /></div>
    </section>
  )
}
