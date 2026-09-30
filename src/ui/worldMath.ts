// 世界地图的投影和「这个坐标在哪个国家」：和 scripts/buildWorldMap.mjs 同一套（米勒投影、中央经线 150°E、在 30°W 切开）。
// 判断国家用投影后的路径做点在多边形内；落在海里（小岛被简化掉了）就找最近的国家，离得太远算不上。
export interface WorldMap { width: number; height: number; cut: number; latTop: number; countries: { code: string; name: string; d: string }[]; jd: string }

const miller = (lat: number) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * (lat * Math.PI) / 180))

export function worldProjector(m: Pick<WorldMap, 'width' | 'cut' | 'latTop'>) {
  const S = m.width / 360, YS = m.width / (2 * Math.PI), Y0 = miller(m.latTop)
  return (lng: number, lat: number): [number, number] => [((lng < m.cut ? lng + 360 : lng) - m.cut) * S, (Y0 - miller(Math.max(-85, Math.min(85, lat)))) * YS]
}

/** 「M1 2L3 4Z…」拆成环 */
export function pathRings(d: string): [number, number][][] {
  return d.split('Z').filter(Boolean).map(seg => seg.split(/[ML]/).filter(Boolean).map(xy => xy.trim().split(/\s+/).map(Number) as [number, number]))
}

function inRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** 做一个「坐标 → 国家码」的查询；maxPx：落在海里时离最近国家多近才算（像素，1000 宽的图上 1 像素约 0.36°） */
export function makeCountryAt(m: WorldMap, maxPx = 12): (lng: number, lat: number) => string | undefined {
  const project = worldProjector(m)
  const shapes = m.countries.map(c => ({ code: c.code, rings: pathRings(c.d) }))
  return (lng, lat) => {
    const [x, y] = project(lng, lat)
    // 中国放在最后、叠在最上面：先查中国（边界以它为准）
    for (let k = shapes.length - 1; k >= 0; k--) if (shapes[k].rings.some(r => inRing(x, y, r))) return shapes[k].code
    let best: string | undefined, bd = maxPx
    for (const s of shapes) for (const r of s.rings) for (const [px, py] of r) {
      const dd = Math.hypot(px - x, py - y)
      if (dd < bd) { bd = dd; best = s.code }
    }
    return best
  }
}
