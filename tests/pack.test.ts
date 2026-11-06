import { describe, expect, it } from 'vitest'
import { addPackItem, dayNote, hidePack, packForDay, packItems, setPacked } from '@core/pack'
import type { Trip } from '@core/types'
import { seedTrip } from '../src/data/seed'
import { docToTrip, tripToDoc } from '../src/sync/tripDoc'
import { adult, kid, party, stop, trip } from './fixtures'

const ids = (t: Trip, day?: number) => (day == null ? packItems(t) : packForDay(t, day)).map(i => i.id)

describe('必带', () => {
  it('示例行程：证件和座椅全程提醒，台阶、高原、外婆只落在对应的天', () => {
    const t = seedTrip()
    expect(ids(t)).toEqual(expect.arrayContaining(['doc.papers', 'gear.seat', 'gear.power', 'wear.grip', 'wear.warm', 'care.stroller', 'care.diaper', 'care.nap', 'care.alt', 'care.meds', 'care.pet']))
    expect(packItems(t).find(i => i.id === 'wear.grip')).toMatchObject({ days: [1], why: expect.stringContaining('崇圣寺三塔') })
    expect(packItems(t).find(i => i.id === 'wear.warm')?.days).toEqual([3])
    expect(packItems(t).find(i => i.id === 'care.alt')?.why).toContain('4506')
    expect(packItems(t).find(i => i.id === 'care.meds')?.days).toEqual([1, 2, 3, 4])
    expect(packItems(t).find(i => i.id === 'care.stroller')?.days).toEqual([0, 1, 2, 3])
    expect(packItems(t).find(i => i.id === 'care.diaper')?.days).toEqual([4])
    expect(packItems(t).find(i => i.id === 'care.nap')?.days).toEqual([0, 2, 3, 4])
    expect(packItems(t).find(i => i.id === 'gear.power')?.days).toBeUndefined()

    // 演示时间是第 3 天（下标 2）：喜洲、长途、黑龙潭。没有台阶和高原，外婆在
    expect(ids(t, 2).sort()).toEqual(['care.meds', 'care.nap', 'care.pet', 'care.stroller', 'doc.papers', 'gear.seat'])
    expect(ids(t, 0)).not.toContain('care.meds')
    expect(ids(t, 1)).toContain('wear.grip')
    expect(ids(t, 1)).not.toContain('care.nap')
    expect(ids(t, 3)).toEqual(expect.arrayContaining(['wear.warm', 'care.alt']))
  })

  it('勾选和去掉记在行程上，重算文案也对得上；自己加的每天都提醒', () => {
    let t = setPacked(seedTrip(), 'doc.papers', true)
    expect(packItems(t).find(i => i.id === 'doc.papers')?.done).toBe(true)
    t = setPacked(t, 'doc.papers', false)
    expect(t.pack).toBeUndefined()

    t = hidePack(seedTrip(), 'care.nap')
    expect(ids(t)).not.toContain('care.nap')
    expect(t.pack?.hidden).toEqual(['care.nap'])

    t = addPackItem(seedTrip(), { id: 'c1', name: '相机', kind: 'gear', why: '自己加的' })
    expect(ids(t, 0)).toContain('c1')
    t = setPacked(t, 'c1', true)
    expect(packItems(t).find(i => i.id === 'c1')?.done).toBe(true)
    expect(t.pack?.done ?? []).not.toContain('c1')
    const back = docToTrip(tripToDoc(t, [], 1, 'me')).trip
    expect(back.pack).toEqual(t.pack)
    expect(packItems(back).find(i => i.id === 'c1')?.done).toBe(true)
  })

  it('出境带护照和转换插头，不把身份证当成出境证件；预约和「不用预约」分得开', () => {
    const jp = trip(party([adult()]), [[stop('sight', 90, { name: '浅草寺', poi: { lng: 139.8, lat: 35.71, cc: 'JP' } })]])
    expect(ids(jp)).toContain('doc.passport')
    expect(ids(jp)).toContain('doc.license')
    expect(ids(jp)).toContain('gear.plug')
    expect(ids(jp)).not.toContain('doc.papers')
    expect(ids(jp)).not.toContain('doc.id')

    const book = trip(party([adult()], 'transit'), [[stop('sight', 90, { name: '故宫', highlight: { how: '走中轴线', tip: '门票要预约' } })]])
    expect(packItems(book).find(i => i.id === 'doc.book')?.why).toContain('故宫')
    expect(ids(book)).toContain('gear.transit')
    expect(ids(book)).not.toContain('doc.license')

    const free = trip(party([adult()], 'tour'), [[stop('sight', 60, { name: '公园', highlight: { how: '随便走', tip: '不用预约' } })]])
    expect(ids(free)).not.toContain('doc.book')
    expect(ids(free)).toContain('doc.tour')
  })

  it('轮椅只在要下车走的那天，跳过的台阶不算', () => {
    const t = trip(party([adult('a', { mobility: 'wheelchair' })]), [
      [stop('sight', 60, { name: '博物馆', walkKm: 1 })],
      [stop('drive', 40, { name: '转移' })],
    ])
    expect(packItems(t).find(i => i.id === 'gear.wheel')?.days).toEqual([0])
    const skipped = trip(party([adult()]), [[stop('sight', 30, { name: '石阶', tags: ['steps'], status: 'skipped' })]])
    expect(ids(skipped)).not.toContain('wear.grip')
  })

  it('天数写法', () => {
    expect(dayNote([1, 2, 4], 5)).toBe('第2–3、5天')
    expect(dayNote([0, 1, 2, 3, 4], 5)).toBe('')
    expect(dayNote(undefined, 5)).toBe('')
  })

  it('低海拔但有幼儿，只提醒药、不提保暖', () => {
    const t = trip(party([adult(), kid(2)]), [[stop('sight', 120, { name: '白沙', altitudeM: 2600, walkKm: 1 })]])
    expect(ids(t)).toContain('care.alt')
    expect(ids(t)).not.toContain('wear.warm')
    expect(packItems(t).find(i => i.id === 'care.alt')?.why).toContain('幼儿')
  })
})
