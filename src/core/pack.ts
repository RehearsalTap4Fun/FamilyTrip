// 按这趟的人、出行方式、每天去的地方，整理必须带上的证件和装备。
// 文案每次现算，不存进行程；勾选、去掉、自己加的记在 trip.pack，行程改了也对得上。
import { deriveConstraints } from './constraints'
import { whoFor } from './explain'
import { kidBand, needsChildSeat, partyOnDay } from './party'
import type { PackItem, PackKind, PackState, Stop, Trip } from './types'

const KINDS: PackKind[] = ['doc', 'gear', 'wear', 'care']

export const PACK_KIND: Record<PackKind, string> = { doc: '证件', gear: '设备', wear: '穿着', care: '照护' }

/** 「第 2、4–5 天」。覆盖全程时返回空，调用方自己决定要不要写「每天」 */
export function dayNote(days: number[] | undefined, total: number): string {
  if (!days?.length || days.length >= total) return ''
  const s = [...new Set(days)].sort((a, b) => a - b)
  const parts: string[] = []
  let i = 0
  while (i < s.length) {
    let j = i
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++
    parts.push(i === j ? String(s[i] + 1) : `${s[i] + 1}–${s[j] + 1}`)
    i = j + 1
  }
  return '第' + parts.join('、') + '天'
}

function join(names: string[], max = 3): string {
  const u = [...new Set(names.filter(Boolean))]
  const s = u.slice(0, max).join('、')
  return u.length > max ? s + '等' : s
}

function active(trip: Trip, day: number): Stop[] {
  return trip.days[day].stops.filter(s => s.status !== 'skipped')
}

/** 境外：有国家码且不是中国大陆；或坐标明显在国外。港澳台单独算通行证 */
function abroad(s: Stop): 'hk' | 'mo' | 'tw' | 'foreign' | null {
  const cc = s.poi?.cc
  if (cc === 'HK') return 'hk'
  if (cc === 'MO') return 'mo'
  if (cc === 'TW') return 'tw'
  if (cc && cc !== 'CN') return 'foreign'
  if (s.poi && !s.poi.adcode && !s.poi.cc) {
    const { lng, lat } = s.poi
    if (lng < 72 || lng > 136 || lat < 3 || lat > 54) return 'foreign'
  }
  return null
}

function cite(stops: Stop[]): string {
  return join(stops.map(s => s.name), 2)
}

interface Draft { id: string; name: string; kind: PackKind; why: string; days?: number[] }

