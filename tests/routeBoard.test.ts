import { describe, expect, it } from 'vitest'
import { boardPins, compressBoard, fitBoard, nearestPin, placeLabels, type BoardPin } from '../src/ui/RouteBoard'
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

  it('有起点终点：起点钉在最前、回到家钉在最后，都是小房子，不编序号', () => {
    const t = seedTrip()
    const home = { lng: 102.7, lat: 25.0 }
    const trip: Trip = { ...t, plan: { flow: 'places', styles: [], from: { name: '家', poi: home }, to: { name: '家', poi: home } }, days: [
      { stops: [{ id: 'a', kind: 'sight', name: 'A', durationMin: 60, poi: { lng: 100.1, lat: 26.8 } }, { id: 'h', kind: 'lodging', name: '客栈', durationMin: 0, poi: { lng: 100.2, lat: 26.9 } }] },
      { stops: [{ id: 'b', kind: 'sight', name: 'B', durationMin: 60, poi: { lng: 100.3, lat: 27 } }, { id: 'e', kind: 'lodging', name: '回到家', durationMin: 0, poi: home, home: true }] },
    ] }
    expect(boardPins(trip).map(p => [p.id, p.name, p.kind, p.n])).toEqual([['from', '家', 'end', 0], ['a', 'A', 'sight', 1], ['h', '客栈', 'lodging', 0], ['b', 'B', 'sight', 2], ['e', '家', 'end', 0]])
    expect(boardPins(trip)[4].quiet).toBe(true) // 和起点同一处，只钉不再贴一张「家」
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

describe('路线图远点压缩', () => {
  const pin = (id: string, kind: BoardPin['kind'], x: number, y: number): BoardPin => ({ id, name: id, kind, day: 0, n: 0, x, y, lng: 0, lat: 0 })
  // 景点挤在 (100,100) 附近，家在 30 个单位外（约上千公里），路上住的在中间
  const sights = [pin('a', 'sight', 100, 100), pin('b', 'sight', 100.4, 100.2), pin('c', 'sight', 99.8, 100.5)]
  const home = pin('home', 'end', 70, 110), inn = pin('inn', 'lodging', 85, 105)

  it('景点那片照真实比例；圈外的方向不变、拉近，远近顺序不变', () => {
    const c = compressBoard([home, inn, ...sights])!
    expect(c).not.toBeNull()
    const got = (id: string) => c.pins.find(p => p.id === id)!
    // 景点原样
    for (const s0 of sights) expect([got(s0.id).x, got(s0.id).y]).toEqual([s0.x, s0.y])
    const d = (p: { x: number; y: number }) => Math.hypot(p.x - c.cx, p.y - c.cy)
    // 拉近了很多，但还在圈外、远近顺序不变
    expect(d(got('home'))).toBeLessThan(d(home) / 4)
    expect(d(got('home'))).toBeGreaterThan(c.r)
    expect(d(got('home'))).toBeGreaterThan(d(got('inn')))
    expect(got('home').far).toBe(true)
    // 方向不变：和中心连线的角度一样
    const ang = (p: { x: number; y: number }) => Math.atan2(p.y - c.cy, p.x - c.cx)
    expect(ang(got('home'))).toBeCloseTo(ang(home), 6)
    // 压缩后景点之间在画板上分得开（以前家和景点一起按一个比例尺，景点挤在几个像素里）
    const fit = fitBoard(c.pins)
    const [ax, ay] = fit.to(sights[0].x, sights[0].y), [bx, by] = fit.to(sights[1].x, sights[1].y)
    expect(Math.hypot(ax - bx, ay - by)).toBeGreaterThan(12)
    const raw = fitBoard([home, inn, ...sights])
    const [rx, ry] = raw.to(sights[0].x, sights[0].y), [sx, sy] = raw.to(sights[1].x, sights[1].y)
    expect(Math.hypot(rx - sx, ry - sy)).toBeLessThan(6)
  })

  it('都在一片、没有远点：不压缩', () => {
    expect(compressBoard([...sights, pin('h', 'lodging', 100.3, 100.3)])).toBeNull()
  })
})
