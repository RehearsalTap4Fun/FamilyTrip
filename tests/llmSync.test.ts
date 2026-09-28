import { describe, expect, it } from 'vitest'
import { buildRepairPrompt, buildRoutePrompt, draftToDays, parseDraft } from '@llm/routePrompt'
import { aggregate } from '@core/ratings'
import { checkTrip } from '@core/validate'
import { diffInto, docToTrip, mergeDocs, tripToDoc } from '@sync/tripDoc'
import { adult, dog, elder, kid, party, stop, trip } from './fixtures'

describe('路线提示词', () => {
  it('动态人数分段描述约束，并带上自己的黑榜', () => {
    const p = party([adult(), kid(2), elder(78, { days: { from: 2, to: 3 } })], 'selfDrive', [dog()])
    const places = aggregate([{ id: 'r', kind: 'food', name: '网红烤鱼', city: '大理', verdict: 'black', note: '排队两小时', by: 'a', at: 1 }])
    const { system, user } = buildRoutePrompt({ destination: '大理', days: 4, party: p, places })
    expect(system).toContain('只输出 JSON')
    expect(user).toContain('第 1–2 天同行')
    expect(user).toContain('第 3–4 天同行')
    expect(user).toContain('78 岁老人')
    expect(user).toContain('12:30–14:30')
    expect(user).toContain('住宿必须满足')
    expect(user).toContain('网红烤鱼（排队两小时）')
  })

  it('解析：去掉代码块包裹，校验结构，补 id', () => {
    const text = '```json\n{"days":[{"stops":[{"kind":"sight","name":"洱海","durationMin":120,"tags":["stroller"],"why":"平路"},{"kind":"lodging","name":"客栈","durationMin":0}]}]}\n```'
    const r = parseDraft(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const days = draftToDays(r.draft)
    expect(days[0].stops.map(s => s.id)).toEqual(['d1s1', 'd1s2'])
    expect(days[0].stops[0].why).toBe('平路')
  })

  it('解析失败给出可读原因', () => {
    expect(parseDraft('好的，这是行程')).toMatchObject({ ok: false })
    const bad = parseDraft('{"days":[{"stops":[{"kind":"fly","name":"x","durationMin":1}]}]}')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('kind')
  })

  it('修复提示只列 error / warn', () => {
    const t = trip(party([adult(), elder(80)], 'transit'), [[stop('sight', 500, { walkKm: 9 })]])
    const r = parseDraft('{"days":[{"stops":[{"kind":"sight","name":"x","durationMin":500}]}]}')
    if (!r.ok) throw new Error()
    const msg = buildRepairPrompt(checkTrip(t), r.draft)
    expect(msg).toContain('步行约 9.0 公里')
    expect(msg).not.toContain('未确认')
  })
})

describe('多人同步', () => {
  const base = () => trip(party([adult()]), [[stop('sight', 60, { id: 'p1' }), stop('sight', 60, { id: 'p2' }), stop('lodging', 0, { id: 'p3' })]])

  it('往返不丢信息', () => {
    const t = base()
    const { trip: back } = docToTrip(tripToDoc(t, [], 1, 'A'))
    expect(back.days[0].stops.map(s => s.id)).toEqual(['p1', 'p2', 'p3'])
    expect(back.party.members.length).toBe(1)
  })

  it('A 打卡、B 插一站、C 加一只狗，三方合并全保留', () => {
    const t0 = base()
    const d0 = tripToDoc(t0, [], 1, 'init')

    const tA = { ...t0, days: [{ stops: t0.days[0].stops.map(s => (s.id === 'p2' ? { ...s, status: 'done' as const } : s)) }] }
    const dA = diffInto(d0, tripToDoc(tA, [], 10, 'A', d0), 10, 'A')

    const s = t0.days[0].stops
    const tB = { ...t0, days: [{ stops: [s[0], stop('food', 60, { id: 'new' }), s[1], s[2]] }] }
    const dB = diffInto(d0, tripToDoc(tB, [], 11, 'B', d0), 11, 'B')

    const tC = { ...t0, party: { ...t0.party, pets: [dog()] } }
    const dC = diffInto(d0, tripToDoc(tC, [], 12, 'C', d0), 12, 'C')

    // B 插站没有改动 p2 这条记录，所以不会和 A 的打卡撞车
    expect(dB['stop:p2']).toBe(d0['stop:p2'])

    const merged = mergeDocs(mergeDocs(dA, dB), dC)
    expect(mergeDocs(dC, mergeDocs(dB, dA))).toEqual(merged) // 合并顺序无关
    const { trip: m } = docToTrip(merged)
    expect(m.days[0].stops.map(x => x.id)).toEqual(['p1', 'new', 'p2', 'p3'])
    expect(m.days[0].stops.find(x => x.id === 'p2')?.status).toBe('done')
    expect(m.party.pets.length).toBe(1)
  })

  it('删除留墓碑，旧设备合并回来也不会复活', () => {
    const t0 = base()
    const d0 = tripToDoc(t0, [], 1, 'init')
    const t1 = { ...t0, days: [{ stops: t0.days[0].stops.filter(s => s.id !== 'p2') }] }
    const d1 = diffInto(d0, tripToDoc(t1, [], 5, 'A', d0), 5, 'A')
    expect(d1['stop:p2'].v).toBeNull()
    const { trip: m } = docToTrip(mergeDocs(d0, d1))
    expect(m.days[0].stops.map(x => x.id)).toEqual(['p1', 'p3'])
  })
})
