// 界面用的日期、路线摘要。无 DOM 依赖，小程序可以直接复用。
import { cityOf } from '@core/footprint'
import { partyOnDay } from '@core/party'
import { driveOf } from '@core/schedule'
import type { Day, Party, Trip } from '@core/types'

const WEEK = '日一二三四五六'

export function dayDate(startDate: string, i: number): Date {
  const [y, m, d] = startDate.split('-').map(Number)
  return new Date(y, m - 1, d + i)
}

export function fmtDay(startDate: string, i: number): string {
  const t = dayDate(startDate, i)
  return `${t.getMonth() + 1} 月 ${t.getDate()} 日 周${WEEK[t.getDay()]}`
}

export function fmtShort(startDate: string, i: number): string {
  const t = dayDate(startDate, i)
  return `${t.getMonth() + 1}/${t.getDate()}`
}

/** 地图册式的简称：州市名去掉后缀 */
const CITY_SHORT: Record<string, string> = {
  '530100': '昆明',
  '530700': '丽江',
  '532900': '大理',
}

export function cityShort(adcode?: string): string | undefined {
  return adcode ? CITY_SHORT[cityOf(adcode)] : undefined
}

/** 这一天经过的城市，按先后去重 */
export function dayCities(day: Day): string[] {
  const out: string[] = []
  for (const s of day.stops) {
    const c = cityShort(s.poi?.adcode)
    if (c && out[out.length - 1] !== c) out.push(c)
  }
  return out.filter((c, i) => out.indexOf(c) === i)
}

export function dayTitle(day: Day): string {
  const c = dayCities(day)
  return c.length ? c.join('—') : day.stops[0]?.name ?? '空白的一天'
}

export function driveHours(day: Day): number {
  return day.stops.reduce((a, s) => a + driveOf(s), 0) / 60
}

export const MODE_LABEL: Record<Party['mode'], string> = { selfDrive: '自驾', tour: '跟团', transit: '公共交通' }

export function partyLine(trip: Trip, dayIndex: number): string {
  const p = partyOnDay(trip.party, dayIndex)
  const pets = p.pets.length ? ` ${p.pets.length} ${p.pets.every(x => x.kind === 'dog') ? '犬' : '宠'}` : ''
  return `${MODE_LABEL[p.mode]} ${p.members.length} 人${pets}`
}

/** 路名里的国家高速编号，例如「大丽高速 G5611」 */
export function routeCode(name: string): string | undefined {
  return /\b(G\d{1,4})\b/.exec(name)?.[1]
}

export function stripCode(name: string): string {
  return name.replace(/\s*\bG\d{1,4}\b/, '').trim()
}

/** 城市到平涂色的稳定映射：同一个地方在每一天、每一页都是同一种颜色 */
const TINTS = ['var(--t-yellow)', 'var(--t-green)', 'var(--t-pink)', 'var(--t-violet)']
export function tintOf(trip: Trip, adcode?: string): string {
  if (!adcode) return 'transparent'
  const order: string[] = []
  for (const d of trip.days) for (const s of d.stops) {
    const c = s.poi?.adcode ? cityOf(s.poi.adcode) : undefined
    if (c && !order.includes(c)) order.push(c)
  }
  const i = order.indexOf(cityOf(adcode))
  return i < 0 ? 'transparent' : TINTS[i % TINTS.length]
}
