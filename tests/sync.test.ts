import { describe, expect, it } from 'vitest'
import { applySync, emptySync, fingerprint, liveTrips, mergeSync, peopleDoc, stamp, type SyncState } from '../src/sync/account'
import { decryptJson, deriveKeys, encryptJson, generateSyncCode, normalizeSyncCode } from '../src/sync/crypto'
import { syncOnce, type RemoteRec } from '../src/sync/client'
import { backupFileName, exportBackup, importBackup } from '../src/store/backup'
import { defaultState, type AppState } from '../src/store/state'
import { seedTrip } from '../src/data/seed'
import type { Trip } from '@core/types'

const mine = (id: string, title = id): Trip => ({ ...seedTrip(), id, title, sample: undefined })
const withTrips = (trips: Trip[], extra: Partial<AppState> = {}): AppState => {
  const d = defaultState()
  return { ...d, trips: [...d.trips, ...trips], ...extra }
}
const stopTitle = (t: Trip, day: number, i: number, name: string): Trip => ({ ...t, days: t.days.map((d, k) => (k === day ? { ...d, stops: d.stops.map((s, j) => (j === i ? { ...s, name } : s)) } : d)) })

describe('同步码与加密', () => {
  it('24 位分 6 组；手抄容错；派生 id 是 64 位十六进制；加解密往返；码不对解不开', () => {
    const code = generateSyncCode()
    expect(code).toMatch(/^([2-9A-HJ-NP-Z]{4}-){5}[2-9A-HJ-NP-Z]{4}$/)
    expect(normalizeSyncCode(code.toLowerCase().replace(/-/g, ' '))).toBe(code)
    expect(normalizeSyncCode('太短')).toBeNull()
    const k = deriveKeys(code)
    expect(k.id).toMatch(/^[a-f0-9]{64}$/)
    const blob = encryptJson(k, { 行程: '大理丽江' })
    expect(decryptJson(k, blob)).toEqual({ 行程: '大理丽江' })
    expect(() => decryptJson(deriveKeys(generateSyncCode()), blob)).toThrow()
  })

  it('和饮食日记的同步码互不相通：同一串码按饮食日记的盐派生出的 id 不一样', async () => {
    const { pbkdf2 } = await import('@noble/hashes/pbkdf2.js')
    const { sha256 } = await import('@noble/hashes/sha2.js')
    const { bytesToHex, utf8ToBytes } = await import('@noble/hashes/utils.js')
    const code = 'ABCD-EFGH-JKLM-NPQR-STUV-WXYZ'
    const nutri = bytesToHex(sha256(pbkdf2(sha256, utf8ToBytes(code), utf8ToBytes('nutri-sync-v1'), { c: 60000, dkLen: 64 }).slice(32)))
    expect(deriveKeys(code).id).not.toBe(nutri)
    expect(deriveKeys(code.toLowerCase()).id).toBe(deriveKeys(code).id)
  })
})

describe('打时间戳', () => {
  it('只同步自己建的行程；没改的记录不换时间戳，改了的才换', () => {
    const s = withTrips([mine('a')])
    const s1 = stamp(emptySync(), s, 1000, 'd1')
    expect(Object.keys(s1.trips)).toEqual(['a']) // 示例不同步
    const s2 = stamp(s1, { ...s, trips: s.trips.map(t => (t.id === 'a' ? stopTitle(t, 0, 0, '改名的第一站') : t)) }, 2000, 'd1')
    const changed = Object.entries(s2.trips.a).filter(([, r]) => r.t === 2000).map(([k]) => k)
    expect(changed).toHaveLength(1)
    expect(changed[0]).toMatch(/^stop:/)
    expect(s2.trips.a.meta.t).toBe(1000)
  })

  it('本机删掉一趟留墓碑；撤销（又回来了）墓碑去掉', () => {
    const s = withTrips([mine('a'), mine('b')])
    const s1 = stamp(emptySync(), s, 1000, 'd1')
    const s2 = stamp(s1, { ...s, trips: s.trips.filter(t => t.id !== 'b') }, 2000, 'd1')
    expect(s2.gone.b).toEqual({ t: 2000, by: 'd1' })
    expect(liveTrips(s2).map(t => t.id)).toEqual(['a'])
    const s3 = stamp(s2, s, 3000, 'd1')
    expect(s3.gone.b).toBeUndefined()
  })
})

