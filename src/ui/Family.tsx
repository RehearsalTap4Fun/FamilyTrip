// 「同行」页：家庭成员预设。每个人、每只宠物的资料只在这里维护一份，新建行程时勾谁去；现居地也在这。
// 改了一个人，还没结束的行程里有他、资料又不一样的，问一句要不要一起改（去过的不动）。设置在右上角齿轮里。
import { useState } from 'react'
import { applyPerson, staleTrips, type Roster } from '@core/roster'
import type { Member, Pet, PlaceRef, Role, Trip } from '@core/types'
import { PlaceField } from './Endpoints'
import { Field, Segmented } from './kit/controls'
import { Sheet } from './kit/Sheet'
import { useToast } from './kit/Toast'
import { AddSheet, brings, KIND_LABEL, MemberFields, memberLine, PetFields, SIZE_LABEL } from './People'
import { PetGlyph } from './symbols'

interface Props {
  roster: Roster
  onRoster: (r: Roster) => void
  trips: Trip[]
  now: Date
  /** 把改过的人同步进这几趟 */
  onTrips: (trips: Trip[]) => void
  home?: PlaceRef
  onHome: (h?: PlaceRef) => void
  onSettings: () => void
}

type Editing = { kind: 'member' | 'pet'; id: string } | { kind: 'add' } | null

export function FamilyPage({ roster, onRoster, trips, now, onTrips, home, onHome, onSettings }: Props) {
  const toast = useToast()
  const [editing, setEditing] = useState<Editing>(null)
  // 刚改过、还有行程没跟上的人
  const [pending, setPending] = useState<string | null>(null)
  const person = pending ? roster.members.find(m => m.id === pending) ?? roster.pets.find(p => p.id === pending) : undefined
  const stale = person ? staleTrips(trips, person, now) : []

  const close = () => {
    if (editing && 'id' in editing) setPending(editing.id)
    setEditing(null)
  }
  const remove = (kind: 'member' | 'pet', id: string) => {
    const before = roster
    const name = kind === 'member' ? roster.members.find(m => m.id === id)?.name : roster.pets.find(x => x.id === id)?.name
    setEditing(null)
    onRoster(kind === 'member' ? { ...roster, members: roster.members.filter(m => m.id !== id) } : { ...roster, pets: roster.pets.filter(x => x.id !== id) })
    toast(`已从家庭成员里删掉 ${name}（已有的行程不受影响）`, () => onRoster(before))
  }
  const sync = () => {
    if (!person) return
    const fixed = stale.map(t => applyPerson(t, person))
    onTrips(fixed)
    toast(`${stale.length} 趟行程里的${person.name}已更新`, () => onTrips(stale))
    setPending(null)
  }

  return (
    <div className="party2 family">
      <header className="head">
        <div><h1 className="title">同行</h1><p className="sub">家里常一起出门的人，新建行程时勾谁去</p></div>
        <button type="button" className="gear" aria-label="设置" onClick={onSettings}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" /></svg>
        </button>
      </header>

      {person && stale.length > 0 && (
        <div className="sync-ask" role="status">
          <p>{person.name}的资料改了。还没结束的 {stale.length} 趟（{stale.map(t => t.title).join('、')}）也用新的？</p>
          <div className="foot-row">
            <button type="button" className="kbtn" onClick={() => setPending(null)}>不用</button>
            <button type="button" className="kbtn primary" onClick={sync}>一起改</button>
          </div>
        </div>
      )}

      <div className="section-h"><h2>家庭成员</h2><small>点一个人修改</small></div>
      <div className="card-list">
        {roster.members.map(m => {
          const tags = brings(m, 'selfDrive').map(b => b.label)
          return (
            <button key={m.id} type="button" className="card-btn" onClick={() => setEditing({ kind: 'member', id: m.id })}>
              <span className="cbody">
                <span className="cname">{m.name}</span>
                <span className="csub">{memberLine(m, 0) || '成人'}</span>
                {tags.length > 0 && <span className="ctags">{tags.slice(0, 3).map(t => <span key={t}>{t}</span>)}{tags.length > 3 && <span className="more-n">+{tags.length - 3}</span>}</span>}
              </span>
              <svg className="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
            </button>
          )
        })}
        {roster.pets.map(x => (
          <button key={x.id} type="button" className="card-btn" onClick={() => setEditing({ kind: 'pet', id: x.id })}>
            <PetGlyph size={14} />
            <span className="cbody">
              <span className="cname">{x.name}</span>
              <span className="csub">{SIZE_LABEL[x.size]}{KIND_LABEL[x.kind]}</span>
              <span className="ctags"><span>住宿要能带宠物</span></span>
            </span>
            <svg className="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
          </button>
        ))}
        {!roster.members.length && !roster.pets.length && <p className="sheet-note">还没有家庭成员。加上常一起出门的人，以后每趟勾一下就行。</p>}
        <button type="button" className="kbtn wide add-person" onClick={() => setEditing({ kind: 'add' })}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>加一位家庭成员
        </button>
      </div>
      <p className="sheet-note">每趟行程存一份勾选时的资料，这趟谁去、哪几天在，到行程页的「这趟」里改。</p>

      <div className="settings">
        <PlaceField label="现居地" hint="新行程默认从这出发、回到这" value={home} empty="还没设" onChange={onHome} />
      </div>

      {editing?.kind === 'member' && <RosterMemberSheet m={roster.members.find(m => m.id === editing.id)!} onChange={m => onRoster({ ...roster, members: roster.members.map(x => (x.id === m.id ? m : x)) })} onClose={close} onRemove={() => remove('member', editing.id)} />}
      {editing?.kind === 'pet' && <RosterPetSheet x={roster.pets.find(p => p.id === editing.id)!} onChange={x => onRoster({ ...roster, pets: roster.pets.map(y => (y.id === x.id ? x : y)) })} onClose={close} onRemove={() => remove('pet', editing.id)} />}
      <AddSheet open={editing?.kind === 'add'} onClose={() => setEditing(null)}
        onAdd={a => { onRoster(a.kind === 'member' ? { ...roster, members: [...roster.members, a.m] } : { ...roster, pets: [...roster.pets, a.x] }); setEditing(null) }} />
    </div>
  )
}

