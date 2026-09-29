// 站点面板：「今天」和「行程」共用。第一层只有最常改的——停留多久、开过来多久、优先级、这里有什么；
// 名称类型、步行海拔、定时开始收在「更多」。底部实时写出当天检查结果的变化。
import { useRef, useState } from 'react'
import { RULES } from '@core/constraints'
import { whoForAll } from '@core/explain'
import { partyOnDay } from '@core/party'
import type { Stop, StopKind, StopStatus, Tag, Trip } from '@core/types'
import { TAG_LABEL, type Issue } from '@core/validate'
import { uid } from '../store/state'
import { dayImpact } from './impact'
import { DayImpactView } from './ImpactView'
import { Chips, Field, Segmented, Stepper, Tiles } from './kit/controls'
import { Sheet } from './kit/Sheet'
import { StopHow } from './Highlights'
import { LineIcon } from './symbols'
import { cityOf } from '@core/footprint'
import { regionName } from '../data/regions'
import { cityShort, dayCities } from './format'
import { PlaceSearch } from './PlaceSearch'
import type { Place } from '../geo/amap'

export const KIND_LABEL: Record<StopKind, string> = { sight: '景点', food: '吃饭', rest: '休息', lodging: '住宿', drive: '开车', transit: '换乘' }
const TAGS_FOR: Record<StopKind, Tag[]> = {
  sight: ['stroller', 'accessible', 'steps', 'restroom', 'petOk', 'shade', 'parking'],
  food: ['kidMenu', 'softFood', 'stroller', 'accessible', 'restroom', 'petOk', 'parking'],
  rest: ['restroom', 'napOk', 'petOk', 'shade', 'parking'],
  lodging: ['elevator', 'petOk', 'accessible', 'parking'],
  drive: [],
  transit: ['accessible', 'petOk'],
}
const dur = (v: number) => (v >= 60 ? `${Math.floor(v / 60)}h${v % 60 ? String(v % 60).padStart(2, '0') : ''}` : `${v} 分`)

export function setStop(trip: Trip, dayIndex: number, id: string, patch: Partial<Stop>): Trip {
  // 换了地方、改了名字或标签：就是自己定的了，不再算工具推荐
  const mine = 'poi' in patch || 'name' in patch || 'tags' in patch
  return { ...trip, days: trip.days.map((d, i) => (i === dayIndex ? { ...d, stops: d.stops.map(s => (s.id === id ? { ...s, ...patch, ...(mine ? { suggested: undefined } : {}) } : s)) } : d)) }
}

export function removeStop(trip: Trip, dayIndex: number, id: string): Trip {
  return { ...trip, days: trip.days.map((d, i) => (i === dayIndex ? { ...d, stops: d.stops.filter(s => s.id !== id) } : d)) }
}

/** 位置：定没定位、在哪个州市；点「搜高德」挑一个地方 */
function LocationRow({ s, city, onPick }: { s: Stop; city?: string; onPick: (p: Place) => void }) {
  const [open, setOpen] = useState(false)
  const where = s.poi?.adcode ? regionName(cityOf(s.poi.adcode)) ?? cityShort(s.poi.adcode) ?? s.poi.adcode : undefined
  return (
    <Field label="位置" hint={s.poi ? (s.poi.amapId ? '来自高德' : '手动') : '定位后能自动算车程、进足迹'}>
      <div className="loc-row">
        <span className={'loc ' + (s.poi ? 'on' : 'off')}>{s.poi ? `已定位${where ? ` · ${where}` : ''}` : '还没定位'}</span>
        <button type="button" className="kbtn" onClick={() => setOpen(true)}>搜高德</button>
      </div>
      <PlaceSearch open={open} keyword={s.name} city={city} onClose={() => setOpen(false)} onPick={p => { onPick(p); setOpen(false) }} />
    </Field>
  )
}

