import { describe, expect, it } from 'vitest'
import { boardPins, fitBoard, nearestPin, placeLabels } from '../src/ui/RouteBoard'
import { seedTrip } from '../src/data/seed'
import type { Trip } from '@core/types'

describe('路线图', () => {
  it('只钉定了位的景点和住处；连住几晚只钉一次；序号只给景点、按顺序', () => {
    const t = seedTrip()
    const hotel = { lng: 100.2, lat: 26.9, adcode: '530702' }
    const two: Trip = { ...t, days: [
      { stops: [{ id: 'a', kind: 'sight', name: 'A', durationMin: 60, poi: { lng: 100.1, lat: 26.8 } }, { id: 'f', kind: 'food', name: '饭', durationMin: 60, poi: { lng: 100.12, lat: 26.8 } }, { id: 'h1', kind: 'lodging', name: '客栈', durationMin: 0, poi: hotel }] },
      { stops: [{ id: 'h0', kind: 'lodging', name: '客栈', durationMin: 0, poi: hotel }, { id: 'b', kind: 'sight', name: 'B', durationMin: 60, poi: { lng: 100.3, lat: 27 } }, { id: 'x', kind: 'sight', name: '没定位', durationMin: 60 }, { id: 'h2', kind: 'lodging', name: '客栈', durationMin: 0, poi: hotel }] },
    ] }
    const pins = boardPins(two)
    expect(pins.map(p => [p.name, p.kind, p.n, p.day])).toEqual([['A', 'sight', 1, 0], ['客栈', 'lodging', 0, 0], ['B', 'sight', 2, 1], ['客栈', 'lodging', 0, 1]])
  })

  it('点太集中时不放得过大；放下的点都在画板里', () => {
    const f = fitBoard([{ x: 10, y: 10 }, { x: 10.01, y: 10.01 }])
    const [x0] = f.to(10, 10), [x1] = f.to(10.01, 10.01)
    expect(Math.abs(x1 - x0)).toBeLessThan(10)
    const g = fitBoard([{ x: 0, y: 0 }, { x: 100, y: 50 }])
    for (const [x, y] of [g.to(0, 0), g.to(100, 50)]) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(340); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(240) }
  })

  it('点击：打开离手指最近的钉（两颗挨得近也分得清）；离得太远不算', () => {
    const pts = [{ id: 'hl', px: 100, py: 100 }, { id: 'inn', px: 108, py: 104 }]
    expect(nearestPin(pts, 101, 99, 18)?.id).toBe('hl')
    expect(nearestPin(pts, 107, 105, 18)?.id).toBe('inn')
    expect(nearestPin(pts, 160, 160, 18)).toBeNull()
  })

  it('标签卡互不重叠、不出界；放不下的就不放', () => {
    const pts = Array.from({ length: 12 }, (_, i) => ({ x: 150 + (i % 4) * 6, y: 110 + Math.floor(i / 4) * 6, label: '很长的地名' + i }))
    const boxes = placeLabels(pts)
    const got = boxes.filter((b): b is NonNullable<typeof b> => !!b)
    expect(got.length).toBeGreaterThan(0)
    expect(got.length).toBeLessThan(12)
    for (const [i, a] of got.entries()) {
      expect(a.x).toBeGreaterThanOrEqual(2); expect(a.x + a.w).toBeLessThanOrEqual(338)
      for (const b of got.slice(i + 1)) expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false)
    }
  })
})
