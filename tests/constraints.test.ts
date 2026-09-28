import { describe, expect, it } from 'vitest'
import { deriveConstraints, foodNeeds, limitRules } from '@core/constraints'
import { whoFor, whoForAll } from '@core/explain'
import { partyOnDay } from '@core/party'
import { adult, dog, elder, kid, party } from './fixtures'

const at = (p: ReturnType<typeof party>, day = 0) => deriveConstraints(partyOnDay(p, day))

describe('叠加约束', () => {
  it('两个成人自驾：默认上限，单人驾驶按 5 小时', () => {
    const c = at(party([adult('a1'), adult('a2', { driver: false })]))
    expect(c.activeMin.value).toBe(600)
    expect(c.driveMin).toEqual({ value: 300, by: 'drive1' })
    expect(c.driveBreakMin.value).toBe(120)
    expect(c.blockers).toEqual([])
  })

  it('两位司机放宽到 8 小时', () => {
    expect(at(party([adult('a1'), adult('a2')])).driveMin).toEqual({ value: 480, by: 'drive2' })
  })

  it('老人 + 幼儿 + 狗：每项取最严，需求取并集，且记下是谁收紧的', () => {
    const c = at(party([adult(), elder(78, { mobility: 'cane' }), kid(2)], 'selfDrive', [dog()]))
    expect(c.activeMin).toEqual({ value: 360, by: 'elder75', ties: ['toddler'] }) // elder75 先到 360，toddler 同值记为并列
    expect(c.walkKm).toEqual({ value: 2, by: 'mobCane' })
    expect(c.endBy).toEqual({ value: 20 * 60, by: 'toddler' })
    expect(c.altitudeM).toEqual({ value: 2500, by: 'elder75', ties: ['toddler'] })
    expect(c.driveBreakMin).toEqual({ value: 90, by: 'toddler' })
    expect(c.nap).toMatchObject({ from: 750, to: 870 })
    expect([...c.lodgingNeeds.keys()].sort()).toEqual(['elevator', 'petOk'])
    expect(c.lodgingNeeds.get('elevator')).toEqual(['elder', 'mobCane'])
    expect([...c.needs.keys()].sort()).toEqual(['petOk', 'restroom', 'stroller'])
    expect(c.avoid.get('steps')?.unless).toBe('accessible')
    expect(c.childSeats).toBe(1)
  })

  it('两个低龄小孩的午睡窗口取并集', () => {
    const c = at(party([adult(), kid(0), kid(2)]))
    expect(c.nap).toMatchObject({ from: 720, to: 870 })
  })

  it('非自驾不设驾驶上限', () => {
    const c = at(party([adult(), kid(2)], 'transit'))
    expect(c.driveMin.value).toBe(Infinity)
    expect(c.driveBreakMin.value).toBe(Infinity)
  })

  it('组合冲突：跟团带狗、高铁带大狗、自驾没司机、座位不够', () => {
    expect(at(party([adult()], 'tour', [dog()])).blockers.map(b => b.code)).toEqual(['tourPet'])
    expect(at(party([adult()], 'transit', [dog('large')])).blockers.map(b => b.code)).toEqual(['transitLargePet'])
    expect(at(party([adult('a', { driver: false })])).blockers.map(b => b.code)).toEqual(['noDriver'])
    expect(at(party([adult(), adult('b'), elder(70), kid(5), kid(8)], 'selfDrive', [], 4)).blockers.map(b => b.code)).toEqual(['seats'])
  })

  it('动态人数：老人只来第 2–3 天，第 1 天不受老人约束', () => {
    const p = party([adult(), elder(70, { days: { from: 1, to: 2 } })])
    expect(at(p, 0).walkKm.value).toBe(15)
    expect(at(p, 1).walkKm).toEqual({ value: 6, by: 'elder' })
    expect(at(p, 3).walkKm.value).toBe(15)
  })

  it('动态人数：座位只按当天人数算', () => {
    const p = party([adult(), adult('b'), adult('c', { days: { from: 2, to: 2 } }), kid(5), kid(8)], 'selfDrive', [], 4)
    expect(at(p, 0).blockers).toEqual([])
    expect(at(p, 2).blockers.map(b => b.code)).toEqual(['seats'])
  })

  it('吃饭需求：学龄前要儿童餐，75 岁以上要软烂', () => {
    const f = foodNeeds(partyOnDay(party([adult(), kid(4), elder(80)]), 0))
    expect([...f.keys()].sort()).toEqual(['kidMenu', 'softFood'])
    expect(foodNeeds(partyOnDay(party([adult(), kid(9), elder(66)]), 0)).size).toBe(0)
  })
})


describe('规则的触发者', () => {
  it('并列的限制把每个人都列出来', () => {
    const p = partyOnDay(party([adult('我'), elder(78, { name: '外婆', mobility: 'slow' }), kid(2, { name: '朵朵' })], 'selfDrive', [dog('medium', { name: '豆包' })]), 0)
    const c = deriveConstraints(p)
    expect(whoForAll(limitRules(c.activeMin), p)).toEqual(['外婆', '朵朵'])
    expect(whoFor('mobSlow', p)).toEqual(['外婆'])
    expect(whoFor('pet', p)).toEqual(['豆包'])
    expect(whoFor('drive1', p)).toEqual(['我'])
  })
})
