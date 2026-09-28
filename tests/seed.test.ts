import { describe, expect, it } from 'vitest'
import { seedTrip, SEED_NOW } from '../src/data/seed'
import { checkTrip } from '@core/validate'
import { tripProgress } from '@core/progress'

describe('示例旅程', () => {
  it('检查结果和预览里讲的故事一致：第 3 天连续驾驶、第 4 天海拔必改', () => {
    const t = seedTrip()
    const issues = checkTrip(t)
    const serious = issues.filter(i => i.level !== 'tip')
    expect(serious.filter(i => i.level === 'error').map(i => [i.day, i.code])).toEqual([[3, 'altitude']])
    expect(serious.some(i => i.day === 2 && i.code === 'noDriveBreak')).toBe(true)
    expect(serious.some(i => i.day === 1 && i.code === 'avoid:steps')).toBe(true)
    expect(serious.some(i => i.day === 3 && i.code === 'activeTooLong')).toBe(true)
  })

  it('演示时间落在第 3 天、在高速上、晚 15 分', () => {
    const [d, t] = SEED_NOW.split('T')
    const [y, m, dd] = d.split('-').map(Number)
    const [hh, mm] = t.split(':').map(Number)
    const p = tripProgress(seedTrip(), new Date(y, m - 1, dd, hh, mm))
    expect(p.dayIndex).toBe(2)
    expect(p.next?.name).toBe('洱源服务区')
    expect(seedTrip().days[2].stops[p.nowBefore].name).toBe('大丽高速 G5611')
    expect(p.behindMin).toBe(15)
  })
})

describe('短标签', () => {
  it('每条问题都有能一眼读完的短标签', () => {
    const issues = checkTrip(seedTrip())
    expect(issues.every(i => i.short && i.short.length <= 14)).toBe(true)
    expect(issues.find(i => i.day === 2 && i.code === 'noDriveBreak')?.short).toBe('连开 130/90 分')
    expect(issues.find(i => i.day === 3 && i.code === 'altitude')?.short).toBe('海拔 4506 m')
    expect(issues.find(i => i.day === 1 && i.code === 'walkTooFar')?.short).toBe('步行 4.5/4 km')
  })
})
