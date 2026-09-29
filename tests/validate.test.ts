import { describe, expect, it } from 'vitest'
import type { Tag } from '@core/types'
import { checkDay, checkTrip, napMissed, worst } from '@core/validate'
import { scheduleDay } from '@core/schedule'
import { adult, dog, elder, kid, party, stop, trip } from './fixtures'

const codes = (xs: { code: string }[]) => xs.map(x => x.code)

describe('排时刻', () => {
  it('没写 start 的接上一站，路上驾驶算在到达前', () => {
    const s = scheduleDay({ startTime: '08:00', stops: [stop('sight', 60), stop('food', 60, { driveMin: 30 })] })
    expect(s.map(x => [x.departAt, x.start, x.end])).toEqual([[480, 480, 540], [540, 570, 630]])
  })
  it('声明时间早于上一站结束算重叠，顺延', () => {
    const s = scheduleDay({ stops: [stop('sight', 120), stop('food', 60, { start: '10:00' })] })
    expect(s[1].overlap).toBe(true)
    expect(s[1].start).toBe(11 * 60)
  })
  it('跳过的站不占时间', () => {
    const s = scheduleDay({ stops: [stop('sight', 120, { status: 'skipped' }), stop('food', 60)] })
    expect(s[0].start).toBe(9 * 60)
  })
})

describe('规则检查', () => {
  it('成人轻松的一天没有问题', () => {
    const t = trip(party([adult(), adult('b')]), [[
      stop('sight', 180, { walkKm: 5 }), stop('food', 60), stop('sight', 120, { walkKm: 3, driveMin: 40 }), stop('lodging', 0, { driveMin: 30 }),
    ]])
    expect(checkTrip(t)).toEqual([])
  })

  it('同一份行程，带上 75 岁老人就超时超步行', () => {
    const day = [stop('sight', 240, { walkKm: 6 }), stop('food', 60), stop('sight', 180, { walkKm: 4 }), stop('lodging', 0)]
    expect(checkTrip(trip(party([adult()]), [day]))).toEqual([])
    const issues = checkTrip(trip(party([adult(), elder(76)]), [day]))
    expect(codes(issues)).toContain('activeTooLong')
    expect(codes(issues)).toContain('walkTooFar')
    const walk = issues.find(i => i.code === 'walkTooFar')!
    expect(walk.level).toBe('error') // 10 公里 > 4 × 1.5
    expect(walk.rules).toEqual(['elder75'])
  })

  it('单人自驾连续开 3 小时没停：报连续驾驶；中间停 20 分钟就没事', () => {
    const p = party([adult()])
    const bad = trip(p, [[stop('drive', 100), stop('rest', 5), stop('drive', 80), stop('lodging', 0)]])
    expect(codes(checkTrip(bad))).toEqual(['noDriveBreak'])
    const ok = trip(p, [[stop('drive', 100), stop('rest', 20), stop('drive', 80), stop('lodging', 0)]])
    expect(checkTrip(ok)).toEqual([])
  })

  it('带幼儿：90 分钟就得停', () => {
    const t = trip(party([adult(), kid(2)]), [[stop('drive', 100, { tags: [] }), stop('lodging', 0, { tags: ['elevator'] })]])
    expect(checkTrip(t).find(i => i.code === 'noDriveBreak')?.rules).toEqual(['toddler'])
  })

  it('驾驶总量超限', () => {
    const t = trip(party([adult()]), [[stop('drive', 110), stop('rest', 20), stop('drive', 110), stop('rest', 20), stop('drive', 110), stop('lodging', 0)]])
    expect(codes(checkTrip(t))).toContain('driveTooLong')
  })

  it('幼儿午睡只是建议：中午排满景点也不报问题；能不能睡上照样算得出（给排程用）', () => {
    const p = party([adult(), kid(2)])
    const tags = { tags: ['stroller', 'restroom'] as Tag[] }
    const busy = trip(p, [[stop('sight', 180, { ...tags, start: '10:00' }), stop('sight', 180, { ...tags }), stop('lodging', 0)]])
    expect(checkDay(busy, 0).filter(i => i.message.includes('午睡'))).toEqual([])
    expect(napMissed(busy, 0)).toBe(true)
    const napping = trip(p, [[stop('sight', 150, { ...tags, start: '10:00' }), stop('drive', 90), stop('sight', 90, { ...tags }), stop('lodging', 0)]])
    expect(napMissed(napping, 0)).toBe(false)
  })

  it('海拔超限是 error', () => {
    const t = trip(party([adult(), kid(2)], 'transit'), [[stop('sight', 120, { altitudeM: 3200, tags: ['stroller', 'restroom'] })]])
    expect(worst(checkTrip(t))).toBe('error')
  })

  it('轮椅：台阶多又没无障碍报警；住宿缺电梯是 warn，景点缺标签只是 tip', () => {
    const t = trip(party([adult(), elder(70, { mobility: 'wheelchair' })], 'transit'), [[
      stop('sight', 90, { name: '古城墙', tags: ['steps', 'restroom'] }),
      stop('lodging', 0, { name: '客栈' }),
    ]])
    const issues = checkTrip(t)
    expect(issues.find(i => i.code === 'avoid:steps')?.level).toBe('warn')
    expect(issues.find(i => i.code === 'need:accessible' && i.stopId === t.days[0].stops[0].id)?.level).toBe('tip')
    expect(issues.find(i => i.code === 'need:elevator')?.level).toBe('warn')
  })

  it('带狗：住宿没标可带宠物就报', () => {
    const t = trip(party([adult()], 'selfDrive', [dog()]), [[stop('lodging', 0, { name: '酒店' })]])
    expect(checkTrip(t).map(i => [i.code, i.level])).toEqual([['need:petOk', 'warn']])
  })

  it('只提醒真正容易出问题的：推车、厕所、儿童餐这类大多有，不标待核；带宠物的景点、住处照样问', () => {
    const t = trip(party([adult(), kid(2), elder(72)], 'transit', [dog()]), [[stop('sight', 60), stop('food', 60), stop('lodging', 0)]])
    const codes = (i: number) => checkTrip(t).filter(x => x.stopId === t.days[0].stops[i].id && x.code.startsWith('need:')).map(x => x.code).sort()
    expect(codes(0)).toEqual(['need:petOk'])
    expect(codes(1)).toEqual([]) // 饭店不问儿童餐、厕所、软烂、带狗
    expect(codes(2)).toEqual(['need:elevator', 'need:petOk'])
  })

  it('跟团带狗：每天都有 blocker', () => {
    const t = trip(party([adult()], 'tour', [dog()]), [[stop('sight', 60, { tags: ['petOk'] })], [stop('sight', 60, { tags: ['petOk'] })]])
    expect(checkTrip(t).filter(i => i.code === 'tourPet').map(i => i.day)).toEqual([0, 1])
  })

  it('动态人数：老人第 2 天才到，只有第 2 天报', () => {
    const d = () => [stop('sight', 300, { walkKm: 8 }), stop('lodging', 0, { tags: ['elevator'] })]
    const t = trip(party([adult(), elder(68, { days: { from: 1, to: 1 } })], 'transit'), [d(), d()])
    expect(checkTrip(t).filter(i => i.code === 'walkTooFar').map(i => i.day)).toEqual([1])
  })
})
