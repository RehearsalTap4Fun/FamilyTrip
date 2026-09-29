// 「这趟」：这一趟怎么去、谁去（从家庭成员里勾，只属于这趟的「哪几天在」也在这改）、名称日期、分享。
// 行程页上一张摘要卡片点开；「排这趟」顶上那行确认也打开它。改的只是这一趟，家庭成员的资料在「同行」页改。
import { useMemo, useState, type ReactNode } from 'react'
import { deriveConstraints } from '@core/constraints'
import { partyOnDay } from '@core/party'
import type { Roster } from '@core/roster'
import { resizeDays } from '@core/trips'
import { uid } from '../store/state'
import type { Member, Party, Pet, Trip } from '@core/types'
import { endsLine } from './Endpoints'
import { fmtShort, MODE_LABEL } from './format'
import { daysLabel } from './impact'
import { Field, Segmented, Stepper, Toggle } from './kit/controls'
import { Sheet } from './kit/Sheet'
import { useToast } from './kit/Toast'
import { AddSheet, colorFor, KIND_LABEL, MemberSheet, memberLine, PetSheet, rangeDays, SIZE_LABEL, topBrings } from './People'
import { StackTable } from './StackTable'
import { LineIcon, PetGlyph } from './symbols'

/** 一句话：自驾 · 5 人（我、外婆、朵朵…）+ 狗 */
export function partyLine(p: Party): string {
  const names = [...p.members.map(m => m.name), ...p.pets.map(x => x.name)]
  return `${MODE_LABEL[p.mode]} · ${p.members.length} 人${p.pets.length ? ` + ${p.pets.length} 只宠物` : ''}（${names.slice(0, 5).join('、')}${names.length > 5 ? '…' : ''}）`
}

/** 行程页上的摘要卡片：出行方式、几个人、几天、哪天出发各一个胶囊，名字小字列在下面；点开改（起点终点不外显，在面板里） */
export function TripSetupCard({ trip, onOpen }: { trip: Trip; onOpen: () => void }) {
  const p = trip.party
  const ends = endsLine(trip)
  const names = [...p.members.map(m => m.name), ...p.pets.map(x => x.name)]
  return (
    <button type="button" className="card-btn trip-setup" onClick={onOpen} aria-label={`这趟：${partyLine(p)}，${trip.days.length} 天，${fmtShort(trip.startDate, 0)} 出发${ends ? `，${ends}` : ''}。点开修改`}>
      <span className="cbody">
        <span className="ts-pills">
          <span className="ts-pill mode"><LineIcon name={p.mode === 'transit' ? 'transit' : p.mode} size={15} />{MODE_LABEL[p.mode]}</span>
          <span className="ts-pill">{p.members.length} 人{p.pets.length ? ` + ${p.pets.length} 宠物` : ''}</span>
          <span className="ts-pill">{trip.days.length} 天</span>
          <span className="ts-pill">{fmtShort(trip.startDate, 0)} 出发</span>
        </span>
        <span className="csub ts-names">{names.join('、')}</span>
      </span>
      <span className="add">改</span>
    </button>
  )
}

type Editing = { kind: 'member' | 'pet'; id: string } | { kind: 'add' } | null

interface Props {
  open: boolean
  trip: Trip
  onTrip: (t: Trip) => void
  roster: Roster
  onRoster: (r: Roster) => void
  onClose: () => void
  /** 分享给同行好友的卡片 */
  share?: ReactNode
  /** 示例行程的演示时间 */
  demoNow: string | null
  onDemoNow: (v: string | null) => void
}

