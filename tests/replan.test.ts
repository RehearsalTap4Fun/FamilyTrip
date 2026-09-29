import { describe, expect, it } from 'vitest'
import { buildDayPrompt, mergeDraft, replanDay, type DayDraft } from '../src/llm/replanDay'
import { LlmError, parseLooseJson } from '../src/llm/client'
import { DayDraftSchema } from '../src/llm/replanDay'
import { aggregate } from '@core/ratings'
import { seedTrip } from '../src/data/seed'

const t = seedTrip()
const d3 = t.days[2]
const id = (name: string) => d3.stops.find(s => s.name === name)!.id
const drives = d3.stops.filter(s => s.kind === 'drive').map(s => s.id)

/** 把第 3 天原样照抄回来（当作「模型没改」） */
const echo = (): DayDraft => ({
  summary: '原样',
  stops: d3.stops.map(s => ({ ref: s.id, kind: s.kind, name: s.name, durationMin: s.durationMin, driveMin: s.driveMin ?? null, start: s.start ?? null, priority: s.priority ?? 2, why: '' })),
})

/** 在第一段大丽高速中间插一个 20 分钟的服务区，解决连续驾驶 */
const fixed = (): DayDraft => {
  const e = echo()
  const i = e.stops.findIndex(s => s.ref === drives[0])
  const first = { ...e.stops[i], durationMin: 70 }
  const second = { ...e.stops[i], ref: null, durationMin: 60 }
  e.stops.splice(i, 1, first, { ref: null, kind: 'rest', name: '牛街停车区', durationMin: 20, driveMin: null, start: null, priority: 2, why: '朵朵开够 70 分钟要停' }, second)
  // 加了停车会把定在 16:00 的黑龙潭挤出时间冲突，所以一并去掉固定时刻
  e.stops = e.stops.map(s => (s.name === '黑龙潭公园' ? { ...s, start: null } : s))
  e.summary = '大丽高速中间加一次停车'
  return e
}

describe('重排这一天：提示词', () => {
  it('带上同行、硬约束、已打卡标记、当前问题、黑榜和要求', () => {
    const places = aggregate([{ id: 'r', kind: 'food', name: '网红烤鱼', city: '丽江', verdict: 'black', note: '排队两小时', by: 'a', at: 1 }])
    const { system, user } = buildDayPrompt({ trip: t, dayIndex: 2, places, wishes: '别太赶' })
    expect(system).toContain('已打卡的站原样放在最前面')
    expect(user).toContain('76 岁老人')
    expect(user).toContain('连续驾驶 90 分钟内')
    expect(user).toContain(`ref=${id('喜洲古镇')}`)
    expect(user).toContain('【已打卡，不能动】')
    expect(user).toContain('连续开车约 130 分钟')
    expect(user).toContain('网红烤鱼（排队两小时）')
    expect(user).toContain('另外的要求：别太赶')
  })
})

describe('重排这一天：合并草案', () => {
  it('沿用的站保留坐标、标签和名称；新站拿新 id；打过卡的站不让动', () => {
    const draft = fixed()
    // 模型把已打卡的喜洲改了时长、还改了名字——都不能生效
    draft.stops[0] = { ...draft.stops[0], durationMin: 10, name: '别的名字' }
    let n = 0
    const merged = mergeDraft(t, 2, draft, () => 'new' + ++n).days[2].stops
    const xz = merged.find(s => s.id === id('喜洲古镇'))!
    expect(xz).toMatchObject({ name: '喜洲古镇', durationMin: 90, status: 'done', actualStart: '09:25' })
    expect(merged.find(s => s.id === id('黑龙潭公园'))?.poi).toEqual(d3.stops.find(s => s.name === '黑龙潭公园')?.poi)
    expect(merged.filter(s => s.id.startsWith('new')).map(s => s.name)).toEqual(['牛街停车区', '大丽高速 G5611'])
  })

  it('模型漏掉已打卡的站：补回最前面；非法时刻丢掉；时长夹在范围内', () => {
    const draft = echo()
    draft.stops = draft.stops.filter(s => s.ref !== id('喜洲古镇'))
    draft.stops[0] = { ...draft.stops[0], durationMin: 99999, start: '25:99' }
    const merged = mergeDraft(t, 2, draft, () => 'x').days[2].stops
    expect(merged[0].id).toBe(id('喜洲古镇'))
    expect(merged[1]).toMatchObject({ durationMin: 720, start: undefined })
  })
})

