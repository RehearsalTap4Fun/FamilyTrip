// 同行的人：摘要卡片上的字、编辑面板（家庭成员预设和单趟行程共用）、「加谁」面板。
// 加人分两步：先选身份，再只问这个身份需要的几项。行程里的面板多一项「哪几天在」，底部实时写出这样改对这趟的影响。
import { useRef, useState } from 'react'
import { deriveConstraints, limitRules } from '@core/constraints'
import { whoForAll } from '@core/explain'
import { kidBand, partyOnDay } from '@core/party'
import { fmtHM } from '@core/schedule'
import type { DayRange, Member, Mobility, Party, Pet, Role, Trip } from '@core/types'
import { uid } from '../store/state'
import { fmtShort } from './format'
import { daysLabel, partyImpact } from './impact'
import { PartyImpactView } from './ImpactView'
import { DayStrip, Field, Segmented, Stepper, Tiles, Toggle } from './kit/controls'
import { Sheet } from './kit/Sheet'
import { CHANNEL_COLORS } from './scopeMath'

export const MOB: { value: Mobility; label: string }[] = [
  { value: 'normal', label: '正常' }, { value: 'slow', label: '走得慢' }, { value: 'cane', label: '拄拐' }, { value: 'wheelchair', label: '轮椅' },
]
export const MOB_LABEL = Object.fromEntries(MOB.map(m => [m.value, m.label])) as Record<Mobility, string>
export const SIZE_LABEL: Record<Pet['size'], string> = { small: '小型', medium: '中型', large: '大型' }
export const KIND_LABEL: Record<Pet['kind'], string> = { dog: '狗', cat: '猫', other: '宠物' }
const BASE = deriveConstraints({ mode: 'selfDrive', members: [{ id: 'x', name: 'x', role: 'adult', driver: true }], pets: [] })

type LimitKey = 'activeMin' | 'walkKm' | 'driveBreakMin' | 'endBy' | 'altitudeM'
interface Bring { label: string; key?: LimitKey }

/** 这个人自己带来的限制（和一个普通成人比） */
export function brings(m: Member, mode: Party['mode']): Bring[] {
  const c = deriveConstraints({ mode, members: [m], pets: [] })
  const out: Bring[] = []
  if (c.activeMin.value < BASE.activeMin.value) out.push({ label: `游玩 ${c.activeMin.value / 60}h`, key: 'activeMin' })
  if (c.walkKm.value < BASE.walkKm.value) out.push({ label: `步行 ${c.walkKm.value}km`, key: 'walkKm' })
  if (mode === 'selfDrive' && c.driveBreakMin.value < BASE.driveBreakMin.value) out.push({ label: `连开 ${c.driveBreakMin.value}分`, key: 'driveBreakMin' })
  if (c.endBy.value < BASE.endBy.value) out.push({ label: `${fmtHM(c.endBy.value)} 前回`, key: 'endBy' })
  if (Number.isFinite(c.altitudeM.value)) out.push({ label: `海拔 ${c.altitudeM.value}m`, key: 'altitudeM' })
  if (c.nap) out.push({ label: '要午睡' })
  if (c.needs.has('stroller')) out.push({ label: '推车' })
  if (c.lodgingNeeds.has('elevator')) out.push({ label: '住宿要电梯' })
  return out
}

/** 卡片上只放两个：优先放「全队这一项正是由他定的」，其余折成 +N */
export function topBrings(trip: Trip, m: Member): { shown: string[]; more: number } {
  const all = brings(m, trip.party.mode)
  const binding = new Set<LimitKey>()
  trip.days.forEach((_, i) => {
    const dp = partyOnDay(trip.party, i)
    if (!dp.members.some(x => x.id === m.id)) return
    const c = deriveConstraints(dp)
    for (const k of ['activeMin', 'walkKm', 'driveBreakMin', 'endBy', 'altitudeM'] as LimitKey[]) {
      if (c[k].by !== 'base' && whoForAll(limitRules(c[k]), dp).includes(m.name)) binding.add(k)
    }
  })
  const sorted = [...all].sort((a, b) => Number(!!b.key && binding.has(b.key)) - Number(!!a.key && binding.has(a.key)))
  return { shown: sorted.slice(0, 2).map(x => x.label), more: Math.max(0, sorted.length - 2) }
}

export const rangeDays = (r: DayRange) => Array.from({ length: r.to - r.from + 1 }, (_, i) => r.from + i)

/** 卡片上的一行：身份、行动能力、会不会开车，行程里再加「哪几天在」（total 为 0 时不加，家庭成员里用） */
export function memberLine(m: Member, total: number): string {
  const days = total <= 0 ? '' : m.days ? daysLabel(rangeDays(m.days), total) : '全程'
  const mob = m.mobility && m.mobility !== 'normal' ? MOB_LABEL[m.mobility] : ''
  const bits = m.role === 'adult' ? [mob, m.driver ? '会开车' : ''] : [`${m.age ?? '?'} 岁`, m.role === 'elder' ? mob : '']
  return [...bits, days].filter(Boolean).join(' · ')
}