export function TripSetupSheet({ open, trip, onTrip, roster, onRoster, onClose, share, demoNow, onDemoNow }: Props) {
  const p = trip.party
  const n = trip.days.length
  const toast = useToast()
  const [editing, setEditing] = useState<Editing>(null)
  const [closing, setClosing] = useState(false)
  const edit = (e: Editing) => { setClosing(false); setEditing(e) }
  const dayLabels = trip.days.map((_, i) => fmtShort(trip.startDate, i))
  const setParty = (patch: Partial<Party>) => onTrip({ ...trip, party: { ...p, ...patch } })
  const blockers = useMemo(() => {
    const seen = new Map<string, number[]>()
    trip.days.forEach((_, i) => deriveConstraints(partyOnDay(p, i)).blockers.forEach(b => seen.set(b.short, [...(seen.get(b.short) ?? []), i])))
    return [...seen.entries()]
  }, [trip, p])
  // 家庭成员里还没在这趟的
  const inTrip = new Set([...p.members, ...p.pets].map(x => x.id))
  const offMembers = roster.members.filter(m => !inTrip.has(m.id))
  const offPets = roster.pets.filter(x => !inTrip.has(x.id))
  const join = (x: Member | Pet, kind: 'member' | 'pet') => {
    const { days: _d, ...rest } = x
    setParty(kind === 'member' ? { members: [...p.members, rest as Member] } : { pets: [...p.pets, rest as Pet] })
  }
  const remove = (kind: 'member' | 'pet', id: string) => {
    const before = trip
    const name = kind === 'member' ? p.members.find(m => m.id === id)?.name : p.pets.find(x => x.id === id)?.name
    setEditing(null)
    onTrip({ ...trip, party: kind === 'member' ? { ...p, members: p.members.filter(m => m.id !== id) } : { ...p, pets: p.pets.filter(x => x.id !== id) } })
    toast(`${name}不去这趟了`, () => onTrip(before))
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} title="这趟">
        <div className="settings">
          <Field label="名称"><input className="kinput" value={trip.title} onChange={e => onTrip({ ...trip, title: e.target.value })} /></Field>
          <Field label="出发日期"><input className="kinput" type="date" value={trip.startDate} onChange={e => e.target.value && onTrip({ ...trip, startDate: e.target.value })} /></Field>
          <Field label="玩几天" hint={`${fmtShort(trip.startDate, 0)}–${fmtShort(trip.startDate, n - 1)}`}>
            <Stepper label="天数" value={n} min={1} max={30} format={v => `${v} 天`} onChange={v => {
              // 加的补在后面；减的从最后往前删，删到排了东西的天就提示，能撤销
              const before = trip
              const r = resizeDays(trip, v, uid)
              onTrip(r.trip)
              if (r.removedStops) toast(`删掉了最后 ${n - v} 天，里面的 ${r.removedStops} 站也一起删了`, () => onTrip(before))
            }} />
          </Field>
          {/* 演示时间只对示例行程生效：自己建的行程永远按真实时间 */}
          {trip.sample && <Toggle on={!!demoNow} onChange={v => onDemoNow(v ? `${trip.startDate}T10:00` : null)} label="演示时间" hint="示例行程用一个假的「现在」看旅途中的样子" />}
          {trip.sample && demoNow && <input className="kinput" type="datetime-local" value={demoNow} onChange={e => onDemoNow(e.target.value || null)} aria-label="演示时间" />}
        </div>

        <div className="section-h"><h2>怎么去</h2></div>
        <Segmented label="出行方式" value={p.mode} onChange={mode => setParty({ mode })}
          options={(Object.keys(MODE_LABEL) as Party['mode'][]).map(m => ({ value: m, label: MODE_LABEL[m], icon: <LineIcon name={m === 'transit' ? 'transit' : m} size={18} /> }))} />
        {p.mode === 'selfDrive' && (
          <div className="row-field"><span>车上座位</span><Stepper label="座位" value={p.vehicleSeats ?? 5} min={2} max={9} onChange={v => setParty({ vehicleSeats: v })} format={v => `${v} 座`} /></div>
        )}
        {blockers.length > 0 && <ul className="blocker-list">{blockers.map(([b, days]) => <li key={b}><b>{b}</b><small>{daysLabel(days, n)}</small></li>)}</ul>}

        <div className="section-h"><h2>谁去</h2><small>点一个人改这趟的安排</small></div>
        <div className="card-list">
          {p.members.map(m => {
            const tags = topBrings(trip, m)
            return (
              <button key={m.id} type="button" className="card-btn" onClick={() => edit({ kind: 'member', id: m.id })}>
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
            <button key={x.id} type="button" className="card-btn" onClick={() => edit({ kind: 'pet', id: x.id })}>
              <PetGlyph size={14} />
              <span className="cbody">
                <span className="cname">{x.name}</span>
                <span className="csub">{SIZE_LABEL[x.size]}{KIND_LABEL[x.kind]} · {x.days ? daysLabel(rangeDays(x.days), n) : '全程'}</span>
              </span>
              <svg className="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
            </button>
          ))}
        </div>
        {(offMembers.length > 0 || offPets.length > 0) && (
          <div className="roster-add">
            <small>家庭成员里还有</small>
            <div>
              {offMembers.map(m => <button key={m.id} type="button" className="chip" onClick={() => join(m, 'member')}>＋ {m.name}</button>)}
              {offPets.map(x => <button key={x.id} type="button" className="chip" onClick={() => join(x, 'pet')}>＋ {x.name}</button>)}
            </div>
          </div>
        )}
        <button type="button" className="kbtn wide add-person" onClick={() => edit({ kind: 'add' })}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>加一位新的同行
        </button>
        <p className="sheet-note">这里改的只是这一趟；家庭成员的资料在「同行」页改。</p>

        <details className="more days-limits">
          <summary>每天的上限</summary>
          <div><StackTable trip={trip} /></div>
        </details>
        {share}
      </Sheet>

      {editing?.kind === 'member' && <MemberSheet trip={trip} id={editing.id} dayLabels={dayLabels} onTrip={onTrip} onClose={() => setClosing(true)} onRemove={() => remove('member', editing.id)} open={!closing} onExited={() => { setEditing(null); setClosing(false) }} />}
      {editing?.kind === 'pet' && <PetSheet trip={trip} id={editing.id} dayLabels={dayLabels} onTrip={onTrip} onClose={() => setClosing(true)} onRemove={() => remove('pet', editing.id)} open={!closing} onExited={() => { setEditing(null); setClosing(false) }} />}
      <AddSheet open={editing?.kind === 'add'} trip={trip} onClose={() => setEditing(null)}
        onAdd={a => {
          // 新加的人也记进家庭成员，下次新建行程能直接勾
          if (a.kind === 'member') { setParty({ members: [...p.members, a.m] }); const { days: _d, ...m } = a.m; onRoster({ ...roster, members: [...roster.members, m] }) }
          else { setParty({ pets: [...p.pets, a.x] }); const { days: _d, ...x } = a.x; onRoster({ ...roster, pets: [...roster.pets, x] }) }
          setEditing(null)
        }} />
    </>
  )
}
