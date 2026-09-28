// 生成足迹页用的全国省级边界：投影、道格拉斯-普克简化、转成 SVG 路径，写到 src/data/china-map.json。
// 数据来源：阿里云 DataV.GeoAtlas（areas_v3/bound/100000_full.json），含台湾、港澳与南海九段线，
// 在国内发布的地图必须完整画出这些。改简化精度后重新跑：node scripts/buildChinaMap.mjs [本地 geojson]
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json'
const raw = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : await (await fetch(SRC)).json()

// 等距圆柱投影，经度按 36°N 的余弦压缩，全国看起来不至于太扁
const LAT0 = 36, K = Math.cos((LAT0 * Math.PI) / 180), W = 1000
const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
const proj0 = ([lng, lat]) => [lng * K, -lat]
for (const f of raw.features) for (const ring of rings(f.geometry)) for (const p of ring) {
  const [x, y] = proj0(p)
  bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x)
  bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y)
}
const S = W / (bounds.maxX - bounds.minX)
const H = Math.round((bounds.maxY - bounds.minY) * S)
const proj = p => { const [x, y] = proj0(p); return [(x - bounds.minX) * S, (y - bounds.minY) * S] }

function rings(g) {
  if (g.type === 'Polygon') return g.coordinates
  if (g.type === 'MultiPolygon') return g.coordinates.flat()
  return []
}

// 道格拉斯-普克：容差按投影后的像素算。
// 边界是闭合环（首尾同一点），首尾连线长度为零会把整圈都删光，所以先在离起点最远处切成两段。
function simplify(pts, tol) {
  const [fx, fy] = pts[0], [lx, ly] = pts[pts.length - 1]
  if (pts.length > 3 && fx === lx && fy === ly) {
    let far = 1, fd = -1
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.hypot(pts[i][0] - fx, pts[i][1] - fy); if (d > fd) { fd = d; far = i } }
    const a = simplifyOpen(pts.slice(0, far + 1), tol), b = simplifyOpen(pts.slice(far), tol)
    return [...a, ...b.slice(1)]
  }
  return simplifyOpen(pts, tol)
}

function simplifyOpen(pts, tol) {
  if (pts.length < 4) return pts
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let md = 0, mi = -1
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len
      if (d > md) { md = d; mi = i }
    }
    if (md > tol && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]) }
  }
  return pts.filter((_, i) => keep[i])
}

const r1 = v => Math.round(v * 10) / 10
const toPath = (ring, close) => ring.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(x)} ${r1(y)}`).join('') + (close ? 'Z' : '')

const TOL = 0.9
const provinces = []
let jd = ''
for (const f of raw.features) {
  const code = String(f.properties.adcode)
  const parts = []
  for (const ring of rings(f.geometry)) {
    const p = simplify(ring.map(proj), code.endsWith('_JD') ? 0.5 : TOL)
    // 太小的岛丢掉，只留九段线本身
    if (!code.endsWith('_JD')) {
      const xs = p.map(q => q[0]), ys = p.map(q => q[1])
      if (Math.max(...xs) - Math.min(...xs) < 1.2 && Math.max(...ys) - Math.min(...ys) < 1.2 && !['810000', '820000'].includes(code)) continue
    }
    parts.push(toPath(p, true))
  }
  if (code.endsWith('_JD')) { jd = parts.join(''); continue }
  const c = f.properties.center ? proj(f.properties.center) : proj(f.properties.centroid ?? [0, 0])
  provinces.push({ adcode: code, name: f.properties.name, d: parts.join(''), cx: r1(c[0]), cy: r1(c[1]) })
}

const out = { source: SRC, width: W, height: H, lat0: LAT0, k: K, scale: S, minX: bounds.minX, minY: bounds.minY, provinces, jd }
writeFileSync(new URL('../src/data/china-map.json', import.meta.url), JSON.stringify(out))
console.log(`provinces ${provinces.length}, ${W}x${H}, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`)
