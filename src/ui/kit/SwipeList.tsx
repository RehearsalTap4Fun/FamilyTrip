// 站点列表：左滑露出「跳过 / 删除」，按住右侧把手上下拖动排序，点一下打开面板。
// 横滑有 10px 的起步门槛，先确认方向再跟手；竖向交给页面滚动。
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { project, reducedMotion, rubberband, springTo, velocityTracker } from './spring'

export interface SwipeAction { label: string; tone?: 'danger' | 'plain'; onAct: () => void }

interface Item { id: string; content: ReactNode; actions?: SwipeAction[]; sortable?: boolean }

interface Props {
  items: Item[]
  onOpen: (id: string) => void
  onMove?: (from: number, to: number) => void
  /** 用户第一次左滑或拖动时通知一次，用来收起操作提示 */
  onLearned?: () => void
}

const ACTION_W = 64

export function SwipeList({ items, onOpen, onMove, onLearned }: Props) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const [dragY, setDragY] = useState(0)
  const rowH = useRef(56)
  const listRef = useRef<HTMLOListElement>(null)

  // —— 拖动排序：只在把手上，按下即开始 ——
  const sort = useRef<{ start: number; idx: number } | null>(null)
  const onHandleDown = (e: React.PointerEvent, idx: number) => {
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const row = (e.currentTarget as HTMLElement).closest('li')
    rowH.current = row?.offsetHeight ?? 56
    sort.current = { start: e.clientY, idx }
    setOpenId(null)
    setDragIdx(idx); setOverIdx(idx); setDragY(0)
  }
  const onHandleMove = (e: React.PointerEvent) => {
    const s = sort.current
    if (!s) return
    const dy = e.clientY - s.start
    setDragY(dy)
    setOverIdx(Math.min(items.length - 1, Math.max(0, s.idx + Math.round(dy / rowH.current))))
  }
  const onHandleUp = () => {
    const s = sort.current
    if (!s) return
    sort.current = null
    if (overIdx != null && overIdx !== s.idx) { onMove?.(s.idx, overIdx); onLearned?.() }
    setDragIdx(null); setOverIdx(null); setDragY(0)
  }
  const shiftOf = (i: number) => {
    if (dragIdx == null || overIdx == null || i === dragIdx) return 0
    if (dragIdx < overIdx && i > dragIdx && i <= overIdx) return -rowH.current
    if (dragIdx > overIdx && i < dragIdx && i >= overIdx) return rowH.current
    return 0
  }

  return (
    <ol ref={listRef} className={'swipe-list' + (dragIdx != null ? ' sorting' : '')}>
      {items.map((it, i) => (
        <SwipeRow key={it.id} item={it} open={openId === it.id} onOpenActions={o => { setOpenId(o ? it.id : null); if (o) onLearned?.() }}
          onTap={() => (openId ? setOpenId(null) : onOpen(it.id))}
          style={i === dragIdx ? { transform: `translateY(${dragY}px)`, zIndex: 3 } : { transform: `translateY(${shiftOf(i)}px)` }}
          dragging={i === dragIdx}
          handle={it.sortable !== false && onMove ? (
            <button type="button" className="grip" aria-label="拖动排序" onPointerDown={e => onHandleDown(e, i)} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}
              onKeyDown={e => { if (e.key === 'ArrowUp' && i > 0) onMove(i, i - 1); if (e.key === 'ArrowDown' && i < items.length - 1) onMove(i, i + 1) }}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 5h8M4 8h8M4 11h8" /></svg>
            </button>
          ) : null} />
      ))}
    </ol>
  )
}

function SwipeRow({ item, open, onOpenActions, onTap, style, dragging, handle }: {
  item: Item; open: boolean; onOpenActions: (o: boolean) => void; onTap: () => void
  style: React.CSSProperties; dragging: boolean; handle: ReactNode
}) {
  const face = useRef<HTMLDivElement>(null)
  const x = useRef(0)
  const stop = useRef<() => void>(() => {})
  const g = useRef<{ sx: number; sy: number; from: number; mode: 'none' | 'swipe' | 'scroll'; vt: ReturnType<typeof velocityTracker> } | null>(null)
  const width = (item.actions?.length ?? 0) * ACTION_W
  const paint = (v: number) => { x.current = v; face.current?.style.setProperty('--sx', `${v}px`) }
  const settle = (to: number, v = 0) => {
    stop.current()
    if (reducedMotion()) return paint(to)
    stop.current = springTo(x.current, to, v, paint, { damping: 1, response: 0.28 })
  }
  // 外部要求收起时（点了别的行、拖动排序开始）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open && x.current !== 0) settle(0) }, [open])
  useEffect(() => () => stop.current(), [])

  const down = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.grip')) return
    stop.current()
    g.current = { sx: e.clientX, sy: e.clientY, from: x.current, mode: 'none', vt: velocityTracker() }
  }
  const move = (e: React.PointerEvent) => {
    const s = g.current
    if (!s || !width) return
    const dx = e.clientX - s.sx, dy = e.clientY - s.sy
    if (s.mode === 'none') {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { s.mode = 'swipe'; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }
      else if (Math.abs(dy) > 10) s.mode = 'scroll'
      else return
    }
    if (s.mode !== 'swipe') return
    let v = s.from + dx
    if (v > 0) v = rubberband(v, 200)
    if (v < -width) v = -width + rubberband(v + width, 200)
    s.vt.push(v)
    paint(v)
  }
  const up = () => {
    const s = g.current
    g.current = null
    if (!s) return
    if (s.mode === 'none') { onTap(); return }
    if (s.mode !== 'swipe') return
    const v = s.vt.velocity()
    const willOpen = x.current + project(v, 0.99) < -width / 2
    settle(willOpen ? -width : 0, v)
    onOpenActions(willOpen)
  }

  return (
    <li className={'srow' + (dragging ? ' dragging' : '')} style={style}>
      {!!width && (
        <div className="srow-actions" style={{ width }}>
          {item.actions!.map(a => (
            <button key={a.label} type="button" className={'sact sact--' + (a.tone ?? 'plain')} onClick={() => { settle(0); onOpenActions(false); a.onAct() }} tabIndex={open ? 0 : -1}>{a.label}</button>
          ))}
        </div>
      )}
      <div ref={face} className="srow-face" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { g.current = null; settle(0) }}
        role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap() } }}>
        <div className="srow-content">{item.content}</div>
        {handle}
      </div>
    </li>
  )
}
