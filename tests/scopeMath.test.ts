import { describe, expect, it } from 'vitest'
import { scheduleDay } from '@core/schedule'
import { crossing, maxDriveRun, traceOf, valueAt } from '../src/ui/scopeMath'
import { seedTrip } from '../src/data/seed'
import { stop } from './fixtures'

describe('示波器曲线', () => {
  const day = { startTime: '09:00', stops: [stop('sight', 120), stop('drive', 60), stop('food', 60), stop('rest', 30), stop('sight', 180)] }
  const slots = scheduleDay(day)

  it('只有游玩和吃饭让曲线上升，开车和休息是平的', () => {
    const pts = traceOf(slots)
    expect(pts.map(p => [p.t, p.v])).toEqual([[540, 0], [540, 0], [660, 120], [720, 120], [720, 120], [780, 180], [810, 180], [810, 180], [990, 360]])
  })

  it('延误把没到的站整体往后推', () => {
    expect(traceOf(slots, 30).slice(-1)[0]).toMatchObject({ t: 1020, v: 360 })
  })

  it('打过卡的站按实际时刻画', () => {
    const s = scheduleDay({ ...day, stops: day.stops.map((x, i) => (i === 0 ? { ...x, status: 'done' as const, actualStart: '09:20' } : x)) })
    expect(traceOf(s)[1]).toMatchObject({ t: 560, v: 0, done: true })
  })

  it('触发时刻与插值', () => {
    const pts = traceOf(slots)
    expect(crossing(pts, 300)).toBe(930) // 最后一段 810→990 从 180 升到 360
    expect(crossing(pts, 400)).toBeNull()
    expect(valueAt(pts, 600)).toBe(60)
    expect(valueAt(pts, 2000)).toBe(360)
  })

  it('最长连续驾驶与规则层口径一致', () => {
    expect(maxDriveRun(scheduleDay(seedTrip().days[2]))).toBe(130)
  })
})

import { phaseOf } from '../src/ui/scopeMath'
describe('时段', () => {
  it('清晨、白天、傍晚、夜里的边界', () => {
    expect([299, 300, 449, 450, 989, 990, 1169, 1170, 30].map(phaseOf)).toEqual(['night', 'dawn', 'dawn', 'day', 'day', 'dusk', 'dusk', 'night', 'night'])
  })
})
