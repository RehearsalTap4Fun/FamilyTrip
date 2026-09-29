// 自己多台设备之间的同步（与饮食日记同一套：同步码派生 id 与密钥，服务器只存密文）。
// 同步的是：自己建的行程、红黑榜、家庭成员、偏好（风格、用哪家大模型、现居地）。不同步：各种 Key、示例行程、当前看的是哪趟、演示时间。
// 家庭成员逐人合并：每人一条记录各自后写赢（两台设备分别改了外婆和朵朵，两边的改动都留下），删掉的留墓碑。
//
// 行程不整份覆盖：每趟拆成扁平记录（tripDoc.ts），每条各自后写赢；删掉一趟留墓碑。
// 时间戳在本机改完 4 秒内打上（stamp），离线也照打，所以离线改的东西按改的时刻参与合并，而不是按联网那一刻。
import type { Rating } from '@core/ratings'
import type { Roster } from '@core/roster'
import type { Member, Pet, Trip } from '@core/types'
import { sampleTrips, type AppState, type Theme } from '../store/state'
import { diffInto, docToTrip, mergeDocs, tripToDoc, type Rec, type TripDoc } from './tripDoc'

/** roster 只在旧版（2026-09-29 逐人合并以前）的偏好里出现：读的时候兜底，不再写 */
export interface Prefs { theme?: Theme; llmProvider?: 'anthropic' | 'deepseek'; home?: AppState['home']; roster?: AppState['roster'] }

export interface SyncState {
  v: 1
  /** 每趟自己建的行程一份文档，键是行程 id */
  trips: Record<string, TripDoc>
  /** 删掉的行程：删的时刻晚于这趟最后一次改动才算删掉（删了之后别人又改过，就留下） */
  gone: Record<string, { t: number; by: string }>
  /** 红黑榜：rating:<id> → 记录 */
  ratings: TripDoc
  /** 旧版：偏好整条后写赢。照写一份给还没更新的设备读；新版读 pref */
  prefs?: Rec<Prefs>
  /** 偏好逐项：pref:theme / pref:llmProvider / pref:home，清掉的记 null。各自后写赢，改风格不会冲掉别的设备设的现居地 */
  pref?: TripDoc
  /** 家庭成员：member:<id> / pet:<id> → 这个人的资料和排第几 */
  people?: TripDoc
  /** 分享出去 / 加入的行程：自己几台设备之间只同步「有这一趟、分享码是什么」，内容走分享那一路（share.ts）；null 是退出了 */
  shared?: Record<string, Rec<SharedRef | null>>
}

export interface SharedRef { code: string; role: 'owner' | 'member'; title: string }

export const emptySync = (): SyncState => ({ v: 1, trips: {}, gone: {}, ratings: {} })

const newer = (a: { t: number; by: string }, b: { t: number; by: string }) => a.t > b.t || (a.t === b.t && a.by > b.by)
const lastEdit = (doc: TripDoc) => Object.values(doc).reduce((m, r) => Math.max(m, r.t), 0)
const ownTrips = (s: AppState) => s.trips.filter(t => !t.sample)
const ratingsDoc = (rs: Rating[], t: number, by: string): TripDoc => Object.fromEntries(rs.map(r => [`rating:${r.id}`, { v: r, t, by }]))
export const prefsOf = (s: AppState): Prefs => ({ ...(s.theme ? { theme: s.theme } : {}), ...(s.llmProvider ? { llmProvider: s.llmProvider } : {}), ...(s.home ? { home: s.home } : {}) })

/** 逐项的偏好；没设的记 null，这样「清掉」也能同步过去 */
export function prefDoc(s: Pick<AppState, 'theme' | 'llmProvider' | 'home'>, t: number, by: string): TripDoc {
  return { 'pref:theme': { v: s.theme ?? null, t, by }, 'pref:llmProvider': { v: s.llmProvider ?? null, t, by }, 'pref:home': { v: s.home ?? null, t, by } }
}

type Person<T> = T & { order: number }

/** 家庭成员拆成一人一条；order 记排第几，合并后按它排回去 */
export function peopleDoc(r: Roster | undefined, t: number, by: string): TripDoc {
  if (!r) return {}
  return Object.fromEntries([
    ...r.members.map((m, i) => [`member:${m.id}`, { v: { ...m, order: i }, t, by }]),
    ...r.pets.map((x, i) => [`pet:${x.id}`, { v: { ...x, order: i }, t, by }]),
  ])
}

