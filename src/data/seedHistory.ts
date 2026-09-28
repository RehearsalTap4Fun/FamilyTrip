// 示例的历史旅程：只为足迹页有东西可看，全部是编的。
import type { Stop, Trip } from '@core/types'

let n = 0
const done = (name: string, lng: number, lat: number, adcode: string, kind: Stop['kind'] = 'sight'): Stop =>
  ({ id: 'h' + ++n, kind, name, durationMin: 90, status: 'done', poi: { lng, lat, adcode } })
const trip = (id: string, title: string, startDate: string, days: Stop[][]): Trip => ({
  id, title, startDate,
  party: { mode: 'selfDrive', members: [{ id: 'me', name: '我', role: 'adult', driver: true }, { id: 'lin', name: '小林', role: 'adult', driver: true }], pets: [] },
  days: days.map(stops => ({ stops })),
})

export function seedHistory(): Trip[] {
  n = 0
  return [
    trip('h-xm', '厦门泉州', '2024-02-10', [
      [done('鼓浪屿', 118.067, 24.447, '350203'), done('沙坡尾', 118.087, 24.448, '350203', 'food')],
      [done('开元寺', 118.586, 24.914, '350502'), done('西街', 118.583, 24.913, '350502', 'food')],
    ]),
    trip('h-qd', '青岛威海', '2025-07-12', [
      [done('八大关', 120.35, 36.05, '370202'), done('栈桥', 120.314, 36.061, '370202')],
      [done('那香海', 122.22, 37.37, '371082'), done('威海公园', 122.14, 37.53, '371002')],
    ]),
    trip('h-cd', '成都', '2025-10-02', [
      [done('宽窄巷子', 104.054, 30.667, '510105'), done('大熊猫基地', 104.146, 30.736, '510108')],
      [done('都江堰', 103.61, 31.0, '510181')],
    ]),
    trip('h-dl', '大理（第一次）', '2023-05-01', [
      [done('洱海生态廊道', 100.18, 25.78, '532901')],
    ]),
  ]
}
