// 「必带」：行程页是这趟的总清单；今天页只提醒这一天出门还用得上、还没勾上的。
import { useState } from 'react'
import { addPackItem, dayNote, guessPackKind, hidePack, packForDay, packItems, setPacked } from '@core/pack'
import type { PackItem, Trip } from '@core/types'
import { useToast } from './kit/Toast'
import { uid } from '../store/state'

function Check({ on, name, onClick }: { on: boolean; name: string; onClick: () => void }) {
  return (
    <button type="button" className={'pack-check' + (on ? ' on' : '')} aria-pressed={on} aria-label={on ? `取消勾选${name}` : `勾选${name}，表示已经带上`} onClick={onClick}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.2 L6.6 11.3 L12.6 4.6" /></svg>
    </button>
  )
}

/** 名字已经说明的原因不再重复；长原因只留逗号前的半句 */
function lineWhy(item: PackItem, brief: string): string {
  if (item.why === '自己加的') return ''
  const why = item.why.split('，')[0]
  if (!why || why === brief || why.startsWith(brief)) return ''
  return why
}

function Row({ item, total, trip, onTrip, onDrop }: { item: PackItem; total: number; trip: Trip; onTrip: (t: Trip) => void; onDrop: (item: PackItem) => void }) {
  const brief = briefOf(item)
  const when = dayNote(item.days, total)
  const why = lineWhy(item, brief)
  return (
    <li className={'pack-item' + (item.done ? ' done' : '')}>
      <Check on={!!item.done} name={item.name} onClick={() => onTrip(setPacked(trip, item.id, !item.done))} />
      <span className="pack-body" title={item.why}>
        <span className="pack-name"><span>{brief}</span>{when && <em>{when}</em>}</span>
        {why && <span className="pack-why">{why}</span>}
      </span>
      <button type="button" className="pack-drop" aria-label={`不用带${item.name}`} onClick={() => onDrop(item)}>×</button>
    </li>
  )
}

export function PackCard({ trip, onTrip }: { trip: Trip; onTrip: (t: Trip) => void }) {
  const items = packItems(trip)
  const pending = items.filter(i => !i.done)
  const ready = items.filter(i => i.done)
  const [showDone, setShowDone] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const toast = useToast()
  const drop = (item: PackItem) => {
    const before = trip
    onTrip(hidePack(trip, item.id))
    toast(`已去掉「${item.name}」`, () => onTrip(before))
  }
  const add = () => {
    const v = name.trim()
    if (!v) return
    onTrip(addPackItem(trip, { id: uid('pack'), name: v, kind: guessPackKind(v), why: '自己加的' }))
    setName('')
    setAdding(false)
  }
  const rows = [...pending, ...(showDone ? ready : [])]
  return (
    <section className="pack-card" aria-label="必带">
      <div className="pack-hd">
        <b>必带</b>
        <small>{items.length ? `${pending.length} 件未备` : '按这趟整理'}</small>
      </div>
      {rows.length > 0 && (
        <ul>{rows.map(item => <Row key={item.id} item={item} total={trip.days.length} trip={trip} onTrip={onTrip} onDrop={drop} />)}</ul>
      )}
      <div className="pack-foot">
        {ready.length > 0 && (
          <button type="button" className="pack-quiet" aria-expanded={showDone} onClick={() => setShowDone(v => !v)}>
            {showDone ? '收起已备' : `已备 ${ready.length}`}
          </button>
        )}
        {adding ? (
          <form className="pack-add" onSubmit={e => { e.preventDefault(); add() }}>
            <input className="kinput" value={name} autoFocus onChange={e => setName(e.target.value)} placeholder="例如相机" aria-label="再加一件必带" />
            <button type="submit" className="kbtn" disabled={!name.trim()}>加上</button>
          </form>
        ) : (
          <button type="button" className="pack-quiet" onClick={() => setAdding(true)}>加一件</button>
        )}
      </div>
    </section>
  )
}

const BRIEF: Record<string, string> = {
  'doc.papers': '证件', 'doc.id': '身份证', 'doc.license': '驾照', 'doc.hk': '港澳通行证', 'doc.tw': '台湾通行证', 'doc.passport': '护照',
  'doc.tour': '行程单', 'doc.book': '预约凭证', 'gear.seat': '儿童座椅', 'gear.wheel': '轮椅', 'gear.cane': '拐杖', 'gear.transit': '乘车码',
  'gear.plug': '转换插头', 'gear.power': '充电', 'wear.grip': '防滑鞋', 'wear.warm': '保暖防晒', 'wear.swim': '泳衣',
  'care.stroller': '推车', 'care.diaper': '替换衣物', 'care.snack': '零食', 'care.nap': '午睡小毯', 'care.alt': '高原药', 'care.meds': '常用药',
}

/** 清单和今天都用短名；完整说法留在勾选按钮的说明里 */
function briefOf(item: PackItem): string {
  if (BRIEF[item.id]) {
    if (item.id === 'care.meds' && item.why.includes('的药')) return item.why.split('的药')[0] + '的药'
    return BRIEF[item.id]
  }
  if (item.id === 'care.pet') return item.name.split('的')[0]
  return item.name
}

/** 今天（或正在看的那一天）额外提醒：只露出还没勾的，已备的收成一个数字 */
export function PackToday({ trip, dayIndex, live, onTrip }: { trip: Trip; dayIndex: number; live: boolean; onTrip: (t: Trip) => void }) {
  const items = packForDay(trip, dayIndex)
  const [open, setOpen] = useState(false)
  if (!items.length) return null
  const pending = items.filter(i => !i.done)
  const ready = items.length - pending.length
  const title = live ? '今天' : `第${dayIndex + 1}天`
  const shown = open ? items : pending
  if (!shown.length) {
    return <button type="button" className="pack-today-line" onClick={() => setOpen(true)}>{title}要带的都备好了</button>
  }
  return (
    <section className="pack-today" aria-label={live ? '今天带上' : `第 ${dayIndex + 1} 天带上`}>
      <b>{title}</b>
      <ul className="pack-chips">
        {shown.map(item => (
          <li key={item.id}>
            <button type="button" className={'pack-chip' + (item.done ? ' on' : '')} aria-pressed={!!item.done} title={item.why}
              aria-label={`${item.done ? '取消勾选' : '勾选'}${item.name}。${item.why}`}
              onClick={() => onTrip(setPacked(trip, item.id, !item.done))}>
              {briefOf(item)}
            </button>
          </li>
        ))}
      </ul>
      {ready > 0 && (
        <button type="button" className="pack-quiet" aria-expanded={open} onClick={() => setOpen(v => !v)}>{open ? '收起' : `${ready} 已备`}</button>
      )}
    </section>
  )
}