/** 合并后的家庭成员；一条都没有就返回 undefined（交给旧版偏好兜底） */
export function rosterOf(doc: TripDoc | undefined): Roster | undefined {
  if (!doc || !Object.keys(doc).length) return undefined
  const pick = <T,>(prefix: string) => Object.entries(doc).filter(([k, r]) => k.startsWith(prefix) && r.v !== null).map(([, r]) => r.v as Person<T> & { id: string })
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1)).map(({ order: _o, ...x }) => x as unknown as T)
  return { members: pick<Member>('member:'), pets: pick<Pet>('pet:') }
}

/**
 * 本机哪些改动要触发同步（改动后 4 秒推一次）：和 stamp 同步的内容一一对应——自己的行程、红黑榜、偏好、家庭成员。
 * 放在这里和 stamp 挨着，加了新的同步内容别忘了这里
 */
export function syncWatch(s: AppState): string {
  return JSON.stringify([s.trips.filter(t => !t.sample), s.ratings, prefsOf(s), s.roster ?? null])
}

/** 本机改动打时间戳：和上一次记下的版本比，只有真的变了的记录才换成新时刻 */
export function stamp(prev: SyncState, s: AppState, now: number, by: string): SyncState {
  const trips: Record<string, TripDoc> = { ...prev.trips }
  const gone = { ...prev.gone }
  const shared: Record<string, Rec<SharedRef | null>> = { ...(prev.shared ?? {}) }
  const here = new Set<string>()
  for (const t of ownTrips(s)) {
    here.add(t.id)
    if (t.share) {
      // 共享的这趟：只记引用，内容走分享那一路
      const ref: SharedRef = { code: t.share.code, role: t.share.role, title: t.title }
      const old = shared[t.id]
      if (!old || JSON.stringify(old.v) !== JSON.stringify(ref)) shared[t.id] = { v: ref, t: now, by }
    } else {
      const old = prev.trips[t.id] ?? {}
      trips[t.id] = diffInto(old, tripToDoc(t, [], now, by, old), now, by)
      // 停止分享、行程留下：引用作废
      if (shared[t.id]?.v) shared[t.id] = { v: null, t: now, by }
    }
    // 删掉之后又在这台设备上恢复（撤销）了：去掉墓碑
    if (gone[t.id]) delete gone[t.id]
  }
  for (const id of Object.keys(prev.trips)) {
    if (!here.has(id) && !prev.gone[id] && lastEdit(prev.trips[id]) > 0) gone[id] = { t: now, by }
  }
  // 共享的那趟在这台设备上删了：等于退出，几台设备一起退出（好友那边不受影响）
  for (const [id, r] of Object.entries(shared)) if (r.v && !here.has(id)) shared[id] = { v: null, t: now, by }
  const ratings = diffInto(prev.ratings, ratingsDoc(s.ratings, now, by), now, by)
  const p = prefsOf(s)
  const prefs = prev.prefs && JSON.stringify(prev.prefs.v) === JSON.stringify(p) ? prev.prefs : { v: p, t: now, by }
  // 刚从旧版升上来、还没有逐项记录：按旧版整条偏好的时刻生成，免得没改过的项也按现在算、冲掉别的设备改的
  const prevPref = prev.pref ?? (prev.prefs ? prefDoc(prev.prefs.v ?? {}, prev.prefs.t, prev.prefs.by) : {})
  const pref = diffInto(prevPref, prefDoc(s, now, by), now, by)
  const people = diffInto(prev.people ?? {}, peopleDoc(s.roster, now, by), now, by)
  return { v: 1, trips, gone, ratings, prefs, pref, ...(Object.keys(people).length ? { people } : {}), ...(Object.keys(shared).length ? { shared } : {}) }
}

