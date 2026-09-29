// 路线图（线索板式）：这趟所有定了位的景点、住处按顺序钉在当地地图上，一根线串起来，线在两颗钉之间微微下垂。
// 标签卡贴在图钉旁边、轻微歪着；挤在一起时逐个试八个方位找空处，找不到就只留图钉上的序号。
// 颜色、底板、歪多少全走主题令牌（kit.css .rb-*），博朗是液晶面板上的橙键，地图册是纸面上的红线。
import { useMemo, useState } from 'react'
import type { Stop, Trip } from '@core/types'
import map from '../data/china-map.json'

const W = 340
const H = 240
const PAD = 26
const project = (lng: number, lat: number): [number, number] => [(lng * map.k - map.minX) * map.scale, (-lat - map.minY) * map.scale]

export interface BoardPin { id: string; name: string; kind: 'sight' | 'lodging'; day: number; n: number; x: number; y: number }

/** 定了位的景点和住处，按天、按顺序；同一个住处连住几晚只钉一次 */
export function boardPins(trip: Trip): BoardPin[] {
  const out: BoardPin[] = []
  let n = 0
  trip.days.forEach((d, day) => {
    for (const s of d.stops) {
      if (!s.poi || (s.kind !== 'sight' && s.kind !== 'lodging') || s.status === 'skipped') continue
      const [x, y] = project(s.poi.lng, s.poi.lat)
      const prev = out[out.length - 1]
      if (prev && Math.hypot(prev.x - x, prev.y - y) < 1e-6) continue
      out.push({ id: s.id, name: s.name, kind: s.kind as BoardPin['kind'], day, n: s.kind === 'sight' ? ++n : 0, x, y })
    }
  })
  return out
}

/** 投影坐标 → 画板像素：按点的范围等比缩放、居中；点太集中时至少看 0.4 个单位（约 20 公里）的范围 */
export function fitBoard(pins: { x: number; y: number }[]) {
  const xs = pins.map(p => p.x), ys = pins.map(p => p.y)
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const min = 0.4
  if (x1 - x0 < min) { const c = (x0 + x1) / 2; x0 = c - min / 2; x1 = c + min / 2 }
  if (y1 - y0 < min) { const c = (y0 + y1) / 2; y0 = c - min / 2; y1 = c + min / 2 }
  const s = Math.min((W - PAD * 2) / (x1 - x0), (H - PAD * 2) / (y1 - y0))
  const ox = (W - (x1 - x0) * s) / 2 - x0 * s
  const oy = (H - (y1 - y0) * s) / 2 - y0 * s
  return { s, ox, oy, to: (x: number, y: number): [number, number] => [x * s + ox, y * s + oy] }
}

interface Box { x: number; y: number; w: number; h: number }
const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** 标签卡的位置：逐个试图钉周围八个方位，不压别的卡、不压别的钉、不出界；都不行就不放 */
export function placeLabels(pts: { x: number; y: number; label: string }[], charW = 11, h = 18): (Box | null)[] {
  const placed: Box[] = []
  const pinBoxes = pts.map(p => ({ x: p.x - 7, y: p.y - 7, w: 14, h: 14 }))
  const dirs: [number, number][] = [[1, -1], [1, 0.2], [-1, -1], [-1, 0.2], [0, -1.6], [0, 1.2], [1.2, 1], [-1.2, 1]]
  return pts.map((p, i) => {
    const w = Math.min(9, Array.from(p.label).length) * charW + 12
    for (const [dx, dy] of dirs) {
      const b: Box = { x: dx > 0 ? p.x + 9 * dx : dx < 0 ? p.x - w + 9 * dx : p.x - w / 2, y: p.y + dy * 12 - h / 2, w, h }
      if (b.x < 2 || b.y < 2 || b.x + b.w > W - 2 || b.y + b.h > H - 2) continue
      if (placed.some(o => hit(o, b)) || pinBoxes.some((o, k) => k !== i && hit(o, b))) continue
      placed.push(b)
      return b
    }
    return null
  })
}

/** 两颗钉之间的线：中点往下垂一点（离得越远垂得越多），像线绳 */
const threadPath = (a: [number, number], b: [number, number]) => {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
  const sag = Math.min(18, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.12)
  return `M${a[0].toFixed(1)} ${a[1].toFixed(1)}Q${mx.toFixed(1)} ${(my + sag).toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`
}

