// 「同行」：平时只看每人一张摘要卡；点卡片从底部拉起面板编辑，面板底部实时写出这样改的影响。
// 加人分两步：先选身份，再只问这个身份需要的几项。删除不确认，给 5 秒撤销。
import { useMemo, useRef, useState } from 'react'
import { deriveConstraints, limitRules } from '@core/constraints'
import { whoForAll } from '@core/explain'
import { kidBand, partyOnDay } from '@core/party'
import { fmtHM } from '@core/schedule'
import type { DayRange, Member, Mobility, Party, Pet, Role, Trip } from '@core/types'
import { THEME_LABEL, uid, type Theme } from '../store/state'
import { PROVIDER_LABEL, type Provider } from '../llm/client'
import { fmtShort, MODE_LABEL } from './format'
import { daysLabel, partyImpact } from './impact'
import { PartyImpactView } from './ImpactView'
import { Chips, DayStrip, Field, Segmented, Stepper, Tiles, Toggle } from './kit/controls'
import { Sheet } from './kit/Sheet'
import { useToast } from './kit/Toast'
import { CHANNEL_COLORS } from './scopeMath'
import { StackTable } from './StackTable'
import { LineIcon, PetGlyph } from './symbols'

interface Props {
  trip: Trip
  onTrip: (t: Trip) => void
  demoNow: string | null
  onDemoNow: (v: string | null) => void
  onReset: () => void
  theme: Theme
  onTheme: (t: Theme) => void
  amapKey: string
  onAmapKey: (k: string) => void
  llmProvider: Provider
  llmKeys: { anthropic?: string; deepseek?: string }
  onLlm: (p: Provider, keys: { anthropic?: string; deepseek?: string }) => void
}

const MOB: { value: Mobility; label: string }[] = [
  { value: 'normal', label: '正常' }, { value: 'slow', label: '走得慢' }, { value: 'cane', label: '拄拐' }, { value: 'wheelchair', label: '轮椅' },
]
const MOB_LABEL = Object.fromEntries(MOB.map(m => [m.value, m.label])) as Record<Mobility, string>
const SIZE_LABEL: Record<Pet['size'], string> = { small: '小型', medium: '中型', large: '大型' }
const KIND_LABEL: Record<Pet['kind'], string> = { dog: '狗', cat: '猫', other: '宠物' }
const BASE = deriveConstraints({ mode: 'selfDrive', members: [{ id: 'x', name: 'x', role: 'adult', driver: true }], pets: [] })

type LimitKey = 'activeMin' | 'walkKm' | 'driveBreakMin' | 'endBy' | 'altitudeM'
interface Bring { label: string; key?: LimitKey }