export function mergeSync(a: SyncState, b: SyncState): SyncState {
  const trips: Record<string, TripDoc> = { ...a.trips }
  for (const [id, doc] of Object.entries(b.trips)) trips[id] = trips[id] ? mergeDocs(trips[id], doc) : doc
  const gone = { ...a.gone }
  for (const [id, g] of Object.entries(b.gone)) if (!gone[id] || newer(g, gone[id])) gone[id] = g
  const prefs = !a.prefs ? b.prefs : !b.prefs ? a.prefs : newer(b.prefs, a.prefs) ? b.prefs : a.prefs
  const shared = { ...(a.shared ?? {}) }
  for (const [id, r] of Object.entries(b.shared ?? {})) if (!shared[id] || newer(r, shared[id])) shared[id] = r
  const people = mergeDocs(a.people ?? {}, b.people ?? {})
  const pref = mergeDocs(a.pref ?? {}, b.pref ?? {})
  return { v: 1, trips, gone, ratings: mergeDocs(a.ratings, b.ratings), ...(prefs ? { prefs } : {}), ...(Object.keys(pref).length ? { pref } : {}), ...(Object.keys(people).length ? { people } : {}), ...(Object.keys(shared).length ? { shared } : {}) }
}

/** 还活着的行程：没有墓碑，或墓碑早于最后一次改动 */
export function liveTrips(st: SyncState): Trip[] {
  return Object.entries(st.trips)
    // 共享的那趟内容走分享那一路，这里的旧文档不算
    .filter(([id, doc]) => doc.meta && !st.shared?.[id]?.v && (!st.gone[id] || lastEdit(doc) > st.gone[id].t))
    .map(([, doc]) => docToTrip(doc).trip)
}

/** 合并结果写回应用：示例行程、Key、当前看的哪趟、演示时间都留在本机 */
export function applySync(s: AppState, st: SyncState): AppState {
  const synced = liveTrips(st)
  const byId = new Map(synced.map(t => [t.id, t]))
  // 共享的：本机有就留着（内容由分享那一路管）；没有就先放个占位，分享那一路随后填满
  const refs = Object.entries(st.shared ?? {}).filter(([, r]) => r.v).map(([id, r]) => [id, r.v as SharedRef] as const)
  for (const [id, ref] of refs) {
    const local = s.trips.find(t => t.id === id)
    byId.set(id, local && !local.sample ? { ...local, share: { code: ref.code, role: ref.role } } : stubTrip(id, ref))
  }
  const all = [...byId.values()]
  // 保持本机原来的先后，新来的排后面
  const trips = [
    ...s.trips.filter(t => t.sample || byId.has(t.id)).map(t => (t.sample ? t : byId.get(t.id)!)),
    ...all.filter(t => !s.trips.some(x => x.id === t.id)),
  ]
  const ratings = Object.values(st.ratings).filter(r => r.v !== null).map(r => r.v as Rating)
  // 旧版把家庭成员整份放在偏好里：逐人记录还没有时才用它
  const { roster: legacyRoster, ...legacyPrefs } = st.prefs?.v ?? {}
  // 偏好：有逐项记录就按逐项（null 是清掉了）；只有旧版整条的就铺上去
  const pv = (k: string) => st.pref?.[`pref:${k}`]
  const prefs: Partial<AppState> = st.pref && Object.keys(st.pref).length
    ? Object.fromEntries((['theme', 'llmProvider', 'home'] as const).filter(k => pv(k)).map(k => [k, pv(k)!.v ?? undefined]))
    : legacyPrefs
  // 逐人记录全是接入时按时刻 0 记下的本机旧资料、云端却有旧版的整份：以云端为准
  const onlyLocal = Object.values(st.people ?? {}).every(r => r.t === 0)
  const roster = (onlyLocal && legacyRoster) || rosterOf(st.people) || legacyRoster || s.roster
  // 一趟都不剩（示例也被删光了）：放回示例，不去复活删掉的
  const out: AppState = { ...s, trips: trips.length ? trips : sampleTrips(), ratings, ...prefs, ...(roster ? { roster } : {}) }
  if (!out.trips.some(t => t.id === out.currentId)) out.currentId = out.trips[0].id
  return out
}

/** 稳定的指纹：键排好序再序列化，用来判断要不要推送、要不要写回 */
export function fingerprint(st: SyncState): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort)
    if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, sort((x as Record<string, unknown>)[k])]))
    return x
  }
  return JSON.stringify(sort(st))
}

/** 另一台设备上加入了的共享行程，这台还没拉到内容时的占位 */
function stubTrip(id: string, ref: SharedRef): Trip {
  const d = new Date()
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { id, title: ref.title, startDate: today, party: { mode: 'selfDrive', members: [], pets: [] }, days: [{ startTime: '09:00', stops: [] }], share: { code: ref.code, role: ref.role } }
}