function StopFields({ s, onChange }: { s: Stop; onChange: (p: Partial<Stop>) => void }) {
  const drive = s.kind === 'drive'
  return (
    <>
      <Field label={drive ? '开多久' : s.kind === 'lodging' ? '住下' : '停多久'}>
        {s.kind === 'lodging' ? <p className="sheet-note">住宿是一天的终点，不计时长。</p> :
          <Stepper label="时长" value={s.durationMin} step={drive ? 5 : 15} min={0} max={720} onChange={durationMin => onChange({ durationMin })} format={dur} />}
      </Field>
      {!drive && (
        <Field label="开过来" hint="从上一站开到这里">
          <Stepper label="开过来" value={s.driveMin ?? 0} step={5} min={0} max={600} onChange={v => onChange({ driveMin: v || undefined })} format={v => (v ? dur(v) : '不开车')} />
        </Field>
      )}
      {(s.kind === 'sight' || s.kind === 'food' || s.kind === 'rest') && (
        <Field label="要不要去" hint="落后时先砍「可去」">
          <Segmented label="优先级" value={s.priority ?? 2} onChange={priority => onChange({ priority })}
            options={[{ value: 1 as const, label: '必去' }, { value: 2 as const, label: '想去' }, { value: 3 as const, label: '可去' }]} />
        </Field>
      )}
      {TAGS_FOR[s.kind].length > 0 && (
        <Field label="这里有" hint="点亮确认过的">
          <Chips label="这里具备" values={s.tags ?? []} onChange={tags => onChange({ tags })} options={TAGS_FOR[s.kind].map(t => ({ value: t, label: TAG_LABEL[t] }))} />
        </Field>
      )}
    </>
  )
}

export function StopSheet({ trip, dayIndex, id, onTrip, onClose, onRemove, open = true, onExited }: {
  trip: Trip; dayIndex: number; id: string; onTrip: (t: Trip) => void; onClose: () => void; onRemove: (id: string) => void; open?: boolean; onExited?: () => void
}) {
  const before = useRef(trip)
  const s = trip.days[dayIndex]?.stops.find(x => x.id === id)
  if (!s) return null
  const patch = (p: Partial<Stop>) => onTrip(setStop(trip, dayIndex, id, p))
  const skipped = s.status === 'skipped'
  return (
    <Sheet open={open} onExited={onExited} onClose={onClose} title={<span className="sheet-title-stop"><LineIcon name={s.kind} />{s.name}</span>}
      footer={<>
        <DayImpactView impact={dayImpact(before.current, trip, dayIndex)} />
        <div className="foot-row">
          <button type="button" className="kbtn" onClick={() => patch({ status: skipped ? 'planned' : 'skipped', actualStart: undefined })}>{skipped ? '恢复这一站' : '跳过这一站'}</button>
          <button type="button" className="kbtn danger" onClick={() => onRemove(id)}>删除</button>
        </div>
      </>}>
      {s.kind !== 'drive' && <LocationRow s={s} city={dayCities(trip.days[dayIndex])[0]} onPick={p => patch({ name: p.name, poi: p.poi })} />}
      <StopHow s={s} />
      <StopFields s={s} onChange={patch} />
      <details className="more">
        <summary>更多</summary>
        <div>
          <Field label="名称"><input className="kinput" value={s.name} onChange={e => patch({ name: e.target.value })} /></Field>
          <Field label="类型"><Segmented label="类型" value={s.kind} onChange={kind => patch({ kind })} options={(['sight', 'food', 'rest', 'lodging', 'drive'] as StopKind[]).map(k => ({ value: k, label: KIND_LABEL[k] }))} /></Field>
          {s.kind !== 'drive' && s.kind !== 'lodging' && (
            <Field label="步行"><Stepper label="步行" value={s.walkKm ?? 0} step={0.5} min={0} max={30} onChange={v => patch({ walkKm: v || undefined })} format={v => (v ? `${v} km` : '不走路')} /></Field>
          )}
          {s.kind !== 'drive' && (
            <Field label="海拔" hint="超过老人、幼儿上限会提示">
              <Stepper label="海拔" value={s.altitudeM ?? 0} step={100} min={0} max={6000} onChange={v => patch({ altitudeM: v || undefined })} format={v => (v ? `${v} m` : '不填')} />
            </Field>
          )}
          <Field label="定时开始" hint="门票、预约有固定时间才填">
            <input className="kinput" type="time" value={s.start ?? ''} onChange={e => patch({ start: e.target.value || undefined })} />
          </Field>
          <Field label="状态"><Segmented label="状态" value={s.status ?? 'planned'} onChange={(status: StopStatus) => patch({ status })} options={[{ value: 'planned' as const, label: '计划' }, { value: 'done' as const, label: '已到' }, { value: 'skipped' as const, label: '跳过' }]} /></Field>
        </div>
      </details>
    </Sheet>
  )
}

