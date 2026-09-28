// 大控件：不用输入框和下拉。按下即时反馈，目标都不小于 44px。
import { useRef, type ReactNode } from 'react'
import type { DayRange } from '@core/types'

/** − 数值 + */
export function Stepper({ value, onChange, step = 1, min = 0, max = 999, format = String, label }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; format?: (v: number) => string; label: string
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step))
  // 按住连续加减：先停 400ms，再每 90ms 一步
  const timer = useRef<number>(0)
  const held = useRef(false)
  const hold = (dir: 1 | -1) => {
    let v = value
    held.current = false
    const tick = () => { held.current = true; v = clamp(v + dir * step); onChange(v); timer.current = window.setTimeout(tick, 90) }
    timer.current = window.setTimeout(tick, 400)
  }
  // 按住连加过了，松手那一下的 click 不再多加一步
  const tap = (dir: 1 | -1) => { if (held.current) { held.current = false; return } onChange(clamp(value + dir * step)) }
  const release = () => clearTimeout(timer.current)
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`减少${label}`} disabled={value <= min}
        onClick={() => tap(-1)} onPointerDown={() => hold(-1)} onPointerUp={release} onPointerLeave={release}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg>
      </button>
      <output aria-live="polite">{format(value)}</output>
      <button type="button" aria-label={`增加${label}`} disabled={value >= max}
        onClick={() => tap(1)} onPointerDown={() => hold(1)} onPointerUp={release} onPointerLeave={release}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M8 3v10" /></svg>
      </button>
    </div>
  )
}

export interface Option<T extends string | number> { value: T; label: string; icon?: ReactNode }

/** 分段键：少量互斥选项 */
export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: Option<T>[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  )
}

/** 大磁贴：选类别 */
export function Tiles<T extends string>({ options, onPick }: { options: (Option<T> & { hint?: string })[]; onPick: (v: T) => void }) {
  return (
    <div className="tiles">
      {options.map(o => (
        <button key={o.value} type="button" className="tile" onClick={() => onPick(o.value)}>
          <span className="tile-icon">{o.icon}</span>
          <b>{o.label}</b>
          {o.hint && <small>{o.hint}</small>}
        </button>
      ))}
    </div>
  )
}

/** 开关 */
export function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={'toggle' + (on ? ' on' : '')} onClick={() => onChange(!on)}>
      <span className="toggle-text"><b>{label}</b>{hint && <small>{hint}</small>}</span>
      <i className="toggle-track" aria-hidden="true"><i /></i>
    </button>
  )
}

/** 多选小键 */
export function Chips<T extends string>({ values, options, onChange, label }: { values: T[]; options: Option<T>[]; onChange: (v: T[]) => void; label: string }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map(o => {
        const on = values.includes(o.value)
        return (
          <button key={o.value} type="button" aria-pressed={on} className={'chipk' + (on ? ' on' : '')} onClick={() => onChange(on ? values.filter(x => x !== o.value) : [...values, o.value])}>
            {o.icon}{o.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * 天数条：手指按下的那天是起点，划过去就选中连续的几天；点「全程」恢复。
 * 核心只支持连续的天（中途加入、提前离开），所以这里也只给连续选择。
 */
export function DayStrip({ total, value, onChange, labels }: { total: number; value?: DayRange; onChange: (r?: DayRange) => void; labels: string[] }) {
  const from = value?.from ?? 0
  const to = value?.to ?? total - 1
  const anchor = useRef<number | null>(null)
  const cells = useRef<HTMLDivElement>(null)
  const set = (a: number, b: number) => {
    const f = Math.min(a, b), t = Math.max(a, b)
    onChange(f === 0 && t === total - 1 ? undefined : { from: f, to: t })
  }
  const indexAt = (x: number) => {
    const el = cells.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    return Math.min(total - 1, Math.max(0, Math.floor(((x - r.left) / r.width) * total)))
  }
  return (
    <div className="daystrip">
      <div ref={cells} className="daystrip-cells" role="group" aria-label="参加哪几天：按住一天划到另一天"
        onPointerDown={e => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); const i = indexAt(e.clientX); anchor.current = i; set(i, i) }}
        onPointerMove={e => { if (anchor.current != null) set(anchor.current, indexAt(e.clientX)) }}
        onPointerUp={() => { anchor.current = null }} onPointerCancel={() => { anchor.current = null }}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={'dcell' + (i >= from && i <= to ? ' on' : '') + (i === from ? ' first' : '') + (i === to ? ' last' : '')}>
            <b>{i + 1}</b><small>{labels[i]}</small>
          </span>
        ))}
      </div>
      <button type="button" className={'daystrip-all' + (value ? '' : ' on')} onClick={() => onChange(undefined)}>全程</button>
    </div>
  )
}

/** 面板里的一个区块：左边标题，右边控件 */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="kfield">
      <div className="kfield-label"><b>{label}</b>{hint && <small>{hint}</small>}</div>
      {children}
    </div>
  )
}
