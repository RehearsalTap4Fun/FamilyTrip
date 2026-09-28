import { describe, expect, it } from 'vitest'
import { deriveKeys, generateSyncCode } from '../src/sync/crypto'
import { applyShare, inviteLink, joinCodeFromHash, mergeShare, shareFp, shareKeys, stampShare, type ShareBlob } from '../src/sync/share'
import { syncBlob, SyncError, type RemoteRec } from '../src/sync/client'
import { applySync, emptySync, liveTrips, mergeSync, stamp } from '../src/sync/account'
import { docToTrip } from '../src/sync/tripDoc'
import { defaultState, type AppState } from '../src/store/state'
import { seedTrip } from '../src/data/seed'
import type { Rating } from '@core/ratings'
import type { Trip } from '@core/types'

const code = 'ABCD-EFGH-JKLM-NPQR-STUV-WXYZ'
const trip = (): Trip => ({ ...seedTrip(), id: 'jt', title: '国庆大理', sample: undefined, share: { code, role: 'owner' } })
const rating = (id: string, tripId = 'jt'): Rating => ({ id, kind: 'food', name: id, verdict: 'red', by: 'me', at: 1, tripId })

function fakeServer() {
  const db = new Map<string, RemoteRec>()
  const f = (async (url: string, init?: RequestInit) => {
    const id = /\/sync\/([a-f0-9]{64})/.exec(url)![1]
    const cur = db.get(id) ?? { version: 0, blob: null, updatedAt: 0 }
    const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as Response
    if (init?.method === 'DELETE') { db.delete(id); return json(200, { ok: true }) }
    if (!init?.method || init.method === 'GET') return json(200, cur)
    const j = JSON.parse(String(init.body))
    if (j.baseVersion !== cur.version) return json(409, cur)
    db.set(id, { version: cur.version + 1, blob: j.blob, updatedAt: 1 })
    return json(200, { version: cur.version + 1 })
  }) as unknown as typeof fetch
  return { f, db }
}

describe('分享码', () => {
  it('同一串码：做同步码和做分享码派生出的 id 不同，互不相通', () => {
    expect(shareKeys(code).id).not.toBe(deriveKeys(code).id)
    expect(shareKeys(code.toLowerCase()).id).toBe(shareKeys(code).id)
  })

  it('邀请链接把码放在 # 后面；能从链接里读回来', () => {
    const c = generateSyncCode()
    expect(inviteLink(c)).toBe(`https://47.109.97.108/trip/#join=${c}`)
    expect(joinCodeFromHash(`#join=${c}`)).toBe(c)
    expect(joinCodeFromHash('#trip')).toBeNull()
  })
})

