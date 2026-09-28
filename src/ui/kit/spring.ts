// 弹簧：从当前值出发、带着手指的速度，随时可以被新的目标打断。
// 参数用苹果的两个量：damping（1 = 不回弹）与 response（大约多快到位，秒）。
export interface SpringOpts { damping?: number; response?: number }

export function springTo(
  from: number, to: number, velocity: number,
  onUpdate: (x: number) => void,
  { damping = 1, response = 0.32 }: SpringOpts = {},
  onDone?: () => void,
): () => void {
  const k = (2 * Math.PI / response) ** 2
  const c = 2 * damping * Math.sqrt(k)
  let x = from, v = velocity, last = performance.now(), raf = 0
  const step = (t: number) => {
    const dt = Math.min(0.032, (t - last) / 1000)
    last = t
    v += (-k * (x - to) - c * v) * dt
    x += v * dt
    // 差一个像素、速度很小就算到位，免得尾巴拖太久
    if (Math.abs(v) < 20 && Math.abs(x - to) < 1) { onUpdate(to); onDone?.(); return }
    onUpdate(x)
    raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
  return () => cancelAnimationFrame(raf)
}

/** 苹果的动量投影：手一甩，按速度推算会停在哪 */
export function project(velocity: number, decelerationRate = 0.998): number {
  return (velocity / 1000) * decelerationRate / (1 - decelerationRate)
}

/** 越过边界时越拉越沉 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))
}

export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** 记最近几次指针位置，松手时算速度 */
export function velocityTracker() {
  const pts: { t: number; v: number }[] = []
  return {
    push(v: number) { pts.push({ t: performance.now(), v }); if (pts.length > 6) pts.shift() },
    velocity() {
      if (pts.length < 2) return 0
      const a = pts[0], b = pts[pts.length - 1]
      const dt = (b.t - a.t) / 1000
      return dt > 0 ? (b.v - a.v) / dt : 0
    },
    reset() { pts.length = 0 },
  }
}
