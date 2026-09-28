// 动态人数：按日取当天实际同行的人和宠物。
import type { DayRange, Member, Party, Pet } from './types'

export function inRange(day: number, r?: DayRange): boolean {
  return !r || (day >= r.from && day <= r.to)
}

export interface DayParty {
  mode: Party['mode']
  members: Member[]
  pets: Pet[]
  vehicleSeats?: number
}

export function partyOnDay(party: Party, day: number): DayParty {
  return {
    mode: party.mode,
    members: party.members.filter(m => inRange(day, m.days)),
    pets: party.pets.filter(p => inRange(day, p.days)),
    vehicleSeats: party.vehicleSeats,
  }
}

/** 小孩按年龄分档，规则表与界面文案都用它 */
export type KidBand = 'infant' | 'toddler' | 'preschool' | 'school' | 'teen'

export function kidBand(age: number | undefined): KidBand {
  const a = age ?? 8
  if (a < 1) return 'infant'
  if (a < 3) return 'toddler'
  if (a < 7) return 'preschool'
  if (a < 13) return 'school'
  return 'teen'
}

/** 需要儿童安全座椅：我国推荐 12 岁以下（或身高 <150 cm）使用，这里按年龄近似 */
export function needsChildSeat(m: Member): boolean {
  return m.role === 'kid' && (m.age ?? 8) < 12
}
