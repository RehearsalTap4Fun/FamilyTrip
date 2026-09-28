import { describe, expect, it } from 'vitest'
import { seedTrip } from '../src/data/seed'
import { dayCities, dayTitle, fmtDay, partyLine, routeCode, stripCode, tintOf } from '../src/ui/format'

describe('界面格式化', () => {
  const t = seedTrip()
  it('一天经过的城市按先后去重', () => {
    expect(dayCities(t.days[2])).toEqual(['大理', '丽江'])
    expect(dayTitle(t.days[2])).toBe('大理—丽江')
  })
  it('日期带星期', () => {
    expect(fmtDay('2026-10-01', 2)).toBe('10 月 3 日 周六')
  })
  it('当天人数按动态人数算', () => {
    expect(partyLine(t, 0)).toBe('自驾 3 人 1 犬')
    expect(partyLine(t, 2)).toBe('自驾 4 人 1 犬')
  })
  it('路名里的国家高速编号', () => {
    expect(routeCode('大丽高速 G5611')).toBe('G5611')
    expect(stripCode('大丽高速 G5611')).toBe('大丽高速')
    expect(routeCode('喜洲古镇')).toBeUndefined()
  })
  it('同一个城市在每一天都是同一种平涂色', () => {
    const dali = tintOf(t, '532901')
    expect(tintOf(t, '532930')).toBe(dali) // 洱源也在大理州
    expect(tintOf(t, '530702')).not.toBe(dali)
    expect(tintOf(t, undefined)).toBe('transparent')
  })
})