const short = (name: string) => { const c = Array.from(name.replace(/[（(].*$/, '').replace(/(景区|风景区|旅游区|国家公园|文化旅游区)$/, '')); return c.length > 8 ? c.slice(0, 8).join('') + '…' : c.join('') }

export function RouteBoard({ trip }: { trip: Trip }) {
  const pins = useMemo(() => boardPins(trip), [trip])
  const [day, setDay] = useState<number | null>(null)
  const view = useMemo(() => {
    if (pins.length < 2) return null
    // 选了某一天：放大到这天的点（带上前一晚住处，看得出从哪出发）；全部就看整趟
    const focusIdx = day == null ? pins.map((_, i) => i) : pins.map((p, i) => (p.day === day || pins[i + 1]?.day === day && p.day === day - 1 ? i : -1)).filter(i => i >= 0)
    const focus = focusIdx.length >= 1 ? focusIdx.map(i => pins[i]) : pins
    const fit = fitBoard(focus.length >= 2 ? focus : pins)
    const pts = pins.map(p => { const [x, y] = fit.to(p.x, p.y); return { ...p, px: x, py: y } })
    // 只给看的那几颗钉贴卡片；画面外的不贴
    const inView = (i: number) => focusIdx.includes(i) && pts[i].px > 0 && pts[i].px < W && pts[i].py > 0 && pts[i].py < H
    const idx = pts.map((_, i) => i).filter(inView)
    const placed = placeLabels(idx.map(i => ({ x: pts[i].px, y: pts[i].py, label: short(pts[i].name) })))
    const labels: (ReturnType<typeof placeLabels>[number])[] = pts.map(() => null)
    idx.forEach((i, k) => { labels[i] = placed[k] })
    return { fit, pts, labels }
  }, [pins, day])

  if (!view) {
    const located = trip.days.flatMap(d => d.stops).filter((s: Stop) => s.poi && (s.kind === 'sight' || s.kind === 'lodging')).length
    if (!trip.days.some(d => d.stops.some(s => s.kind === 'sight'))) return null
    return <p className="sheet-note rb-empty">路线图要至少两个定了位的地方{located ? `（现在 ${located} 个）` : ''}：在站点里点「搜高德」定位，或者用「排这趟」自动排。</p>
  }
  const { fit, pts, labels } = view
  const days = [...new Set(pts.map(p => p.day))]
  const on = (d: number) => day == null || d === day
  const mapT = `translate(${fit.ox.toFixed(2)} ${fit.oy.toFixed(2)}) scale(${fit.s.toFixed(4)})`

  return (
    <section className="rb" aria-label="路线图">
      <div className="rb-hd">
        <b>路线图</b>
        <div className="rb-days" role="radiogroup" aria-label="看哪天">
          <button type="button" role="radio" aria-checked={day == null} className={day == null ? 'on' : ''} onClick={() => setDay(null)}>全部</button>
          {days.map(d => <button key={d} type="button" role="radio" aria-checked={day === d} className={day === d ? 'on' : ''} onClick={() => setDay(day === d ? null : d)}>D{d + 1}</button>)}
        </div>
      </div>
      <svg className="rb-board" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`按顺序：${pts.map(p => p.name).join(' → ')}`}>
        <defs>
          <pattern id="rb-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" className="rb-grid" /></pattern>
          <clipPath id="rb-clip"><rect width={W} height={H} rx="10" /></clipPath>
        </defs>
        <g clipPath="url(#rb-clip)">
          <rect width={W} height={H} className="rb-bg" />
          <g transform={mapT}>{map.provinces.map(p => <path key={p.adcode} d={p.d} className="rb-prov" vectorEffect="non-scaling-stroke" />)}</g>
          <rect width={W} height={H} fill="url(#rb-grid)" />
        </g>
        <g clipPath="url(#rb-clip)">
        {/* 线：先画淡的整条，再画当天的实线 */}
        {pts.slice(1).map((p, i) => {
          const a = pts[i]
          return <path key={'t' + p.id} d={threadPath([a.px, a.py], [p.px, p.py])} className={'rb-thread' + (on(p.day) && on(a.day) ? '' : ' dim') + (a.day !== p.day ? ' hop' : '')} />
        })}
        {pts.map((p, i) => {
          const b = labels[i]
          return (
            <g key={p.id} className={'rb-pin-g' + (on(p.day) ? '' : ' dim')}>
              {b && (
                <g className="rb-card" style={{ ['--s' as string]: i % 2 ? -1 : 1 }}>
                  <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="3" />
                  <text x={b.x + 6} y={b.y + b.h / 2 + 4}>{short(p.name)}</text>
                </g>
              )}
              {p.kind === 'lodging'
                ? <rect x={p.px - 6} y={p.py - 6} width="12" height="12" rx="2.5" className="rb-pin lodge" />
                : <circle cx={p.px} cy={p.py} r="7.5" className="rb-pin" />}
              {p.kind !== 'lodging' && <text x={p.px} y={p.py + 3.2} className="rb-n">{p.n}</text>}
            </g>
          )
        })}
        </g>
      </svg>
      <p className="rb-legend"><span><i className="dot" />景点（数字是顺序）</span><span><i className="sq" />住处</span>{day != null && <span>第 {day + 1} 天</span>}</p>
    </section>
  )
}