function suggest(trip: Trip): Draft[] {
  const n = trip.days.length
  const all = Array.from({ length: n }, (_, i) => i)
  const out: Draft[] = []
  const add = (d: Draft) => { if (d.days && !d.days.length) return; out.push(d) }
  if (!n) {
    add({ id: 'doc.id', name: '身份证', kind: 'doc', why: '住宿登记、景区不少要实名' })
    add({ id: 'gear.power', name: '充电线和充电宝', kind: 'gear', why: '导航、订票、打卡都靠手机' })
    return out
  }

  const stopsOf = (day: number) => active(trip, day)
  const every = stopsOf(0).concat(...all.slice(1).map(stopsOf))
  const located = every.filter(s => s.poi)
  const foreignDays = (kind: 'hk' | 'mo' | 'tw' | 'foreign') => all.filter(i => stopsOf(i).some(s => abroad(s) === kind))
  const hk = foreignDays('hk').concat(foreignDays('mo'))
  const tw = foreignDays('tw')
  const oversea = foreignDays('foreign')
  const leave = [...new Set([...hk, ...tw, ...oversea])]
  const mainland = located.some(s => !abroad(s)) || every.some(s => !s.poi) || located.length === 0

  if (trip.party.mode === 'selfDrive' && mainland) {
    add({ id: 'doc.papers', name: '身份证、驾驶证和行驶证', kind: 'doc', why: '住宿登记、景区实名，路上查车也要看', days: all })
  } else {
    if (mainland) add({ id: 'doc.id', name: '身份证', kind: 'doc', why: '住宿登记、景区不少要实名', days: all })
    if (trip.party.mode === 'selfDrive') add({ id: 'doc.license', name: '驾驶证和行驶证', kind: 'doc', why: leave.length ? '查车要看，出境再带驾照翻译件' : '路上查车要看', days: all })
  }
  if (hk.length) add({ id: 'doc.hk', name: '港澳通行证', kind: 'doc', why: '去港澳要带着', days: [...new Set(hk)].sort((a, b) => a - b) })
  if (tw.length) add({ id: 'doc.tw', name: '台湾通行证', kind: 'doc', why: '去台湾要带着', days: tw })
  if (oversea.length) add({ id: 'doc.passport', name: '护照', kind: 'doc', why: '出境携带；签证按目的地的要求带', days: oversea })
  if (trip.party.mode === 'tour') add({ id: 'doc.tour', name: '行程单和导游的联系方式', kind: 'doc', why: '跟团靠它对集合时间', days: all })

  const booked: { day: number; stop: Stop }[] = []
  all.forEach(i => stopsOf(i).forEach(s => {
    const text = [s.why, s.highlight?.tip, s.highlight?.how, s.highlight?.family].filter(Boolean).join(' ')
    if (/预约/.test(text) && !/不用预约|无需预约|免预约|无须预约/.test(text)) booked.push({ day: i, stop: s })
  }))
  if (booked.length) add({ id: 'doc.book', name: '预约凭证', kind: 'doc', why: `${cite(booked.map(b => b.stop))}要预约`, days: [...new Set(booked.map(b => b.day))] })

  const seatDays = all.filter(i => trip.party.mode === 'selfDrive' && partyOnDay(trip.party, i).members.some(needsChildSeat))
  if (seatDays.length) {
    const names = seatDays.flatMap(i => partyOnDay(trip.party, i).members.filter(needsChildSeat).map(m => m.name))
    add({ id: 'gear.seat', name: '儿童安全座椅', kind: 'gear', why: `${join(names)}未满 12 岁，自驾要坐`, days: seatDays })
  }
  const wheelDays = all.filter(i => partyOnDay(trip.party, i).members.some(m => m.mobility === 'wheelchair') && stopsOf(i).some(s => s.kind === 'sight' || (s.walkKm ?? 0) > 0))
  if (wheelDays.length) {
    const names = wheelDays.flatMap(i => partyOnDay(trip.party, i).members.filter(m => m.mobility === 'wheelchair').map(m => m.name))
    add({ id: 'gear.wheel', name: '轮椅', kind: 'gear', why: `${join(names)}要下车走的日子带着`, days: wheelDays })
  }
  const caneDays = all.filter(i => partyOnDay(trip.party, i).members.some(m => m.mobility === 'cane') && stopsOf(i).some(s => s.kind === 'sight' || (s.walkKm ?? 0) > 0))
  if (caneDays.length) {
    const names = caneDays.flatMap(i => partyOnDay(trip.party, i).members.filter(m => m.mobility === 'cane').map(m => m.name))
    add({ id: 'gear.cane', name: '拐杖', kind: 'gear', why: `${join(names)}要下车走的日子带着`, days: caneDays })
  }
  const transitDays = trip.party.mode === 'transit' ? all : all.filter(i => stopsOf(i).some(s => s.kind === 'transit' || s.leg?.by === 'transit'))
  if (transitDays.length) add({ id: 'gear.transit', name: '交通卡或乘车码', kind: 'gear', why: '换乘靠它', days: transitDays })
  if (leave.length) add({ id: 'gear.plug', name: '转换插头', kind: 'gear', why: '境外插座和国内不一样', days: leave.sort((a, b) => a - b) })
  add({ id: 'gear.power', name: '充电线和充电宝', kind: 'gear', why: '导航、订票、打卡都靠手机' })

  const stepStops = all.flatMap(i => stopsOf(i).filter(s => s.tags?.includes('steps')).map(s => ({ day: i, stop: s })))
  if (stepStops.length) add({ id: 'wear.grip', name: '防滑鞋', kind: 'wear', why: `${cite(stepStops.map(x => x.stop))}台阶多`, days: [...new Set(stepStops.map(x => x.day))] })

  const high = all.flatMap(i => {
    const top = stopsOf(i).reduce<{ m: number; name: string } | null>((b, s) => (s.altitudeM != null && (!b || s.altitudeM > b.m) ? { m: s.altitudeM, name: s.name } : b), null)
    return top && top.m >= 3000 ? [{ day: i, ...top }] : []
  })
  if (high.length) {
    const top = high.reduce((a, b) => (a.m >= b.m ? a : b))
    add({ id: 'wear.warm', name: '保暖外套和防晒', kind: 'wear', why: `${top.name}海拔 ${top.m} 米，风大、紫外线强`, days: high.map(h => h.day) })
  }
  const swim = all.flatMap(i => stopsOf(i).filter(s => /游泳|泳场|海滩|沙滩|温泉|漂流/.test(s.name)).map(s => ({ day: i, stop: s })))
  if (swim.length) add({ id: 'wear.swim', name: '泳衣和换洗衣物', kind: 'wear', why: cite(swim.map(x => x.stop)), days: [...new Set(swim.map(x => x.day))] })

  addKid(out, trip)
  addNap(out, trip)
  addAltitude(out, trip, high.map(h => h.day))
  addMeds(out, trip)
  addPet(out, trip)
  return out
}