describe('合并', () => {
  it('两台设备各改各的：A 改一站、B 新建一趟、B 改另一站，全保留', () => {
    const base = stamp(emptySync(), withTrips([mine('a')]), 1000, 'x')
    const tA = stopTitle(liveTrips(base)[0], 0, 0, 'A 改的')
    const A = stamp(base, withTrips([tA]), 2000, 'A')
    const tB = stopTitle(liveTrips(base)[0], 1, 0, 'B 改的')
    const B = stamp(base, withTrips([tB, mine('new', 'B 新建')]), 2100, 'B')
    const m = mergeSync(A, B)
    const a = liveTrips(m).find(t => t.id === 'a')!
    expect(a.days[0].stops[0].name).toBe('A 改的')
    expect(a.days[1].stops[0].name).toBe('B 改的')
    expect(liveTrips(m).map(t => t.title)).toContain('B 新建')
    expect(fingerprint(mergeSync(A, B))).toBe(fingerprint(mergeSync(B, A))) // 顺序无关
  })

  it('删了之后别人又改过这趟：留下；改动早于删除：删掉', () => {
    const base = stamp(emptySync(), withTrips([mine('a')]), 1000, 'x')
    const del = stamp(base, withTrips([]), 2000, 'A')
    const editLater = stamp(base, withTrips([stopTitle(liveTrips(base)[0], 0, 0, '后改的')]), 3000, 'B')
    expect(liveTrips(mergeSync(del, editLater)).map(t => t.id)).toEqual(['a'])
    const editEarlier = stamp(base, withTrips([stopTitle(liveTrips(base)[0], 0, 0, '先改的')]), 1500, 'B')
    expect(liveTrips(mergeSync(del, editEarlier))).toEqual([])
  })

  it('写回应用：示例、Key、当前看的哪趟、演示时间留在本机；偏好跟着同步', () => {
    const local = withTrips([mine('a')], { amapKey: 'k', llmKeys: { deepseek: 'x' }, theme: 'braun' })
    const remote = stamp(emptySync(), withTrips([mine('a', '云端改名'), mine('c')], { theme: 'atlas' }), 5000, 'R')
    const out = applySync({ ...local, currentId: 'a' }, mergeSync(stamp(emptySync(), local, 1000, 'L'), remote))
    expect(out.trips.filter(t => t.sample).length).toBe(local.trips.filter(t => t.sample).length)
    expect(out.trips.find(t => t.id === 'a')!.title).toBe('云端改名')
    expect(out.trips.some(t => t.id === 'c')).toBe(true)
    expect(out.amapKey).toBe('k')
    expect(out.llmKeys).toEqual({ deepseek: 'x' })
    expect(out.currentId).toBe('a')
    expect(out.theme).toBe('atlas')
  })
})

/** 内存里的同步服务：和服务端同一套版本号规则 */
function fakeServer() {
  const db = new Map<string, RemoteRec>()
  let conflictOnce = false
  const f = (async (url: string, init?: RequestInit) => {
    const id = /\/sync\/([a-f0-9]{64})/.exec(url)![1]
    const cur = db.get(id) ?? { version: 0, blob: null, updatedAt: 0 }
    const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as Response
    if (!init || !init.method || init.method === 'GET') return json(200, cur)
    const j = JSON.parse(String(init.body))
    if (conflictOnce) { conflictOnce = false; return json(409, cur) }
    if (j.baseVersion !== cur.version) return json(409, cur)
    const rec = { version: cur.version + 1, blob: j.blob, updatedAt: Date.now() }
    db.set(id, rec)
    return json(200, { version: rec.version })
  }) as unknown as typeof fetch
  return { f, db, conflict: () => { conflictOnce = true } }
}

