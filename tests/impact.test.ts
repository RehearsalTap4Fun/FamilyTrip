import { describe, expect, it } from 'vitest'
import { dayImpact, daysLabel, partyImpact } from '../src/ui/impact'
import { seedTrip } from '../src/data/seed'

describe('改动的影响', () => {
  it('外婆从「走得慢」改成「拄拐」：步行上限在她在的几天从 4 收到 2', () => {
    const t = seedTrip()
    const after = { ...t.party, members: t.party.members.map(m => (m.id === 'waipo' ? { ...m, mobility: 'cane' as const } : m)) }
    const imp = partyImpact(t, after)
    const walk = imp.limits.find(l => l.label === '步行')!
    expect(walk).toMatchObject({ from: '4km', to: '2km', tighter: true, who: ['外婆'], days: [1, 2, 3, 4] })
    expect(daysLabel(walk.days, t.days.length)).toBe('第 2–5 天')
  })

  it('去掉唯一的两位司机中的一位：驾驶上限收紧；两位都去掉：出现「没有司机」', () => {
    const t = seedTrip()
    const one = { ...t.party, members: t.party.members.map(m => (m.id === 'lin' ? { ...m, driver: false } : m)) }
    expect(partyImpact(t, one).limits.find(l => l.label === '每天驾驶')).toMatchObject({ from: '8h', to: '5h', tighter: true })
    const none = { ...t.party, members: t.party.members.map(m => ({ ...m, driver: false })) }
    expect(partyImpact(t, none).blockers).toEqual(['没有司机'])
  })

  it('第 3 天在大丽高速中间加一个 20 分钟服务区：连续驾驶解决了，但定在 16:00 的黑龙潭被挤出时间冲突', () => {
    const t = seedTrip()
    const d = t.days[2]
    const i = d.stops.findIndex(s => s.kind === 'drive')
    const drive = d.stops[i]
    const stops = [...d.stops.slice(0, i), { ...drive, durationMin: 45 }, { id: 'rest-new', kind: 'rest' as const, name: '新服务区', durationMin: 20 }, { ...drive, id: 'drive-2', durationMin: 85 }, ...d.stops.slice(i + 1)]
    const after = { ...t, days: t.days.map((x, k) => (k === 2 ? { ...x, stops } : x)) }
    const imp = dayImpact(t, after, 2)
    expect(imp.fixed.map(x => x.short)).toEqual(['连开 130/90 分'])
    expect(imp.added.map(x => x.code + ':' + x.short)).toEqual(['overlap:时间冲突'])
  })

  it('问题还在但数字变了：连开 130 → 115', () => {
    const t = seedTrip()
    const d = t.days[2]
    const drive = d.stops.find(s => s.kind === 'drive')!
    const after = { ...t, days: t.days.map((x, k) => (k === 2 ? { ...x, stops: x.stops.map(s => (s.id === drive.id ? { ...s, durationMin: 115 } : s)) } : x)) }
    expect(dayImpact(t, after, 2).changed.map(c => `${c.from.short}→${c.to.short}`)).toEqual(['连开 130/90 分→连开 115/90 分'])
  })

  it('天数标签', () => {
    expect(daysLabel([0, 1, 2, 3, 4], 5)).toBe('全程')
    expect(daysLabel([0, 2, 3], 5)).toBe('第 1、3–4 天')
  })
})