function addKid(out: Draft[], trip: Trip) {
  const stroller: number[] = []
  const diaper: number[] = []
  const snack: number[] = []
  const little = new Set<string>()
  const older = new Set<string>()
  trip.days.forEach((_, i) => {
    const dp = partyOnDay(trip.party, i)
    const stops = active(trip, i)
    if (!stops.some(s => s.kind !== 'lodging')) return
    const sight = stops.some(s => s.kind === 'sight')
    const c = deriveConstraints(dp)
    const littles = dp.members.filter(m => m.role === 'kid' && (kidBand(m.age) === 'infant' || kidBand(m.age) === 'toddler'))
    const preschool = dp.members.filter(m => m.role === 'kid' && kidBand(m.age) === 'preschool')
    if (littles.length && c.needs.has('stroller') && sight) { stroller.push(i); littles.forEach(m => little.add(m.name)) }
    else if (littles.length) { diaper.push(i); littles.forEach(m => little.add(m.name)) }
    if (preschool.length && sight) { snack.push(i); preschool.forEach(m => older.add(m.name)) }
  })
  if (stroller.length) out.push({ id: 'care.stroller', name: `${join([...little])}的推车、尿布和替换衣服`, kind: 'care', why: '要逛的日子推车带着，尿布和一套干衣服也放包里', days: stroller })
  if (diaper.length) out.push({ id: 'care.diaper', name: `${join([...little])}的尿布和替换衣服`, kind: 'care', why: '不逛的日子也在路上，替换的带在车上', days: diaper })
  if (snack.length) out.push({ id: 'care.snack', name: `${join([...older])}的水和零食`, kind: 'care', why: '路上不好准时吃上', days: snack })
}

function addNap(out: Draft[], trip: Trip) {
  const days: number[] = []
  const names: string[] = []
  trip.days.forEach((_, i) => {
    const dp = partyOnDay(trip.party, i)
    const c = deriveConstraints(dp)
    if (!c.nap) return
    const drive = active(trip, i).reduce((a, s) => a + (s.kind === 'drive' ? s.durationMin : 0) + (s.kind === 'drive' ? 0 : s.driveMin ?? 0), 0)
    if (drive < 45) return
    days.push(i)
    names.push(...whoFor(c.nap.by, dp))
  })
  if (days.length) out.push({ id: 'care.nap', name: '午睡小毯', kind: 'care', why: `${join(names)}有一段路在午睡时间，车上盖`, days })
}

function addAltitude(out: Draft[], trip: Trip, warmDays: number[]) {
  const days: number[] = []
  const places: string[] = []
  trip.days.forEach((d, i) => {
    const top = active(trip, i).reduce<{ m: number; name: string } | null>((b, s) => (s.altitudeM != null && (!b || s.altitudeM > b.m) ? { m: s.altitudeM, name: s.name } : b), null)
    if (!top) return
    const dp = partyOnDay(trip.party, i)
    const fragile = dp.members.some(m => m.role === 'elder' || (m.role === 'kid' && (kidBand(m.age) === 'infant' || kidBand(m.age) === 'toddler')))
    if (top.m >= 3000 || (top.m >= 2500 && fragile)) { days.push(i); places.push(`${top.name} ${top.m} 米`) }
  })
  if (!days.length) return
  const place = [...new Set(places)].slice(0, 2).join('、')
  const lowerOnly = days.every(i => !warmDays.includes(i))
  out.push({ id: 'care.alt', name: '防高原反应的药', kind: 'care', why: lowerOnly ? `${place}，有老人或幼儿同行` : place, days })
}