describe('两台设备走一遍', () => {
  it('A 推上去；B 接入合并后推；A 再拉就拿到 B 的；都没改就谁也不推', async () => {
    const srv = fakeServer()
    const code = generateSyncCode()
    const opts = { fetchImpl: srv.f, apiBase: 'http://x' }
    const A0 = stamp(emptySync(), withTrips([mine('a', 'A 的行程')]), 1000, 'A')
    const r1 = await syncOnce(A0, code, opts)
    expect(r1).toMatchObject({ pushed: true, pulled: false, version: 1 })
    const B0 = stamp(emptySync(), withTrips([mine('b', 'B 的行程')]), 1100, 'B')
    const r2 = await syncOnce(B0, code, opts)
    expect(r2.pushed && r2.pulled).toBe(true)
    expect(liveTrips(r2.merged).map(t => t.title).sort()).toEqual(['A 的行程', 'B 的行程'])
    const r3 = await syncOnce(r1.merged, code, opts)
    expect(r3).toMatchObject({ pushed: false, pulled: true })
    const r4 = await syncOnce(r3.merged, code, opts)
    expect(r4).toMatchObject({ pushed: false, pulled: false })
  })

  it('家庭成员：A 改外婆、B 改朵朵，各自推拉一轮后两台都是两处改动', async () => {
    const srv = fakeServer()
    const code = generateSyncCode()
    const opts = { fetchImpl: srv.f, apiBase: 'http://x' }
    const d = defaultState()
    const idOf = (n: string) => d.roster!.members.find(m => m.name === n)!.id
    const put = (id: string, age: number): AppState => ({ ...d, roster: { ...d.roster!, members: d.roster!.members.map(m => (m.id === id ? { ...m, age } : m)) } })
    const A0 = stamp(emptySync(), d, 1000, 'A')
    const B0 = (await syncOnce(A0, code, opts), (await syncOnce(emptySync(), code, opts)).merged)
    const A1 = stamp(A0, put(idOf('外婆'), 80), 2000, 'A')
    const B1 = stamp(B0, put(idOf('朵朵'), 3), 2100, 'B')
    await syncOnce(A1, code, opts)
    const rb = await syncOnce(B1, code, opts)
    const ra = await syncOnce(A1, code, opts)
    for (const st of [rb.merged, ra.merged]) {
      const ages = applySync(d, st).roster!.members
      expect(ages.find(m => m.id === idOf('外婆'))!.age).toBe(80)
      expect(ages.find(m => m.id === idOf('朵朵'))!.age).toBe(3)
    }
  })

  it('推的时候版本冲突：再拉、再合并、再推', async () => {
    const srv = fakeServer()
    const code = generateSyncCode()
    const opts = { fetchImpl: srv.f, apiBase: 'http://x' }
    srv.conflict()
    const r = await syncOnce(stamp(emptySync(), withTrips([mine('a')]), 1000, 'A'), code, opts)
    expect(r.pushed).toBe(true)
    expect(r.version).toBe(1)
  })

  it('同步码不对：云端解不开，报可读的错', async () => {
    const srv = fakeServer()
    const code = generateSyncCode()
    await syncOnce(stamp(emptySync(), withTrips([mine('a')]), 1000, 'A'), code, { fetchImpl: srv.f, apiBase: 'http://x' })
    // 把另一个码的 id 指到同一份密文上：模拟码抄错但 id 碰上（实际不会发生），确认解不开时不会覆盖
    const other = generateSyncCode()
    srv.db.set(deriveKeys(other).id, [...srv.db.values()][0])
    await expect(syncOnce(emptySync(), other, { fetchImpl: srv.f, apiBase: 'http://x' })).rejects.toThrow('解不开')
  })
})

describe('存档', () => {
  it('导出不含 Key；导入原样恢复；认不出的给可读的错', () => {
    const s = withTrips([mine('a', '寒假')], { amapKey: 'secret-amap', llmKeys: { deepseek: 'secret-ds' }, zhipuKey: 'secret-zhipu' })
    const text = exportBackup(s, new Date('2026-09-28T10:00:00'))
    expect(text).not.toContain('secret-')
    const back = importBackup(text)
    expect(back.state.trips.find(t => t.id === 'a')!.title).toBe('寒假')
    expect(back.exportedAt).toBe(new Date('2026-09-28T10:00:00').toISOString())
    expect(() => importBackup('不是 json')).toThrow('JSON')
    expect(() => importBackup('{"app":"别的"}')).toThrow('看不懂')
    expect(backupFileName(new Date(2026, 8, 28, 9, 5))).toBe('同路存档-20260928-0905.json')
  })
})