describe('几个人一起改一趟', () => {
  it('A 打卡、B 加一站、C 加一只狗：三个人各自同步后全都合上', async () => {
    const srv = fakeServer()
    const opts = { fetchImpl: srv.f, apiBase: 'http://x' }
    const base = stampShare({}, trip(), [], 1000, 'owner')
    await syncBlob<ShareBlob>({ v: 1, doc: base }, shareKeys(code), mergeShare, shareFp, opts)
    const t0 = docToTrip(base).trip
    // A：第一天第一站打卡
    const tA: Trip = { ...t0, days: t0.days.map((d, i) => (i === 0 ? { ...d, stops: d.stops.map((s, j) => (j === 0 ? { ...s, status: 'done' as const } : s)) } : d)) }
    // B：第二天最后加一站
    const tB: Trip = { ...t0, days: t0.days.map((d, i) => (i === 1 ? { ...d, stops: [...d.stops, { id: 'newstop', kind: 'food' as const, name: 'B 加的饭馆', durationMin: 60, status: 'planned' as const }] } : d)) }
    // C：带上一只猫
    const tC: Trip = { ...t0, party: { ...t0.party, pets: [...t0.party.pets, { id: 'cat', name: '咪咪', kind: 'cat', size: 'small' } as never] } }
    for (const [t, by, at] of [[tA, 'A', 2000], [tB, 'B', 2100], [tC, 'C', 2200]] as const) {
      await syncBlob<ShareBlob>({ v: 1, doc: stampShare(base, t, [], at, by) }, shareKeys(code), mergeShare, shareFp, opts)
    }
    const final = await syncBlob<ShareBlob>({ v: 1, doc: base }, shareKeys(code), mergeShare, shareFp, opts)
    const got = docToTrip(final.merged.doc).trip
    expect(got.days[0].stops[0].status).toBe('done')
    expect(got.days[1].stops.some(s => s.name === 'B 加的饭馆')).toBe(true)
    expect(got.party.pets.some(p => p.name === '咪咪')).toBe(true)
  })

  it('这趟的红黑榜一起共享（别人删了这边也删）；别的行程的红黑榜不带出去', () => {
    const s0: AppState = { ...defaultState(), trips: [...defaultState().trips, trip()], ratings: [rating('keep'), rating('drop'), rating('other', 'x')] }
    const doc1 = stampShare({}, trip(), s0.ratings, 1000, 'me')
    expect(Object.keys(doc1).filter(k => k.startsWith('rating:')).sort()).toEqual(['rating:drop', 'rating:keep'])
    // 好友删了 drop、加了 new
    const doc2 = stampShare(doc1, trip(), [rating('keep'), rating('new')], 2000, 'friend')
    const out = applyShare(s0, 'jt', mergeShare({ v: 1, doc: doc1 }, { v: 1, doc: doc2 }).doc)
    expect(out.ratings.map(r => r.id).sort()).toEqual(['keep', 'new', 'other'])
    expect(out.trips.find(t => t.id === 'jt')!.share).toEqual({ code, role: 'owner' })
  })

  it('对方停止分享、删了云端：同步过的一方不会再推回去', async () => {
    const srv = fakeServer()
    const opts = { fetchImpl: srv.f, apiBase: 'http://x' }
    await expect(syncBlob<ShareBlob>({ v: 1, doc: stampShare({}, trip(), [], 1, 'a') }, shareKeys(code), mergeShare, shareFp, { ...opts, onEmpty: 'gone' }))
      .rejects.toMatchObject({ kind: 'gone' } satisfies Partial<SyncError>)
    expect(srv.db.size).toBe(0)
  })
})

describe('和自己多设备同步的关系', () => {
  it('共享的那趟：账号同步里只有引用，没有内容；另一台设备先放占位；退出时几台设备一起退出', () => {
    const mine: AppState = { ...defaultState(), trips: [...defaultState().trips, trip()] }
    const A = stamp(emptySync(), mine, 1000, 'devA')
    expect(A.trips.jt).toBeUndefined()
    expect(A.shared?.jt?.v).toEqual({ code, role: 'owner', title: '国庆大理' })
    const other = applySync(defaultState(), mergeSync(emptySync(), A))
    const stub = other.trips.find(t => t.id === 'jt')!
    expect(stub.share).toEqual({ code, role: 'owner' })
    expect(stub.title).toBe('国庆大理')
    // A 上删了这趟 = 退出：引用变 null，另一台也去掉
    const A2 = stamp(A, defaultState(), 2000, 'devA')
    expect(A2.shared?.jt?.v).toBeNull()
    expect(applySync(other, mergeSync(stamp(emptySync(), other, 1500, 'devB'), A2)).trips.some(t => t.id === 'jt')).toBe(false)
  })

  it('停止分享、行程留下：回到普通行程，内容照常在几台设备间同步', () => {
    const mine: AppState = { ...defaultState(), trips: [...defaultState().trips, trip()] }
    const A = stamp(emptySync(), mine, 1000, 'devA')
    const stopped: AppState = { ...mine, trips: mine.trips.map(t => (t.id === 'jt' ? { ...t, share: undefined } : t)) }
    const A2 = stamp(A, stopped, 2000, 'devA')
    expect(A2.shared?.jt?.v).toBeNull()
    expect(liveTrips(A2).map(t => t.id)).toEqual(['jt'])
  })
})
