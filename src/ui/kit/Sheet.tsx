// 底部面板：一次只编辑一件事。从底部升起，往下拖可以关，拖到一半能反悔；关的路径和来的路径相同。
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { project, reducedMotion, rubberband, springTo, velocityTracker } from './spring'

interface Props {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** 右上角的主操作，缺省是「完成」 */
  done?: string
  /** 主操作；缺省等于关闭（改动是即时生效的，完成只是收起） */
  onDone?: () => void
  doneDisabled?: boolean
  /** 只是收起（取消、知道了、关闭）时用中性样式，橙色留给提交 */
  doneTone?: 'primary' | 'plain'
  /** 收起动画播完之后调用：父组件等到这时再把面板撤掉，退场才看得见 */
  onExited?: () => void
  children: ReactNode
  /** 贴在底部的区域（影响提示、删除键） */
  footer?: ReactNode
}

export function Sheet({ open, onClose, title, done = '完成', onDone, doneDisabled, doneTone = 'primary', onExited, children, footer }: Props) {
  const [mounted, setMounted] = useState(open)
  const panel = useRef<HTMLDivElement>(null)
  const scrim = useRef<HTMLDivElement>(null)
  const y = useRef(0)
  const stop = useRef<() => void>(() => {})
  const h = () => panel.current?.offsetHeight ?? 600

  const paint = (v: number) => {
    y.current = v
    if (panel.current) panel.current.style.transform = `translateY(${Math.max(v, -40)}px)`
    if (scrim.current) scrim.current.style.opacity = String(Math.max(0, 1 - v / h()))
  }
  const animate = (to: number, velocity = 0, done?: () => void) => {
    stop.current()
    if (reducedMotion()) {
      // 不滑动，改成淡入淡出
      const el = panel.current, sc = scrim.current
      const show = to === 0
      if (el) { el.style.transform = 'none'; el.style.opacity = show ? '0' : '1' }
      if (sc) sc.style.opacity = show ? '0' : '1'
      // 先让浏览器吃下起点，再设终点，过渡才会发生
      void el?.offsetWidth
      if (el) el.style.opacity = show ? '1' : '0'
      if (sc) sc.style.opacity = show ? '1' : '0'
      y.current = to
      if (done) window.setTimeout(done, 210)
      return
    }
    stop.current = springTo(y.current, to, velocity, paint, { damping: 1, response: 0.32 }, done)
  }

  useEffect(() => { if (open) setMounted(true) }, [open])
  useLayoutEffect(() => {
    if (!mounted || !panel.current) return
    if (open) { paint(h()); animate(0) }
    else animate(h(), 0, () => { setMounted(false); onExited?.() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [open, onClose])
  useEffect(() => () => stop.current(), [])

  // 拖动：只在把手和标题栏上，1:1 跟手；松手看投影落点决定关还是回
  const drag = useRef<{ start: number; from: number; vt: ReturnType<typeof velocityTracker> } | null>(null)
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    stop.current()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { start: e.clientY, from: y.current, vt: velocityTracker() }
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const raw = d.from + e.clientY - d.start
    d.vt.push(raw)
    paint(raw < 0 ? rubberband(raw, h()) : raw)
  }
  const onUp = () => {
    const d = drag.current
    if (!d) return
    drag.current = null
    const v = d.vt.velocity()
    if (y.current + project(v) > h() * 0.45) { onClose() } else animate(0, v)
  }

  if (!mounted) return null
  return createPortal(
    <div className="sheet-layer" role="presentation">
      <div ref={scrim} className="sheet-scrim" onClick={onClose} />
      <div ref={panel} className="sheet-panel" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="sheet-grab" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <i className="sheet-handle" aria-hidden="true" />
          <div className="sheet-head">
            <h2>{title}</h2>
            <button type="button" className={'sheet-done' + (doneTone === 'plain' ? ' plain' : '')} onClick={onDone ?? onClose} disabled={doneDisabled}>{done}</button>
          </div>
        </div>
        <div className="sheet-content">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