// 类型用一下，免得 SyncState 只作类型导入被报未用
export type _S = SyncState

describe('家庭成员逐人合并', () => {
  const base = defaultState() // 示例里的一家：我、小林、外婆、朵朵 + 豆包
  const edit = (s: AppState, id: string, patch: Record<string, unknown>): AppState => ({ ...s, roster: { ...s.roster!, members: s.roster!.members.map(m => (m.id === id ? { ...m, ...patch } : m)) } })
  const names = (s: AppState) => s.roster!.members.map(m => `${m.name}${m.age != null ? m.age : ''}`)
  const gm = () => base.roster!.members.find(m => m.name === '外婆')!.id
  const kid = () => base.roster!.members.find(m => m.name === '朵朵')!.id
  const start = stamp(emptySync(), base, 1000, 'A')

  it('两台设备分别改了不同的人：两边的改动都留下，顺序不变', () => {
    const a = stamp(start, edit(base, gm(), { age: 80 }), 2000, 'A')
    const b = stamp(start, edit(base, kid(), { age: 3 }), 3000, 'B')
    const out = applySync(base, mergeSync(a, b))
    expect(names(out)).toEqual(names(base).map(n => n.replace(/^外婆\d+/, '外婆80').replace(/^朵朵\d+/, '朵朵3')))
  })

  it('两台设备改了同一个人：后改的那台为准', () => {
    const a = stamp(start, edit(base, gm(), { age: 80 }), 3000, 'A')
    const b = stamp(start, edit(base, gm(), { age: 81, mobility: 'cane' }), 2000, 'B')
    const g = applySync(base, mergeSync(a, b)).roster!.members.find(m => m.id === gm())!
    expect(g.age).toBe(80)
    expect(g.mobility).toBe(base.roster!.members.find(m => m.id === gm())!.mobility) // 整个人以 A 为准，不拼字段
  })

  it('A 删了一个人、B 加了一个人：删的删掉，加的加上', () => {
    const del: AppState = { ...base, roster: { ...base.roster!, members: base.roster!.members.filter(m => m.id !== kid()) } }
    const a = stamp(start, del, 2000, 'A')
    const add: AppState = { ...base, roster: { ...base.roster!, members: [...base.roster!.members, { id: 'grandpa', name: '外公', role: 'elder', age: 78 }] } }
    const b = stamp(start, add, 2500, 'B')
    const out = applySync(base, mergeSync(a, b))
    expect(out.roster!.members.map(m => m.name)).not.toContain('朵朵')
    const ns = out.roster!.members.map(m => m.name)
    expect(ns[ns.length - 1]).toBe('外公')
  })

  it('新设备接入：本机从示例迁移来的旧资料不盖掉云端改过的；云端没有的人照样并进去', () => {
    const cloud = stamp(start, edit(base, gm(), { age: 80 }), 5000, 'A')
    const local: AppState = { ...base, roster: { ...base.roster!, members: [...base.roster!.members, { id: 'aunt', name: '小姨', role: 'adult' }] } }
    // 接入时的起点：本机的家庭成员按时刻 0 记（useCloudSync.enable 的 join）
    const joinBase = { ...emptySync(), people: peopleDoc(local.roster, 0, '') }
    const mineNow = stamp(joinBase, local, 9000, 'B')
    const out = applySync(local, mergeSync(cloud, mineNow))
    expect(out.roster!.members.find(m => m.id === gm())!.age).toBe(80)
    expect(out.roster!.members.map(m => m.name)).toContain('小姨')
  })

  it('旧版云端数据（家庭成员整份放在偏好里）照样读得出来', () => {
    const legacy: SyncState = { ...emptySync(), prefs: { v: { roster: { members: [{ id: 'x', name: '旧版的人', role: 'adult' }], pets: [] } }, t: 100, by: 'A' } }
    expect(applySync(base, legacy).roster!.members.map(m => m.name)).toEqual(['旧版的人'])
  })
})
