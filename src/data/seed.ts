// 示例旅程：国庆大理丽江五日自驾。首次打开和「恢复示例」用它，所有数字都是编的。
import type { Stop, Trip } from '@core/types'

let n = 0
const s = (kind: Stop['kind'], name: string, durationMin: number, extra: Partial<Stop> = {}): Stop => ({ id: 'ex' + ++n, kind, name, durationMin, status: 'planned', ...extra })
// 每个站点用各自的大致坐标，足迹页的点才分得开、补车程才有意义
const at = (lng: number, lat: number, adcode: string) => ({ lng, lat, adcode })
const DALI = at(100.162, 25.695, '532901') // 大理古城
const LIJIANG = at(100.23, 26.87, '530702')
const SHUHE = at(100.205, 26.921, '530702')
const YULONG = { lng: 100.18, lat: 27.1, adcode: '530721' }
const ERYUAN = { lng: 99.95, lat: 26.11, adcode: '532930' }
const KUNMING = { lng: 102.71, lat: 25.04, adcode: '530102' }

export function seedTrip(): Trip {
  n = 0
  return {
    id: 'example',
    title: '大理丽江',
    startDate: '2026-10-01',
    party: {
      mode: 'selfDrive',
      vehicleSeats: 5,
      members: [
        { id: 'me', name: '我', role: 'adult', driver: true },
        { id: 'lin', name: '小林', role: 'adult', driver: true },
        { id: 'waipo', name: '外婆', role: 'elder', age: 76, mobility: 'slow', days: { from: 1, to: 4 } },
        { id: 'duoduo', name: '朵朵', role: 'kid', age: 2 },
      ],
      pets: [{ id: 'doubao', name: '豆包', kind: 'dog', size: 'medium' }],
    },
    days: [
      {
        startTime: '08:00',
        stops: [
          s('drive', '昆楚高速 G56', 85, { poi: KUNMING }),
          s('rest', '禄丰服务区', 20, { tags: ['restroom'] }),
          s('drive', '昆楚高速 G56', 80),
          s('rest', '楚雄服务区', 25, { tags: ['restroom'] }),
          s('drive', '楚大高速 G56', 85),
          s('sight', '双廊古镇', 120, { walkKm: 2, driveMin: 40, poi: at(100.193, 25.912, '532901'), priority: 2, tags: ['restroom'] }),
          s('lodging', '大理古城 客栈', 0, { driveMin: 50, poi: DALI, tags: ['petOk', 'elevator'] }),
        ],
      },
      {
        startTime: '09:30',
        stops: [
          s('sight', '崇圣寺三塔', 150, { walkKm: 3, driveMin: 15, poi: at(100.147, 25.713, '532901'), priority: 1, tags: ['steps', 'restroom'] }),
          s('food', '白族三道茶午饭', 60, { poi: DALI, tags: ['kidMenu', 'restroom', 'petOk'] }),
          s('rest', '回客栈午睡', 120, { poi: DALI, tags: ['napOk'] }),
          s('sight', '大理古城 人民路', 90, { walkKm: 1.5, poi: DALI, priority: 3, tags: ['stroller', 'restroom', 'petOk'] }),
          s('lodging', '大理古城 客栈', 0, { poi: DALI, tags: ['petOk', 'elevator'] }),
        ],
      },
      {
        startTime: '08:30',
        stops: [
          s('sight', '喜洲古镇', 90, { walkKm: 1.5, driveMin: 40, poi: at(100.143, 25.851, '532901'), priority: 1, tags: ['stroller', 'restroom', 'petOk'], status: 'done', actualStart: '09:25' }),
          s('drive', '大丽高速 G5611', 130, { poi: ERYUAN }),
          s('rest', '洱源服务区', 20, { poi: ERYUAN, tags: ['restroom'] }),
          s('drive', '大丽高速 G5611', 50, { poi: LIJIANG }),
          s('rest', '入住 束河客栈', 90, { poi: SHUHE, tags: ['napOk', 'petOk'] }),
          s('sight', '黑龙潭公园', 110, { start: '16:00', walkKm: 2, driveMin: 20, poi: at(100.236, 26.887, '530702'), priority: 2, tags: ['restroom', 'petOk'] }),
          s('food', '纳西腊排骨', 60, { driveMin: 15, poi: at(100.233, 26.874, '530702'), tags: ['kidMenu', 'restroom'] }),
          s('lodging', '束河客栈', 0, { driveMin: 15, poi: SHUHE, tags: ['petOk', 'elevator'] }),
        ],
      },
      {
        startTime: '08:00',
        stops: [
          s('sight', '玉龙雪山 冰川公园', 240, { walkKm: 2, driveMin: 60, altitudeM: 4506, poi: YULONG, priority: 1, tags: ['restroom'] }),
          s('food', '白沙古镇午饭', 60, { driveMin: 30, poi: at(100.222, 26.95, '530721'), tags: ['kidMenu', 'petOk'] }),
          s('sight', '白沙古镇', 90, { walkKm: 1.5, altitudeM: 2400, poi: at(100.223, 26.953, '530721'), priority: 3, tags: ['stroller', 'restroom', 'petOk'] }),
          s('lodging', '束河客栈', 0, { driveMin: 30, poi: SHUHE, tags: ['petOk', 'elevator'] }),
        ],
      },
      {
        startTime: '09:00',
        stops: [
          s('drive', '大丽高速 G5611', 85, { poi: LIJIANG }),
          s('rest', '洱源服务区', 20, { poi: ERYUAN, tags: ['restroom'] }),
          s('drive', '大丽高速 → 楚大高速', 85, { poi: DALI }),
          s('food', '大理服务区午饭', 50, { tags: ['kidMenu', 'restroom'] }),
          s('drive', '楚大高速 G56', 85),
          s('rest', '楚雄服务区', 20, { tags: ['restroom'] }),
          s('drive', '昆楚高速 G56', 85, { poi: KUNMING }),
          s('lodging', '到家', 0, { poi: KUNMING, tags: ['petOk', 'elevator'] }),
        ],
      },
    ],
  }
}

/** 示例的演示时间：第 3 天上午，正在大丽高速上 */
export const SEED_NOW = '2026-10-03T10:55'
