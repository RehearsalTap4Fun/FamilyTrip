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

/** 地名缩短：去掉括号里的补充（「天空音乐盒(上海五原路店)」「洞爷湖（吃完接着逛）」），按显示宽度（字母、数字算半个字）超过 max 个字宽就截断加省略号 */
export function shortName(name: string, max = 10): string {
  const n = name.replace(/[（(][^（）()]*[)）]/g, '').replace(/[-·—\s]+$/, '').trim() || name.trim()
  const w = (ch: string) => (/[\x00-\x7f]/.test(ch) ? 0.55 : 1)
  let used = 0, out = ''
  for (const ch of n) {
    if (used + w(ch) > max - 0.5) return out.trimEnd() + '…'
    used += w(ch); out += ch
  }
  return out
}

/**
 * 一天的标题（要短，一行放得下）：经过一两个认得的城市就写城市（「大理—丽江」）；
 * 否则写当天第一个景点；没有景点的：有回家的写「回家」，有长途（飞机、高铁、开很久）的写「出发」，只开车的写「赶路」，都没有就「休整」
 */
export function dayTitle(day: Day): string {
  const c = dayCities(day)
  if (c.length && c.length <= 2) return c.join('—')
  const live = day.stops.filter(s => s.status !== 'skipped')
  const sight = live.find(s => s.kind === 'sight' && !s.suggested) ?? live.find(s => s.kind === 'sight')
  if (sight) return shortName(sight.name)
  if (live.some(s => s.home)) return '回家'
  const onRoad = live.reduce((a, s) => a + driveOf(s), 0) + live.filter(s => s.kind === 'transit').reduce((a, s) => a + s.durationMin, 0)
  if (live.some(s => s.kind === 'transit' && s.durationMin >= 120)) return '出发'
  if (onRoad >= 180) return '赶路'
  return live.length ? '休整' : '空白的一天'
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
/**
 * 按景点分段（地图册「今天」页的底色）：每个景点一段——开往它的路、它之后没再开车前的吃饭歇脚都算这段；
 * 第一个景点之前的路算进第一段，最后一个景点之后的留在最后一段。返回每一站在第几段（从 0 起），一天里没有景点就全是 0
 */
export function sightSegments(stops: { kind: string }[]): number[] {
  const sights = stops.map((s, i) => (s.kind === 'sight' ? i : -1)).filter(i => i >= 0)
  if (!sights.length) return stops.map(() => 0)
  const out: number[] = []
  let seg = 0, seen = 0, leaving = false
  for (let i = 0; i < stops.length; i++) {
    const k = stops[i].kind
    if (k === 'sight') { seg = seen++; leaving = false }
    else if (seen > 0 && (k === 'drive' || k === 'transit') && seen < sights.length) { if (!leaving) { seg = seen; leaving = true } }
    out.push(seg)
  }
  return out
}

/** 第几段的底色：黄绿粉紫轮流，相邻两段不同色 */
export const segTint = (i: number) => TINTS[i % TINTS.length]

