// 让 AI 重排这一天：写一句要求 → 等模型排（规则层检查、必要时自动再修）→ 看改前改后 → 采用或再来。
// 采用之前什么都不写入；采用后给撤销。
import { useEffect, useRef, useState } from 'react'
import { partyOnDay } from '@core/party'
import { aggregate, rankForParty, type Rating } from '@core/ratings'
import { fmtHM, scheduleDay } from '@core/schedule'
import type { Trip } from '@core/types'
import { LlmError, PROVIDER_LABEL } from '../llm/client'
import { replanDay, type ReplanResult } from '../llm/replanDay'
import { driveBetween, searchPlaces } from '../geo/amap'
import { makeGrounder } from '../geo/groundDay'
import { cityOf } from '@core/footprint'
import { dayImpact } from './impact'
import { DayImpactView } from './ImpactView'
import { Field } from './kit/controls'
import { Sheet } from './kit/Sheet'
import { Chip } from './ScopeToday'
import { useSettings } from './Settings'
import { LineIcon } from './symbols'

interface Props {
  open: boolean
  trip: Trip
  dayIndex: number
  ratings: Rating[]
  onApply: (t: Trip, summary: string) => void
  onClose: () => void
}

type Stage = { kind: 'ask' } | { kind: 'running'; since: number } | { kind: 'done'; r: ReplanResult } | { kind: 'error'; msg: string }

export function ReplanSheet({ open, trip, dayIndex, ratings, onApply, onClose }: Props) {
  const { llm, amapKey } = useSettings()
  const [wishes, setWishes] = useState('')
  const [stage, setStage] = useState<Stage>({ kind: 'ask' })
  const [, tick] = useState(0)
  const run = useRef(0)
  useEffect(() => { if (open) setStage({ kind: 'ask' }) }, [open])
  // 等待时每秒刷新一次已用时间
  useEffect(() => {
    if (stage.kind !== 'running') return
    const t = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [stage.kind])

  const start = async () => {
    const my = ++run.current
    setStage({ kind: 'running', since: Date.now() })
    try {
      const places = rankForParty(aggregate(ratings), partyOnDay(trip.party, dayIndex))
      // 填了高德 Key 就让每一版先落地：新站定位、按真实路线重算车程
      const ground = amapKey ? makeGrounder({
        search: (name, near) => searchPlaces(name, amapKey, { city: near?.adcode ? cityOf(near.adcode) : undefined }),
        drive: (a, b) => driveBetween(a, b, amapKey),
      }) : undefined
      const r = await replanDay(llm, { trip, dayIndex, places, wishes }, { ground })
      if (my === run.current) setStage({ kind: 'done', r })
    } catch (e) {
      if (my === run.current) setStage({ kind: 'error', msg: e instanceof LlmError ? e.message : '重排失败：' + (e instanceof Error ? e.message : String(e)) })
    }
  }
  const close = () => { run.current++; onClose() }

  const noKey = !llm.apiKey
  const done = stage.kind === 'done' ? stage.r : null
  const newSlots = done ? scheduleDay(done.trip.days[dayIndex]) : []
  const oldIds = new Set(trip.days[dayIndex].stops.map(s => s.id))

  return (
    <Sheet open={open} onClose={close} title={`让 AI 重排第 ${dayIndex + 1} 天`}
      done={stage.kind === 'done' ? '采用' : stage.kind === 'running' ? '排着呢' : '开始排'}
      doneDisabled={noKey || stage.kind === 'running'}
      onDone={stage.kind === 'done' ? () => onApply(stage.r.trip, stage.r.summary) : start}
      footer={done ? (
        <>
          <DayImpactView impact={dayImpact(trip, done.trip, dayIndex)} />
          <div className="foot-row">
            <button type="button" className="kbtn" onClick={start}>再排一次</button>
            <button type="button" className="kbtn" onClick={close}>不要</button>
          </div>
        </>
      ) : undefined}>
      {noKey && <p className="sheet-note">先在「同行」页右上角的设置里选好大模型、填上 API Key。</p>}

      {(stage.kind === 'ask' || stage.kind === 'error') && !noKey && (
        <>
          <Field label="有什么要求" hint="可以不写">
            <input className="kinput" value={wishes} onChange={e => setWishes(e.target.value)} placeholder="比如：别太赶、下午想去洱海边" onKeyDown={e => { if (e.key === 'Enter') start() }} />
          </Field>
          <p className="sheet-note">会带上这天所有人的限制和你的黑榜，排完{amapKey ? '先按高德核实车程、' : '先'}用规则检查，有问题自动让它再改。用 {PROVIDER_LABEL[llm.provider]}，{llm.provider === 'deepseek' ? '通常十几秒' : '通常要半分钟到一分钟'}。</p>
          {stage.kind === 'error' && <p className="issue-msg lv-error" role="alert">{stage.msg}</p>}
        </>
      )}

      {stage.kind === 'running' && (
        <div className="replan-wait" aria-live="polite">
          <i className="replan-dot" aria-hidden="true" />
          <p>正在排… {Math.round((Date.now() - stage.since) / 1000)} 秒</p>
        </div>
      )}

      {done && (
        <>
          <p className="replan-summary">{done.summary}</p>
          <p className="sheet-note">
            问题 {done.before.length} → <b>{done.after.length}</b>
            {done.attempts > 1 ? ` · 自动修了 ${done.attempts - 1} 次` : ''} · 约 ${done.usage.usd.toFixed(3)}
          </p>
          <p className="sheet-note">{groundLine(done, !!amapKey)}</p>
          {done.after.length > 0 && <div className="day-chips">{done.after.map((i, k) => <Chip key={k} issue={i} />)}</div>}
          <ol className="replan-list">
            {newSlots.map(sl => {
              const s = sl.stop
              const isNew = !oldIds.has(s.id)
              return (
                <li key={s.id} className={isNew ? 'new' : ''}>
                  <span className="t mono">{fmtHM(sl.start)}</span>
                  <LineIcon name={s.kind} size={18} />
                  <span className="b"><b>{s.name}</b>{isNew && <em>新</em>}{s.why && <small>{s.why}</small>}</span>
                  <span className="dur mono">{s.kind === 'lodging' ? (s.home ? '到家' : '住') : `${s.durationMin}′`}</span>
                </li>
              )
            })}
          </ol>
        </>
      )}
    </Sheet>
  )
}

/** 车程有没有按高德核实过，一句话说清楚 */
function groundLine(r: ReplanResult, hasKey: boolean): string {
  if (!hasKey) return '车程是 AI 估的；在「同行」页右上角的设置里填上高德 Key，就会按真实路线核实'
  if (r.groundError) return `车程没能核实（${r.groundError}），是 AI 估的`
  const g = r.ground
  if (!g) return ''
  const bits = [g.located.length ? `新站 ${g.located.length} 个已在高德定位` : '', g.legs.length ? `${g.legs.length} 段车程按高德核实` : '']
  const miss = g.unlocated.length ? `；${g.unlocated.join('、')} 没找到位置，车程是估的` : ''
  return (bits.filter(Boolean).join('，') || '没有需要核实的车程') + miss
}