const ROLES: { value: Role; label: string }[] = [{ value: 'adult', label: '成人' }, { value: 'elder', label: '老人' }, { value: 'kid', label: '小孩' }]

function RosterMemberSheet({ m, onChange, onClose, onRemove }: { m?: Member; onChange: (m: Member) => void; onClose: () => void; onRemove: () => void }) {
  if (!m) return null
  const patch = (pt: Partial<Member>) => onChange({ ...m, ...pt })
  return (
    <Sheet open onClose={onClose} title={m.name || '家庭成员'} footer={<button type="button" className="kbtn danger wide" onClick={onRemove}>从家庭成员里删掉</button>}>
      <MemberFields m={m} mode="selfDrive" total={0} dayLabels={[]} onChange={patch} />
      <details className="more">
        <summary>更多</summary>
        <div><Field label="身份"><Segmented label="身份" value={m.role} options={ROLES} onChange={role => patch({ role, age: role === 'adult' ? undefined : m.age ?? (role === 'kid' ? 5 : 70) })} /></Field></div>
      </details>
    </Sheet>
  )
}

function RosterPetSheet({ x, onChange, onClose, onRemove }: { x?: Pet; onChange: (x: Pet) => void; onClose: () => void; onRemove: () => void }) {
  if (!x) return null
  return (
    <Sheet open onClose={onClose} title={x.name || '宠物'} footer={<button type="button" className="kbtn danger wide" onClick={onRemove}>从家庭成员里删掉</button>}>
      <PetFields x={x} total={0} dayLabels={[]} onChange={pt => onChange({ ...x, ...pt })} />
    </Sheet>
  )
}