/** 加一站：先选类型，再给名字和时长 */
export function AddStopSheet({ open, trip, dayIndex, onClose, onAdd }: {
  open: boolean; trip: Trip; dayIndex: number; onClose: () => void; onAdd: (t: Trip, id: string) => void
}) {
  const [draft, setDraft] = useState<Stop | null>(null)
  const reset = () => setTimeout(() => setDraft(null), 400)
  const shut = () => { onClose(); reset() }
  const insert = (st: Stop): Trip => {
    const d = trip.days[dayIndex]
    const li = d.stops.map(x => x.kind).lastIndexOf('lodging')
    const stops = [...d.stops]
    stops.splice(li >= 0 ? li : stops.length, 0, st)
    return { ...trip, days: trip.days.map((x, i) => (i === dayIndex ? { ...x, stops } : x)) }
  }
  const after = draft ? insert(draft) : null
  const pick = (kind: StopKind) => setDraft({ id: uid('s'), kind, name: KIND_LABEL[kind], durationMin: kind === 'drive' ? 60 : kind === 'lodging' ? 0 : kind === 'rest' ? 20 : 60, status: 'planned', priority: 2 })
  const icon = (kind: StopKind) => <LineIcon name={kind} size={28} />
  return (
    <Sheet open={open} onClose={shut} title={draft ? `加一站 · ${KIND_LABEL[draft.kind]}` : '加一站'} done={draft ? '加入' : '取消'} doneTone={draft ? 'primary' : 'plain'}
      onDone={draft && after ? () => { onAdd(after, draft.id); reset() } : shut}
      footer={after ? <DayImpactView impact={dayImpact(trip, after, dayIndex)} /> : undefined}>
      {!draft ? (
        <Tiles onPick={pick} options={([
          ['sight', '景点、公园、古镇'], ['food', '正餐、小吃'], ['rest', '服务区、回酒店歇'], ['drive', '一段高速或公路'], ['lodging', '当晚住处'], ['transit', '高铁、飞机'],
        ] as [StopKind, string][]).map(([k, hint]) => ({ value: k, label: KIND_LABEL[k], hint, icon: icon(k) }))} />
      ) : (
        <>
          <Field label="名称"><input className="kinput" value={draft.name} autoFocus onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
          {draft.kind !== 'drive' && <LocationRow s={draft} city={dayCities(trip.days[dayIndex])[0]} onPick={p => setDraft({ ...draft, name: p.name, poi: p.poi })} />}
          <StopFields s={draft} onChange={p => setDraft({ ...draft, ...p })} />
        </>
      )}
    </Sheet>
  )
}

/** 问题面板：短标签点开，看完整说明、规则依据和是谁 */
export function IssueSheet({ trip, issue, onClose }: { trip: Trip; issue: Issue | null; onClose: () => void }) {
  const dp = issue ? partyOnDay(trip.party, issue.day) : null
  return (
    <Sheet open={!!issue} onClose={onClose} title={issue?.short ?? ''} done="知道了" doneTone="plain">
      {issue && dp && (
        <>
          <p className={'issue-msg lv-' + issue.level}>{issue.message}</p>
          {issue.rules.length > 0 && (
            <ul className="why">
              {issue.rules.map(id => (
                <li key={id}><b>{RULES[id]?.label ?? id}</b>{whoForAll([id], dp).length > 0 && <span className="who-inline">{whoForAll([id], dp).join('、')}</span>}<p>{RULES[id]?.why}</p></li>
              ))}
            </ul>
          )}
          <p className="sheet-note">数字来自常识与公开建议，不是医学结论。</p>
        </>
      )}
    </Sheet>
  )
}
