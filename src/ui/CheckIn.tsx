// 打卡面板（「今天」页点「到了」）：到达时间默认按计划、可以改；吃住玩的站可以顺手记红榜或黑榜，记了就要写一句理由。
import { useEffect, useState } from 'react'
import { partyOnDay } from '@core/party'
import { checkIn, plannedStart } from '@core/progress'
import { partyFit, ratingFromStop, stopRatingKind, type FitTag, type Rating, type Verdict } from '@core/ratings'
import type { Stop, Trip } from '@core/types'
import { uid } from '../store/state'
import { cityShort } from './format'
import { Field } from './kit/controls'
import { Sheet } from './kit/Sheet'

interface Props {
  open: boolean
  trip: Trip
  dayIndex: number
  stop?: Stop
  onClose: () => void
  /** 打好卡的行程，和顺手记的那条红黑榜（没记就是 undefined） */
  onDone: (t: Trip, rating?: Rating) => void
}

const HINT: Record<Verdict, string> = { red: '比如：推车全程能走，孩子玩了两小时', black: '比如：排队一小时，没有母婴室' }

export function CheckInSheet({ open, trip, dayIndex, stop, onClose, onDone }: Props) {
  const plan = stop ? plannedStart(trip, dayIndex, stop.id) : undefined
  const [at, setAt] = useState(plan ?? '')
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [note, setNote] = useState('')
  // 每次打开都从计划时间、没评价开始
  useEffect(() => { if (open) { setAt(plan ?? ''); setVerdict(null); setNote('') } }, [open, stop?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!stop) return null
  const rateable = !!stopRatingKind(stop)
  const needNote = !!verdict && !note.trim()
  const ok = /^([01]\d|2[0-3]):[0-5]\d$/.test(at) && !needNote

  const done = () => {
    if (!ok) return
    const t = checkIn(trip, stop.id, at)
    // 人群标签：这趟当天同行里会受影响的（和红黑榜页新记一笔时一样）
    const fit = ([...partyFit(partyOnDay(trip.party, dayIndex))] as FitTag[]).filter(f => f !== 'drive' && f !== 'kid')
    const r = verdict ? ratingFromStop(stop, verdict, note, { id: uid('r'), at: Date.now(), by: '我', tripId: trip.id, city: cityShort(stop.poi?.adcode), fit }) : null
    onDone(t, r ?? undefined)
  }

  return (
    <Sheet open={open} onClose={onClose} title={`到了 · ${stop.name}`} done="打卡" doneDisabled={!ok} onDone={done}>
      <Field label="几点到的" hint={plan ? `默认按计划 ${plan}，不对就改` : undefined}>
        <input className="kinput arrive-pick num" type="time" value={at} onChange={e => setAt(e.target.value)} aria-label="到达时间" />
      </Field>
      {rateable && (
        <Field label="记进红黑榜" hint="可以不记">
          <div className="ci-verdict" role="radiogroup" aria-label="红榜还是黑榜">
            {(['red', 'black'] as Verdict[]).map(v => (
              <button key={v} type="button" role="radio" aria-checked={verdict === v} className={'rate-key ' + v + (verdict === v ? ' on' : verdict ? ' off' : '')}
                onClick={() => setVerdict(verdict === v ? null : v)}>
                <b>{v === 'red' ? '红' : '黑'}</b>{v === 'red' ? '值得再来' : '踩坑了'}
              </button>
            ))}
          </div>
        </Field>
      )}
      {rateable && verdict && (
        <Field label="一句话理由" hint="必填">
          <input className="kinput" value={note} maxLength={60} autoFocus placeholder={HINT[verdict]} onChange={e => setNote(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') done() }} aria-invalid={needNote} />
          {needNote && <p className="sheet-note ci-need">选了{verdict === 'red' ? '红榜' : '黑榜'}，写一句为什么再打卡；不想记就再点一下取消。</p>}
        </Field>
      )}
    </Sheet>
  )
}
