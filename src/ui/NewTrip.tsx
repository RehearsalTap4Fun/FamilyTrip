// 新建行程：谁去 → 什么时候、怎么去 → 玩法 → 怎么排。一个面板里分四步，每步都有默认值，能一路点「下一步」。
// 排法分两种：已知要去的点（工具只排时间）/ 只知道大概地区（工具推荐去处）。N1 先建空行程骨架，排程与推荐在 N2、N3 接上。
import { useEffect, useMemo, useState } from 'react'
import { deriveConstraints } from '@core/constraints'
import { partyOnDay } from '@core/party'
import { addDays, carryParty, pickStyles, skeletonTrip, STYLE_ORDER, STYLES } from '@core/trips'
import type { Party, PlanFlow, TravelMode, Trip, TripStyle } from '@core/types'
import { describeLimits } from '../llm/routePrompt'
import { uid } from '../store/state'
import { MODE_LABEL } from './format'
import { Chips, Field, Segmented, Stepper } from './kit/controls'
import { Sheet } from './kit/Sheet'
import { memberLine } from './Party'

interface Props {
  open: boolean
  /** 沿用谁的同行：一般是最近的那趟 */
  base?: Party
  today: string
  onCreate: (t: Trip) => void
  onClose: () => void
  onExited?: () => void
}

const STEPS = ['谁去', '时间和方式', '玩法', '怎么排'] as const

const FLOWS: { value: PlanFlow; label: string; hint: string }[] = [
  { value: 'places', label: '我知道要去哪些地方', hint: '列出想去的点，工具按同行的情况安排开车、吃饭、休息和游玩的时间' },
  { value: 'region', label: '只知道大概去哪', hint: '填一个地区，工具按同行和玩法推荐去处，你勾选后再排时间' },
]

