// 排程引擎在网页里用的工具：高德真实车程、周边找吃饭 / 住处 / 服务区，加上自家红黑榜。
import type { NearbyKind, PlanTools } from '@core/planner'
import { aggregate, type Rating } from '@core/ratings'
import { distanceKm } from '@core/geo'
import { AMAP_TYPES, driveBetween, searchAround, searchCitySights, type Place } from './amap'

const RADIUS: Record<NearbyKind, number> = { food: 2500, lodging: 6000, serviceArea: 20000, sight: 15000 }

export function makePlanTools(amapKey: string, ratings: Rating[], onProgress?: (m: string) => void): PlanTools {
  const verdicts = aggregate(ratings)
  const byName = new Map(verdicts.map(v => [v.name, v.verdict]))
  // 同一个城市的景区只查一次
  const citySights = new Map<string, Promise<Place[]>>()
  return {
    onProgress,
    // 红黑榜按名字对齐；平票不算
    verdictOf: p => { const v = byName.get(p.name); return v === 'red' || v === 'black' ? v : undefined },
    ...(amapKey ? {
      drive: async (a, b) => (await driveBetween(a, b, amapKey))?.minutes ?? null,
      nearby: async (what, at) => {
        let list: Place[]
        if (what === 'sight') {
          // 下午补景点：先在这个城市按重要程度排的景区里挑 15 公里内的；城市查不到再退回周边搜索
          list = []
          if (at.adcode) {
            const city = at.adcode.slice(0, 4)
            if (!citySights.has(city)) citySights.set(city, searchCitySights(at.adcode, amapKey).catch(() => []))
            list = (await citySights.get(city)!).filter(p => distanceKm(at, p.poi) * 1000 <= RADIUS.sight)
          }
          if (!list.length) list = await searchAround(at, amapKey, { types: AMAP_TYPES.sight, radius: RADIUS.sight, pageSize: 25 })
        } else list = await searchAround(at, amapKey, { types: AMAP_TYPES[what], keywords: what === 'serviceArea' ? '服务区' : '', radius: RADIUS[what] })
        return list.map(p => ({ name: p.name, poi: p.poi, rating: p.rating, distanceM: p.distanceM }))
      },
    } : {}),
  }
}
