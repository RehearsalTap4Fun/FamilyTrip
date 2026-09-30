// SVG 路径（只有 M / L / Z 的绝对坐标）拆成环，和点在多边形内。世界地图认国家、中国地图认「在不在国内」都用它。
export function pathRings(d: string): [number, number][][] {
  return d.split('Z').filter(Boolean).map(seg => seg.split(/[ML]/).filter(Boolean).map(xy => xy.trim().split(/\s+/).map(Number) as [number, number]))
}

export function inRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