export function NewTripSheet({ open, base, today, onCreate, onClose, onExited }: Props) {
  const everyone = useMemo(() => [...(base?.members ?? []), ...(base?.pets ?? [])].map(x => x.id), [base])
  const [step, setStep] = useState(0)
  const [keep, setKeep] = useState<string[]>(everyone)
  const [startDate, setStartDate] = useState(() => addDays(today, 7))
  const [days, setDays] = useState(3)
  const [mode, setMode] = useState<TravelMode>(base?.mode ?? 'selfDrive')
  const [origin, setOrigin] = useState('')
  const [styles, setStyles] = useState<TripStyle[]>([])
  const [flow, setFlow] = useState<PlanFlow | null>(null)
  const [region, setRegion] = useState('')
  const [title, setTitle] = useState('')

  // 每次打开都从头来
  useEffect(() => {
    if (!open) return
    setStep(0); setKeep(everyone); setStartDate(addDays(today, 7)); setDays(3); setMode(base?.mode ?? 'selfDrive')
    setOrigin(''); setStyles([]); setFlow(null); setRegion(''); setTitle('')
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const party = carryParty(base, new Set(keep))
  const limits = party.members.length ? describeLimits(deriveConstraints(partyOnDay({ ...party, mode }, 0))) : []
  const last = step === STEPS.length - 1
  const ok = step === 0 ? party.members.length > 0 : step === 1 ? !!startDate : step === 3 ? !!flow && (flow !== 'region' || !!region.trim()) : true

  const next = () => {
    if (!last) { setStep(step + 1); return }
    onCreate(skeletonTrip({ title, startDate, days, mode, party, flow: flow!, styles, region, origin }, uid))
  }

  return (
    <Sheet open={open} onClose={onClose} onExited={onExited} title={`新建行程 · ${STEPS[step]}`}
      done={last ? '建好行程' : '下一步'} doneDisabled={!ok} onDone={next}
      footer={step > 0 ? <button type="button" className="kbtn wide" onClick={() => setStep(step - 1)}>上一步</button> : undefined}>
      <ol className="nt-steps" aria-label={`第 ${step + 1} 步，共 ${STEPS.length} 步`}>
        {STEPS.map((s, i) => <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>{s}</li>)}
      </ol>

      {step === 0 && (
        <>
          <Field label="这次谁去" hint="默认沿用上一趟；加人、改年龄在建好后的「同行」页">
            <Chips label="同行" values={keep} onChange={setKeep}
              options={[...(base?.members ?? []), ...(base?.pets ?? [])].map(x => ({ value: x.id, label: x.name }))} />
          </Field>
          {party.members.length > 0 && (
            <ul className="nt-who">
              {party.members.map(m => <li key={m.id}><b>{m.name}</b>{memberLine(m, days)}</li>)}
              {party.pets.map(p => <li key={p.id}><b>{p.name}</b>宠物</li>)}
            </ul>
          )}
          {limits.length > 0 && (
            <div className="nt-limits">
              <h4>按这群人，每天会守住</h4>
              <ul>{limits.slice(0, 5).map(l => <li key={l}>{l}</li>)}</ul>
            </div>
          )}
          {!party.members.length && <p className="sheet-note">至少要有一个人。</p>}
        </>
      )}

      {step === 1 && (
        <>
          <Field label="出发日期">
            <input className="kinput" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </Field>
          <Field label="玩几天">
            <Stepper label="天数" value={days} min={1} max={30} onChange={setDays} format={v => `${v} 天`} />
          </Field>
          <Field label="怎么去">
            <Segmented label="出行方式" value={mode} onChange={setMode}
              options={(['selfDrive', 'transit', 'tour'] as TravelMode[]).map(m => ({ value: m, label: MODE_LABEL[m] }))} />
          </Field>
          {mode !== 'tour' && (
            <Field label="从哪出发" hint="可以不填；第一天从这里算车程">
              <input className="kinput" value={origin} onChange={e => setOrigin(e.target.value)} placeholder="比如：昆明" />
            </Field>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <Field label="想怎么玩" hint="最多选两个，先选的为主；可以不选">
            <Chips label="玩法" values={styles} onChange={v => setStyles(pickStyles(v))}
              options={STYLE_ORDER.map(s => ({ value: s, label: STYLES[s].label }))} />
          </Field>
          {styles.length > 0 ? (
            <ul className="nt-styles">
              {styles.map((s, i) => (
                <li key={s}><b>{STYLES[s].label}{styles.length > 1 && <em>{i === 0 ? '主' : '辅'}</em>}</b>
                  <span>推荐偏向：{STYLES[s].seek}</span><span>节奏：{STYLES[s].pace}</span></li>
              ))}
            </ul>
          ) : <p className="sheet-note">不选就按同行的情况均衡安排。</p>}
          {styles.length > 0 && <p className="sheet-note">玩法是偏好，同行人的限制优先：比如选了健康有氧，有老人时徒步只挑短线。</p>}
        </>
      )}

      {step === 3 && (
        <>
          <div className="nt-flows" role="radiogroup" aria-label="怎么排">
            {FLOWS.map(f => (
              <button key={f.value} type="button" role="radio" aria-checked={flow === f.value} className={'tile' + (flow === f.value ? ' on' : '')} onClick={() => setFlow(f.value)}>
                <b>{f.label}</b><small>{f.hint}</small>
              </button>
            ))}
          </div>
          {flow === 'region' && (
            <Field label="大概去哪">
              <input className="kinput" value={region} onChange={e => setRegion(e.target.value)} placeholder="比如：滇西北、川西、杭州周边" />
            </Field>
          )}
          {flow && (
            <Field label="行程名字" hint="可以不填">
              <input className="kinput" value={title} onChange={e => setTitle(e.target.value)} placeholder={flow === 'region' && region.trim() ? region.trim() : '新行程'} />
            </Field>
          )}
          {flow && <p className="sheet-note">{flow === 'places' ? '自动排时间' : '推荐去处'}还在做。先建好空行程：每天一个住处，可以先在「行程」页手动加站，做好后在这里接着排。</p>}
        </>
      )}
    </Sheet>
  )
}