/** 这个人自己带来的限制（和一个普通成人比） */
function brings(m: Member, mode: Party['mode']): Bring[] {
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
function topBrings(trip: Trip, m: Member): { shown: string[]; more: number } {
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

const rangeDays = (r: DayRange) => Array.from({ length: r.to - r.from + 1 }, (_, i) => r.from + i)

export function memberLine(m: Member, total: number): string {
  const days = m.days ? daysLabel(rangeDays(m.days), total) : '全程'
  const mob = m.mobility && m.mobility !== 'normal' ? MOB_LABEL[m.mobility] : ''
  const bits = m.role === 'adult' ? [mob, m.driver ? '会开车' : ''] : [`${m.age ?? '?'} 岁`, m.role === 'elder' ? mob : '']
  return [...bits.filter(Boolean), days].join(' · ')
}

const colorFor = (trip: Trip, id: string) => {
  const i = trip.party.members.findIndex(m => m.id === id)
  return `var(--ch${(i % CHANNEL_COLORS.length) + 1}, var(--ink2))`
}

type Editing = { kind: 'member' | 'pet'; id: string } | { kind: 'add' } | { kind: 'reset' } | null

export function PartyPage({ trip, onTrip, demoNow, onDemoNow, onReset, theme, onTheme, amapKey, onAmapKey, llmProvider, llmKeys, onLlm }: Props) {
  const p = trip.party
  const n = trip.days.length
  const toast = useToast()
  const [editing, setEditing] = useState<Editing>(null)
  // 成员 / 宠物面板收起时先播退场，播完再撤
  const [closing, setClosing] = useState(false)
  const edit = (e: Editing) => { setClosing(false); setEditing(e) }
  const [flashId, setFlashId] = useState<string | null>(null)
  const setParty = (patch: Partial<Party>) => onTrip({ ...trip, party: { ...p, ...patch } })
  const dayLabels = trip.days.map((_, i) => fmtShort(trip.startDate, i))
  const blockers = useMemo(() => {
    const seen = new Map<string, number[]>()
    trip.days.forEach((_, i) => deriveConstraints(partyOnDay(p, i)).blockers.forEach(b => seen.set(b.short, [...(seen.get(b.short) ?? []), i])))
    return [...seen.entries()]
  }, [trip, p])

  const flash = (id: string) => { setFlashId(id); setTimeout(() => setFlashId(null), 1300) }
  const close = () => { if (editing && 'id' in editing) flash(editing.id); setClosing(true) }
  const exited = () => { setEditing(null); setClosing(false) }
  const remove = (kind: 'member' | 'pet', id: string) => {
    const before = trip
    const name = kind === 'member' ? p.members.find(m => m.id === id)?.name : p.pets.find(x => x.id === id)?.name
    setEditing(null)
    onTrip({ ...trip, party: kind === 'member' ? { ...p, members: p.members.filter(m => m.id !== id) } : { ...p, pets: p.pets.filter(x => x.id !== id) } })
    toast(`已移出 ${name}`, () => onTrip(before))
  }

  return (
    <div className="party2">
      <header className="head"><div><h1 className="title">同行</h1><p className="sub">每个人各自带来限制，合在一起取最严的</p></div></header>

      <Segmented label="出行方式" value={p.mode} onChange={mode => setParty({ mode })}
        options={(Object.keys(MODE_LABEL) as Party['mode'][]).map(m => ({ value: m, label: MODE_LABEL[m], icon: <LineIcon name={m === 'transit' ? 'transit' : m} size={18} /> }))} />
      {p.mode === 'selfDrive' && (
        <div className="row-field"><span>车上座位</span><Stepper label="座位" value={p.vehicleSeats ?? 5} min={2} max={9} onChange={v => setParty({ vehicleSeats: v })} format={v => `${v} 座`} /></div>
      )}
      {blockers.length > 0 && (
        <ul className="blocker-list">{blockers.map(([b, days]) => <li key={b}><b>{b}</b><small>{daysLabel(days, n)}</small></li>)}</ul>
      )}

      <div className="section-h"><h2>谁去</h2><small>点一个人修改</small></div>
      <div className="card-list">
        {p.members.map(m => {
          const tags = topBrings(trip, m)
          return (
            <button key={m.id} type="button" className={'card-btn' + (flashId === m.id ? ' flash' : '')} onClick={() => edit({ kind: 'member', id: m.id })}>
              <i className="cdot" style={{ background: colorFor(trip, m.id) }} aria-hidden="true" />
              <span className="cbody">
                <span className="cname">{m.name}</span>
                <span className="csub">{memberLine(m, n)}</span>
                {tags.shown.length > 0 && <span className="ctags">{tags.shown.map(t => <span key={t}>{t}</span>)}{tags.more > 0 && <span className="more-n">+{tags.more}</span>}</span>}
              </span>
              <svg className="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
            </button>
          )
        })}
        {p.pets.map(x => (
          <button key={x.id} type="button" className={'card-btn' + (flashId === x.id ? ' flash' : '')} onClick={() => edit({ kind: 'pet', id: x.id })}>
            <PetGlyph size={14} />
            <span className="cbody">
              <span className="cname">{x.name}</span>
              <span className="csub">{SIZE_LABEL[x.size]}{KIND_LABEL[x.kind]} · {x.days ? daysLabel(rangeDays(x.days), n) : '全程'}</span>
              <span className="ctags"><span>住宿要能带宠物</span>{p.mode === 'selfDrive' && <span>连开 120分</span>}</span>
            </span>
            <svg className="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
          </button>
        ))}
        <button type="button" className="kbtn wide add-person" onClick={() => setEditing({ kind: 'add' })}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>加一位同行
        </button>
      </div>

      <details className="more days-limits">
        <summary>每天的上限</summary>
        <div><StackTable trip={trip} /></div>
      </details>

      <div className="section-h"><h2>这趟旅程</h2></div>
      <div className="settings">
        <Field label="名称"><input className="kinput" value={trip.title} onChange={e => onTrip({ ...trip, title: e.target.value })} /></Field>
        <Field label="出发日期"><input className="kinput" type="date" value={trip.startDate} onChange={e => e.target.value && onTrip({ ...trip, startDate: e.target.value })} /></Field>
        {/* 演示时间只对示例行程生效：自己建的行程永远按真实时间 */}
        {trip.sample && <Toggle on={!!demoNow} onChange={v => onDemoNow(v ? `${trip.startDate}T10:00` : null)} label="演示时间" hint="示例行程用一个假的「现在」看旅途中的样子" />}
        {trip.sample && demoNow && <input className="kinput" type="datetime-local" value={demoNow} onChange={e => onDemoNow(e.target.value || null)} aria-label="演示时间" />}
        <Field label="风格">
          <Chips label="视觉风格" values={[theme]} onChange={v => { const t = v.find(x => x !== theme); if (t) onTheme(t as Theme) }}
            options={(Object.keys(THEME_LABEL) as Theme[]).map(t => ({ value: t, label: THEME_LABEL[t] }))} />
        </Field>
        <Field label="高德 Key" hint="「Web服务」类型；只存在这台设备上">
          <input className="kinput" type="password" autoComplete="off" spellCheck={false} value={amapKey} placeholder="用来搜地方、算车程" onChange={e => onAmapKey(e.target.value.trim())} />
        </Field>
        <p className="sheet-note">到高德开放平台（lbs.amap.com）控制台创建应用，添加 Key 时服务平台选「Web服务」。个人开发者每天有免费额度。</p>
        <Field label="AI 排行程用" hint="「让 AI 重排这一天」会用到">
          <Segmented label="大模型" value={llmProvider} onChange={p => onLlm(p, llmKeys)} options={(['anthropic', 'deepseek'] as Provider[]).map(p => ({ value: p, label: PROVIDER_LABEL[p] }))} />
        </Field>
        <Field label={`${PROVIDER_LABEL[llmProvider]} API Key`} hint="只存在这台设备上">
          <input className="kinput" type="password" autoComplete="off" spellCheck={false} value={llmKeys[llmProvider] ?? ''} placeholder={llmProvider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
            onChange={e => onLlm(llmProvider, { ...llmKeys, [llmProvider]: e.target.value.trim() })} />
        </Field>
        <button type="button" className="kbtn danger wide" onClick={() => setEditing({ kind: 'reset' })}>恢复示例行程</button>
      </div>

      {editing?.kind === 'member' && <MemberSheet trip={trip} id={editing.id} dayLabels={dayLabels} onTrip={onTrip} onClose={close} onRemove={() => remove('member', editing.id)} open={!closing} onExited={exited} />}
      {editing?.kind === 'pet' && <PetSheet trip={trip} id={editing.id} dayLabels={dayLabels} onTrip={onTrip} onClose={close} onRemove={() => remove('pet', editing.id)} open={!closing} onExited={exited} />}
      <AddSheet open={editing?.kind === 'add'} trip={trip} dayLabels={dayLabels} onClose={() => setEditing(null)}
        onAdd={(party, id) => { onTrip({ ...trip, party }); setEditing(null); flash(id) }} />
      <Sheet open={editing?.kind === 'reset'} onClose={() => setEditing(null)} title="恢复示例行程？" done="恢复" onDone={() => { setEditing(null); onReset() }}
        footer={<button type="button" className="kbtn wide" onClick={() => setEditing(null)}>算了</button>}>
        <p className="sheet-note">示例行程会换回最初的样子，你自己建的行程和红黑榜不受影响。</p>
      </Sheet>
    </div>
  )
}

const KID_BANDS = ['infant', 'toddler', 'preschool', 'school', 'teen']
const KID_HINT = ['1 岁以下', '1–3 岁', '3–6 岁', '7–12 岁', '13 岁以上']

/** 成员的各项；新增和修改共用 */
function MemberFields({ m, mode, total, dayLabels, onChange }: { m: Member; mode: Party['mode']; total: number; dayLabels: string[]; onChange: (patch: Partial<Member>) => void }) {
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
      <Field label="哪几天在" hint="按住一天，划到另一天"><DayStrip total={total} value={m.days} labels={dayLabels} onChange={days => onChange({ days })} /></Field>
    </>
  )
}

function MemberSheet({ trip, id, dayLabels, onTrip, onClose, onRemove, open = true, onExited }: { trip: Trip; id: string; dayLabels: string[]; onTrip: (t: Trip) => void; onClose: () => void; onRemove: () => void; open?: boolean; onExited?: () => void }) {
  // 打开时的样子，用来算「这样改之后」
  const before = useRef(trip)
  const m = trip.party.members.find(x => x.id === id)
  if (!m) return null
  const patch = (pt: Partial<Member>) => onTrip({ ...trip, party: { ...trip.party, members: trip.party.members.map(x => (x.id === id ? { ...x, ...pt } : x)) } })
  const roles: { value: Role; label: string }[] = [{ value: 'adult', label: '成人' }, { value: 'elder', label: '老人' }, { value: 'kid', label: '小孩' }]
  return (
    <Sheet open={open} onExited={onExited} onClose={onClose} title={m.name || '同行者'}
      footer={<><PartyImpactView impact={partyImpact(before.current, trip.party)} total={trip.days.length} /><button type="button" className="kbtn danger wide" onClick={onRemove}>移出同行</button></>}>
      <MemberFields m={m} mode={trip.party.mode} total={trip.days.length} dayLabels={dayLabels} onChange={patch} />
      <details className="more">
        <summary>更多</summary>
        <div><Field label="身份"><Segmented label="身份" value={m.role} options={roles} onChange={role => patch({ role, age: role === 'adult' ? undefined : m.age ?? (role === 'kid' ? 5 : 70) })} /></Field></div>
      </details>
    </Sheet>
  )
}

function PetSheet({ trip, id, dayLabels, onTrip, onClose, onRemove, open = true, onExited }: { trip: Trip; id: string; dayLabels: string[]; onTrip: (t: Trip) => void; onClose: () => void; onRemove: () => void; open?: boolean; onExited?: () => void }) {
  const before = useRef(trip)
  const x = trip.party.pets.find(y => y.id === id)
  if (!x) return null
  const patch = (pt: Partial<Pet>) => onTrip({ ...trip, party: { ...trip.party, pets: trip.party.pets.map(y => (y.id === id ? { ...y, ...pt } : y)) } })
  return (
    <Sheet open={open} onExited={onExited} onClose={onClose} title={x.name || '宠物'}
      footer={<><PartyImpactView impact={partyImpact(before.current, trip.party)} total={trip.days.length} /><button type="button" className="kbtn danger wide" onClick={onRemove}>移出同行</button></>}>
      <PetFields x={x} total={trip.days.length} dayLabels={dayLabels} onChange={patch} />
    </Sheet>
  )
}

function PetFields({ x, total, dayLabels, onChange }: { x: Pet; total: number; dayLabels: string[]; onChange: (p: Partial<Pet>) => void }) {
  const kinds: { value: Pet['kind']; label: string }[] = [{ value: 'dog', label: '狗' }, { value: 'cat', label: '猫' }, { value: 'other', label: '其他' }]
  const sizes: { value: Pet['size']; label: string }[] = [{ value: 'small', label: '小型' }, { value: 'medium', label: '中型' }, { value: 'large', label: '大型' }]
  return (
    <>
      <Field label="名字"><input className="kinput" value={x.name} onChange={e => onChange({ name: e.target.value })} /></Field>
      <Field label="种类"><Segmented label="种类" value={x.kind} options={kinds} onChange={kind => onChange({ kind })} /></Field>
      <Field label="体型" hint={x.size === 'large' ? '大型犬基本上不了高铁和飞机客舱' : undefined}><Segmented label="体型" value={x.size} options={sizes} onChange={size => onChange({ size })} /></Field>
      <Field label="哪几天在" hint="按住一天，划到另一天"><DayStrip total={total} value={x.days} labels={dayLabels} onChange={days => onChange({ days })} /></Field>
    </>
  )
}

type Draft = { kind: 'member'; m: Member } | { kind: 'pet'; x: Pet }

function AddSheet({ open, trip, dayLabels, onClose, onAdd }: { open: boolean; trip: Trip; dayLabels: string[]; onClose: () => void; onAdd: (p: Party, id: string) => void }) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const start = (role: Role | 'pet') => {
    if (role === 'pet') setDraft({ kind: 'pet', x: { id: uid('p'), name: '狗狗', kind: 'dog', size: 'small' } })
    else setDraft({ kind: 'member', m: { id: uid('m'), role, name: role === 'kid' ? '小孩' : role === 'elder' ? '老人' : '成人', ...(role === 'kid' ? { age: 5 } : role === 'elder' ? { age: 70, mobility: 'normal' as Mobility } : { driver: trip.party.mode === 'selfDrive' }) } })
  }
  const after: Party | null = draft ? (draft.kind === 'member' ? { ...trip.party, members: [...trip.party.members, draft.m] } : { ...trip.party, pets: [...trip.party.pets, draft.x] }) : null
  // 面板收起的动画结束后再清草稿，避免收起途中闪回第一步
  const reset = () => setTimeout(() => setDraft(null), 400)
  const shut = () => { onClose(); reset() }
  const icon = (d: string) => <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d={d} /></svg>
  return (
    <Sheet open={open} onClose={shut} title={draft ? '加入同行' : '加谁？'} done={draft ? '加入' : '取消'} doneTone={draft ? 'primary' : 'plain'}
      onDone={draft && after ? () => { onAdd(after, draft.kind === 'member' ? draft.m.id : draft.x.id); reset() } : shut}
      footer={after ? <PartyImpactView impact={partyImpact(trip, after)} total={trip.days.length} /> : undefined}>
      {!draft ? (
        <Tiles onPick={start} options={[
          { value: 'adult', label: '成人', hint: '可以设为司机', icon: icon('M14 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM6 25c0-5 3.6-8 8-8s8 3 8 8') },
          { value: 'elder', label: '老人', hint: '按年龄和行动能力收紧', icon: icon('M13 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM7 25c0-5 2.8-8 6-8 2.4 0 4.4 1.6 5.4 4M21 16v9') },
          { value: 'kid', label: '小孩', hint: '按年龄：午睡、推车、儿童餐', icon: icon('M14 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM9 24c0-4 2.2-7 5-7s5 3 5 7') },
          { value: 'pet', label: '宠物', hint: '住宿和交通会受限', icon: icon('M8 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM20 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM11 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM14 14c-4 0-7 5-5 8s8 3 10 0-1-8-5-8Z') },
        ]} />
      ) : draft.kind === 'member' ? (
        <MemberFields m={draft.m} mode={trip.party.mode} total={trip.days.length} dayLabels={dayLabels} onChange={pt => setDraft({ kind: 'member', m: { ...draft.m, ...pt } })} />
      ) : (
        <PetFields x={draft.x} total={trip.days.length} dayLabels={dayLabels} onChange={pt => setDraft({ kind: 'pet', x: { ...draft.x, ...pt } })} />
      )}
    </Sheet>
  )
}
