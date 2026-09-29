import { describe, expect, it } from 'vitest'
import { applyPerson, lastPartyIds, pickFromRoster, rosterFromTrips, samePerson, staleTrips } from '@core/roster'
import type { Member, Trip } from '@core/types'

const now = new Date('2026-09-29T10:00')
const trip = (id: string, startDate: string, members: Member[], extra: Partial<Trip> = {}): Trip => ({
  id, title: id, startDate, party: { mode: 'selfDrive', members, pets: [] }, days: [{ stops: [] }, { stops: [] }], ...extra,
})
const me: Member = { id: 'me', name: '我', role: 'adult', driver: true }
const grandma: Member = { id: 'gm', name: '外婆', role: 'elder', age: 72, mobility: 'slow' }
const kid: Member = { id: 'k', name: '朵朵', role: 'kid', age: 2 }

describe('家庭成员预设', () => {
  it('从已有行程里收集：同一个人以最相关的那趟为准，不带「哪几天在」', () => {
    const old = trip('old', '2025-05-01', [me, { ...grandma, age: 71 }, kid])
    const next = trip('next', '2026-10-10', [me, { ...grandma, days: { from: 1, to: 1 } }])
    const r = rosterFromTrips([old, next], now)
    expect(r.members.map(m => m.id)).toEqual(['me', 'gm', 'k'])
    expect(r.members[1]).toEqual(grandma) // 72 岁那份、去掉了 days
  })

  it('勾谁就带谁，按预设顺序；一个都没勾至少有个「我」', () => {
    const r = { members: [me, grandma, kid], pets: [{ id: 'd', name: '豆豆', kind: 'dog' as const, size: 'small' as const }] }
    const p = pickFromRoster(r, new Set(['k', 'me', 'd']), 'transit')
    expect(p.mode).toBe('transit')
    expect(p.members.map(m => m.name)).toEqual(['我', '朵朵'])
    expect(p.pets.map(x => x.name)).toEqual(['豆豆'])
    expect(pickFromRoster(r, new Set(), 'tour').members).toHaveLength(1)
  })

  it('「和上次一样」取最相关那趟的人', () => {
    expect(lastPartyIds([trip('a', '2025-01-01', [me, kid]), trip('b', '2026-10-10', [me, grandma])], now)).toEqual(['me', 'gm'])
  })

  it('改了预设：只问还没结束、不是示例、资料不一样的行程；同步时留着这趟的「哪几天在」', () => {
    const newer = { ...grandma, mobility: 'cane' as const }
    const past = trip('past', '2025-05-01', [grandma])
    const sample = trip('s', '2026-10-01', [grandma], { sample: true })
    const same = trip('same', '2026-11-01', [newer])
    const todo = trip('todo', '2026-10-10', [me, { ...grandma, days: { from: 1, to: 1 } }])
    const stale = staleTrips([past, sample, same, todo], newer, now)
    expect(stale.map(t => t.id)).toEqual(['todo'])
    const fixed = applyPerson(todo, newer)
    expect(fixed.party.members[1]).toEqual({ ...newer, days: { from: 1, to: 1 } })
    expect(samePerson(fixed.party.members[1], newer)).toBe(true)
    expect(fixed.party.members[0]).toBe(me)
  })
})