describe('重排这一天：修复循环', () => {
  it('第一版还有连续驾驶的问题 → 带着问题再问一次 → 取第二版', async () => {
    const prompts: string[] = []
    let calls = 0
    const caller = (async (_cfg: unknown, req: { user: string }) => {
      prompts.push(req.user)
      calls++
      return { data: calls === 1 ? echo() : fixed(), usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, usd: 0.01 }, model: 'fake' }
    }) as never
    let n = 0
    const r = await replanDay({ provider: 'anthropic', apiKey: 'k' }, { trip: t, dayIndex: 2 }, { caller, newId: () => 'n' + ++n })
    expect(r.attempts).toBe(2)
    expect(prompts[1]).toContain('你上一版排出来还有这些问题')
    expect(r.before.some(i => i.code === 'noDriveBreak')).toBe(true)
    expect(r.after.some(i => i.code === 'noDriveBreak')).toBe(false)
    expect(r.summary).toBe('大丽高速中间加一次停车')
    expect(r.usage.usd).toBeCloseTo(0.02)
  })

  it('一直修不好：最多问三次，交回问题最少的那一版', async () => {
    let calls = 0
    const caller = (async () => { calls++; return { data: echo(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, usd: 0 }, model: 'fake' } }) as never
    const r = await replanDay({ provider: 'anthropic', apiKey: 'k' }, { trip: t, dayIndex: 2 }, { caller })
    expect(calls).toBe(3)
    expect(r.after.length).toBeGreaterThan(0)
  })
})

describe('DeepSeek 的宽松解析', () => {
  it('去掉代码围栏、过 schema；结构不对给出可读原因', () => {
    const ok = parseLooseJson('```json\n' + JSON.stringify(fixed()) + '\n```', DayDraftSchema)
    expect(ok.stops.length).toBe(d3.stops.length + 2)
    expect(() => parseLooseJson('好的', DayDraftSchema)).toThrow(LlmError)
    expect(() => parseLooseJson('{"stops":[{"kind":"fly"}]}', DayDraftSchema)).toThrow('结构不对')
  })
})

describe('重排这一天：修复轮出错', () => {
  it('第二次调用抛错：交回第一版，不整次失败', async () => {
    let calls = 0
    const caller = (async () => {
      if (++calls === 2) throw new LlmError('模型没有返回 JSON', 'bad_output')
      return { data: echo(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, usd: 0 }, model: 'fake' }
    }) as never
    const r = await replanDay({ provider: 'deepseek', apiKey: 'k' }, { trip: t, dayIndex: 2 }, { caller })
    expect(calls).toBe(2)
    expect(r.attempts).toBe(2)
    expect(r.summary).toBe('原样')
  })

  it('给 DeepSeek 的结构说明里写明字段和枚举', async () => {
    const { jsonShape } = await import('../src/llm/client')
    const s = jsonShape(DayDraftSchema)
    for (const k of ['"stops"', '"summary"', '"why"', '"sight"', '"lodging"']) expect(s).toContain(k)
  })
})

describe('DeepSeek 报错带上原因', () => {
  it('400 时把接口给的原因带出来；余额不足直接说', async () => {
    const { callStructured } = await import('../src/llm/client')
    const orig = globalThis.fetch
    try {
      globalThis.fetch = (async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Invalid max_tokens value' } }) })) as unknown as typeof fetch
      await expect(callStructured({ provider: 'deepseek', apiKey: 'k' }, { system: 's', user: 'u', schema: DayDraftSchema })).rejects.toThrow('DeepSeek 返回错误（400）：Invalid max_tokens value')
      globalThis.fetch = (async () => ({ ok: false, status: 402, json: async () => ({}) })) as unknown as typeof fetch
      await expect(callStructured({ provider: 'deepseek', apiKey: 'k' }, { system: 's', user: 'u', schema: DayDraftSchema })).rejects.toThrow('余额不足')
    } finally { globalThis.fetch = orig }
  })
})
