// 家庭成员预设：每个人、每只宠物的资料只维护一份（身份、年龄、行动能力、会不会开车、体型），新建行程时从这里勾谁去。
// 行程里存的是勾选时的一份拷贝（加上只属于这趟的「哪几天在」）：分享出去的行程自带完整信息，去年那趟里孩子的年龄也不会跟着变。
// 改了预设，只对还没结束的行程问一句要不要同步。
import { sortTrips, tripStatus } from './trips'
import type { Member, Party, Pet, Trip, TravelMode } from './types'

export interface Roster { members: Member[]; pets: Pet[] }

const strip = <T extends { days?: unknown }>(x: T): T => { const { days: _d, ...rest } = x; return rest as T }

/** 从已有行程里收集人：同一个 id 以最相关的那趟为准（进行中 > 最近出发 > 最近去过），去掉「哪几天在」 */
export function rosterFromTrips(trips: Trip[], now: Date): Roster {
  const members: Member[] = [], pets: Pet[] = []
  for (const t of sortTrips(trips, now)) {
    for (const m of t.party.members) if (!members.some(x => x.id === m.id)) members.push(strip(m))
    for (const p of t.party.pets) if (!pets.some(x => x.id === p.id)) pets.push(strip(p))
  }
  return { members, pets }
}

/** 勾了谁：按预设的顺序拿出这几位，组成这趟的同行（一个人都没勾时至少有个「我」） */
export function pickFromRoster(r: Roster, ids: Set<string>, mode: TravelMode): Party {
  const members = r.members.filter(m => ids.has(m.id)).map(strip)
  return { mode, members: members.length ? members : [{ id: 'me', name: '我', role: 'adult', driver: true }], pets: r.pets.filter(p => ids.has(p.id)).map(strip) }
}

/** 最相关的那趟都有谁（「和上次一样」） */
export function lastPartyIds(trips: Trip[], now: Date): string[] {
  const t = sortTrips(trips, now)[0]
  return t ? [...t.party.members, ...t.party.pets].map(x => x.id) : []
}

/** 两份资料除了「哪几天在」是不是一样 */
export function samePerson<T extends Member | Pet>(a: T, b: T): boolean {
  return JSON.stringify(strip(a), Object.keys(strip(a)).sort()) === JSON.stringify(strip(b), Object.keys(strip(b)).sort()) && Object.keys(strip(a)).length === Object.keys(strip(b)).length
}

/** 预设里的这个人改了之后，哪些还没结束的行程里有他、而且资料和预设不一样 */
export function staleTrips(trips: Trip[], person: Member | Pet, now: Date): Trip[] {
  return trips.filter(t => tripStatus(t, now) !== 'done' && !t.sample && [...t.party.members, ...t.party.pets].some(x => x.id === person.id && !samePerson(x, person)))
}

/** 把预设里的资料写进这趟：只换资料，这趟的「哪几天在」留着 */
export function applyPerson(t: Trip, person: Member | Pet): Trip {
  const put = <T extends Member | Pet>(x: T): T => (x.id === person.id ? ({ ...(person as T), ...(x.days ? { days: x.days } : {}) }) : x)
  return { ...t, party: { ...t.party, members: t.party.members.map(put), pets: t.party.pets.map(put) } }
}