export const colorFor = (trip: Trip, id: string) => {
  const i = trip.party.members.findIndex(m => m.id === id)
  return `var(--ch${(i % CHANNEL_COLORS.length) + 1}, var(--ink2))`
}

const KID_BANDS = ['infant', 'toddler', 'preschool', 'school', 'teen']
const KID_HINT = ['1 岁以下', '1–3 岁', '3–6 岁', '7–12 岁', '13 岁以上']

/** 成员的各项；新增和修改共用 */
export function MemberFields({ m, mode, total, dayLabels, onChange }: { m: Member; mode: Party['mode']; total: number; dayLabels: string[]; onChange: (patch: Partial<Member>) => void }) {
  return (
    <>
      <Field label="称呼"><input className="kinput" value={m.name} onChange={e => onChange({ name: e.target.value })} /></Field>
      {m.role !== 'adult' && (
        <Field label="年龄" hint={m.role === 'kid' ? KID_HINT[KID_BANDS.indexOf(kidBand(m.age))] : (m.age ?? 0) >= 75 ? '75 岁以上会再收紧一档' : undefined}>
          <Stepper label="年龄" value={m.age ?? (m.role === 'kid' ? 5 : 70)} min={m.role === 'kid' ? 0 : 55} max={m.role === 'kid' ? 17 : 105} onChange={age => onChange({ age })} format={v => `${v} 岁`} />
        </Field>
      )}
      {m.role !== 'kid' && <Field label="行动能力"><Segmented label="行动能力" value={m.mobility ?? 'normal'} options={MOB} onChange={mobility => onChange({ mobility })} /></Field>}
      {m.role !== 'kid' && mode === 'selfDrive' && <Toggle label="会开车" hint="两位以上司机轮换，每天驾驶可到 8 小时" on={!!m.driver} onChange={driver => onChange({ driver })} />}
      {total > 0 && <Field label="哪几天在" hint="按住一天，划到另一天"><DayStrip total={total} value={m.days} labels={dayLabels} onChange={days => onChange({ days })} /></Field>}
    </>
  )
}

export function MemberSheet({ trip, id, dayLabels, onTrip, onClose, onRemove, open = true, onExited }: { trip: Trip; id: string; dayLabels: string[]; onTrip: (t: Trip) => void; onClose: () => void; onRemove: () => void; open?: boolean; onExited?: () => void }) {
  // 打开时的样子，用来算「这样改之后」
  const before = useRef(trip)
  const m = trip.party.members.find(x => x.id === id)
  if (!m) return null
  const patch = (pt: Partial<Member>) => onTrip({ ...trip, party: { ...trip.party, members: trip.party.members.map(x => (x.id === id ? { ...x, ...pt } : x)) } })
  const roles: { value: Role; label: string }[] = [{ value: 'adult', label: '成人' }, { value: 'elder', label: '老人' }, { value: 'kid', label: '小孩' }]
  return (
    <Sheet open={open} onExited={onExited} onClose={onClose} title={m.name || '同行者'}
      footer={<><PartyImpactView impact={partyImpact(before.current, trip.party)} total={trip.days.length} /><button type="button" className="kbtn danger wide" onClick={onRemove}>不去这趟了</button></>}>
      <MemberFields m={m} mode={trip.party.mode} total={trip.days.length} dayLabels={dayLabels} onChange={patch} />
      <details className="more">
        <summary>更多</summary>
        <div><Field label="身份"><Segmented label="身份" value={m.role} options={roles} onChange={role => patch({ role, age: role === 'adult' ? undefined : m.age ?? (role === 'kid' ? 5 : 70) })} /></Field></div>
      </details>
    </Sheet>
  )
}

export function PetSheet({ trip, id, dayLabels, onTrip, onClose, onRemove, open = true, onExited }: { trip: Trip; id: string; dayLabels: string[]; onTrip: (t: Trip) => void; onClose: () => void; onRemove: () => void; open?: boolean; onExited?: () => void }) {
  const before = useRef(trip)
  const x = trip.party.pets.find(y => y.id === id)
  if (!x) return null
  const patch = (pt: Partial<Pet>) => onTrip({ ...trip, party: { ...trip.party, pets: trip.party.pets.map(y => (y.id === id ? { ...y, ...pt } : y)) } })
  return (
    <Sheet open={open} onExited={onExited} onClose={onClose} title={x.name || '宠物'}
      footer={<><PartyImpactView impact={partyImpact(before.current, trip.party)} total={trip.days.length} /><button type="button" className="kbtn danger wide" onClick={onRemove}>不去这趟了</button></>}>
      <PetFields x={x} total={trip.days.length} dayLabels={dayLabels} onChange={patch} />
    </Sheet>
  )
}

