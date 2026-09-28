import type { Member, Party, Pet, Stop, Trip } from '@core/types'

export const adult = (id = 'a1', extra: Partial<Member> = {}): Member => ({ id, name: id, role: 'adult', driver: true, ...extra })
export const elder = (age: number, extra: Partial<Member> = {}): Member => ({ id: 'e' + age, name: '老人', role: 'elder', age, ...extra })
export const kid = (age: number, extra: Partial<Member> = {}): Member => ({ id: 'k' + age, name: '小孩', role: 'kid', age, ...extra })
export const dog = (size: Pet['size'] = 'medium', extra: Partial<Pet> = {}): Pet => ({ id: 'dog', name: '狗', kind: 'dog', size, ...extra })

export const party = (members: Member[], mode: Party['mode'] = 'selfDrive', pets: Pet[] = [], vehicleSeats?: number): Party => ({ mode, members, pets, vehicleSeats })

let n = 0
export const stop = (kind: Stop['kind'], durationMin: number, extra: Partial<Stop> = {}): Stop => ({ id: 's' + ++n, kind, name: extra.name ?? kind + n, durationMin, ...extra })

export const trip = (p: Party, days: Stop[][], startDate = '2026-10-01'): Trip => ({
  id: 't1', title: '测试', startDate, party: p, days: days.map(stops => ({ stops })),
})