function addMeds(out: Draft[], trip: Trip) {
  const days: number[] = []
  const names: string[] = []
  trip.days.forEach((_, i) => {
    const elders = partyOnDay(trip.party, i).members.filter(m => m.role === 'elder')
    if (!elders.length) return
    if (!active(trip, i).some(s => s.kind !== 'lodging')) return
    days.push(i)
    names.push(...elders.map(m => m.name))
  })
  if (days.length) out.push({ id: 'care.meds', name: '常用药', kind: 'care', why: `${join(names)}的药按天分好`, days })
  else out.push({ id: 'care.meds', name: '个人常用药', kind: 'care', why: '按平时吃的带，路上不好临时配' })
}

function addPet(out: Draft[], trip: Trip) {
  const days: number[] = []
  const names: string[] = []
  let dog = false
  let lodge = false
  trip.days.forEach((_, i) => {
    const pets = partyOnDay(trip.party, i).pets
    const stops = active(trip, i)
    if (!pets.length || !stops.some(s => s.kind !== 'lodging')) return
    days.push(i)
    names.push(...pets.map(p => p.name))
    if (pets.some(p => p.kind === 'dog')) dog = true
    if (stops.some(s => s.kind === 'lodging' && !s.home)) lodge = true
  })
  if (!days.length) return
  const kit = dog ? '粮、水、牵引绳和拾便袋' : '粮、水和出行的容器'
  out.push({ id: 'care.pet', name: `${join(names)}的${kit}`, kind: 'care', why: lodge ? '住店常要看疫苗本，一起带着' : '出门这一天带着', days })
}

function clean(p: PackState): PackState | undefined {
  const out: PackState = {}
  if (p.done?.length) out.done = p.done
  if (p.hidden?.length) out.hidden = p.hidden
  if (p.custom?.length) out.custom = p.custom
  return out.done || out.hidden || out.custom ? out : undefined
}

/** 建议条目叠上勾选、去掉和自己加的，顺序固定：证件、设备、穿着、照护 */
export function packItems(trip: Trip): PackItem[] {
  const hidden = new Set(trip.pack?.hidden ?? [])
  const done = new Set(trip.pack?.done ?? [])
  const suggested: PackItem[] = suggest(trip).filter(i => !hidden.has(i.id)).map(i => ({ ...i, ...(done.has(i.id) ? { done: true } : {}) }))
  const custom: PackItem[] = (trip.pack?.custom ?? []).filter(i => !hidden.has(i.id)).map(i => ({ ...i, custom: true }))
  return [...suggested, ...custom].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind))
}

/** 今天出门要额外提醒的：days 含这一天；自己加的没写天数就每天都提 */
export function packForDay(trip: Trip, day: number): PackItem[] {
  return packItems(trip).filter(i => i.days?.includes(day) || (i.custom && !i.days))
}

export function setPacked(trip: Trip, id: string, on: boolean): Trip {
  const isCustom = trip.pack?.custom?.some(i => i.id === id)
  const custom = trip.pack?.custom?.map(i => {
    if (i.id !== id) return i
    if (on) return { ...i, done: true }
    const next = { ...i }
    delete next.done
    return next
  })
  const prev = trip.pack?.done ?? []
  const done = isCustom ? prev : on ? [...new Set([...prev, id])] : prev.filter(x => x !== id)
  return { ...trip, pack: clean({ ...trip.pack, done, custom }) }
}

export function hidePack(trip: Trip, id: string): Trip {
  const wasCustom = trip.pack?.custom?.some(i => i.id === id)
  const custom = trip.pack?.custom?.filter(i => i.id !== id)
  const hidden = wasCustom ? trip.pack?.hidden : [...new Set([...(trip.pack?.hidden ?? []), id])]
  const done = trip.pack?.done?.filter(x => x !== id)
  return { ...trip, pack: clean({ done, hidden, custom }) }
}

export function addPackItem(trip: Trip, item: PackItem): Trip {
  const custom = [...(trip.pack?.custom ?? []), { ...item, custom: true, why: item.why || '自己加的' }]
  return { ...trip, pack: clean({ ...trip.pack, custom }) }
}

/** 自己加的一件，按名字归到证件、穿着或照护 */
export function guessPackKind(name: string): PackKind {
  if (/证|护照|签证|驾照|预约/.test(name)) return 'doc'
  if (/鞋|衣|裤|外套|帽|防晒|泳衣|伞/.test(name)) return 'wear'
  if (/药|尿|毯|粮|水|零食|奶/.test(name)) return 'care'
  return 'gear'
}