export function PetFields({ x, total, dayLabels, onChange }: { x: Pet; total: number; dayLabels: string[]; onChange: (p: Partial<Pet>) => void }) {
  const kinds: { value: Pet['kind']; label: string }[] = [{ value: 'dog', label: '狗' }, { value: 'cat', label: '猫' }, { value: 'other', label: '其他' }]
  const sizes: { value: Pet['size']; label: string }[] = [{ value: 'small', label: '小型' }, { value: 'medium', label: '中型' }, { value: 'large', label: '大型' }]
  return (
    <>
      <Field label="名字"><input className="kinput" value={x.name} onChange={e => onChange({ name: e.target.value })} /></Field>
      <Field label="种类"><Segmented label="种类" value={x.kind} options={kinds} onChange={kind => onChange({ kind })} /></Field>
      <Field label="体型" hint={x.size === 'large' ? '大型犬基本上不了高铁和飞机客舱' : undefined}><Segmented label="体型" value={x.size} options={sizes} onChange={size => onChange({ size })} /></Field>
      {total > 0 && <Field label="哪几天在" hint="按住一天，划到另一天"><DayStrip total={total} value={x.days} labels={dayLabels} onChange={days => onChange({ days })} /></Field>}
    </>
  )
}

export type Added = { kind: 'member'; m: Member } | { kind: 'pet'; x: Pet }

/**
 * 加一位：先选身份，再填这个身份要的几项。
 * 在行程里加（给了 trip）：多一项「哪几天在」，底部写出对这趟的影响；在家庭成员里加：只填资料
 */
export function AddSheet({ open, trip, mode = 'selfDrive', onClose, onAdd }: { open: boolean; trip?: Trip; mode?: Party['mode']; onClose: () => void; onAdd: (a: Added) => void }) {
  const [draft, setDraft] = useState<Added | null>(null)
  const md = trip?.party.mode ?? mode
  const total = trip?.days.length ?? 0
  const dayLabels = trip ? trip.days.map((_, i) => fmtShort(trip.startDate, i)) : []
  const start = (role: Role | 'pet') => {
    if (role === 'pet') setDraft({ kind: 'pet', x: { id: uid('p'), name: '狗狗', kind: 'dog', size: 'small' } })
    else setDraft({ kind: 'member', m: { id: uid('m'), role, name: role === 'kid' ? '小孩' : role === 'elder' ? '老人' : '成人', ...(role === 'kid' ? { age: 5 } : role === 'elder' ? { age: 70, mobility: 'normal' as Mobility } : { driver: md === 'selfDrive' }) } })
  }
  const after: Party | null = draft && trip ? (draft.kind === 'member' ? { ...trip.party, members: [...trip.party.members, draft.m] } : { ...trip.party, pets: [...trip.party.pets, draft.x] }) : null
  // 面板收起的动画结束后再清草稿，避免收起途中闪回第一步
  const reset = () => setTimeout(() => setDraft(null), 400)
  const shut = () => { onClose(); reset() }
  const icon = (d: string) => <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d={d} /></svg>
  return (
    <Sheet open={open} onClose={shut} title={draft ? (trip ? '加入同行' : '加一位家庭成员') : '加谁？'} done={draft ? '加入' : '取消'} doneTone={draft ? 'primary' : 'plain'}
      onDone={draft ? () => { onAdd(draft); reset() } : shut}
      footer={after && trip ? <PartyImpactView impact={partyImpact(trip, after)} total={trip.days.length} /> : undefined}>
      {!draft ? (
        <Tiles onPick={start} options={[
          { value: 'adult', label: '成人', hint: '可以设为司机', icon: icon('M14 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM6 25c0-5 3.6-8 8-8s8 3 8 8') },
          { value: 'elder', label: '老人', hint: '按年龄和行动能力收紧', icon: icon('M13 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM7 25c0-5 2.8-8 6-8 2.4 0 4.4 1.6 5.4 4M21 16v9') },
          { value: 'kid', label: '小孩', hint: '按年龄：午睡、推车、儿童餐', icon: icon('M14 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM9 24c0-4 2.2-7 5-7s5 3 5 7') },
          { value: 'pet', label: '宠物', hint: '住宿和交通会受限', icon: icon('M8 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM20 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM11 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM14 14c-4 0-7 5-5 8s8 3 10 0-1-8-5-8Z') },
        ]} />
      ) : draft.kind === 'member' ? (
        <MemberFields m={draft.m} mode={md} total={total} dayLabels={dayLabels} onChange={pt => setDraft({ kind: 'member', m: { ...draft.m, ...pt } })} />
      ) : (
        <PetFields x={draft.x} total={total} dayLabels={dayLabels} onChange={pt => setDraft({ kind: 'pet', x: { ...draft.x, ...pt } })} />
      )}
    </Sheet>
  )
}
