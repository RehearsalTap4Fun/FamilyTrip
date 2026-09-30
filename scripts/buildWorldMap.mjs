// 生成足迹页用的世界国界：投影、道格拉斯-普克简化、转成 SVG 路径，写到 src/data/world-map.json。
// 各国边界来自 Natural Earth 1:110m（ne_110m_admin_0_countries，带中文名）；
// 中国不用 Natural Earth 的（它把藏南、阿克赛钦画在别国、台湾单列），改用阿里云 DataV 的全国边界（含台湾、港澳）叠在最上面，
// 再加上南海九段线——在国内发布的世界地图也要这样画。南极洲不画。
// 以太平洋为中心（中文世界地图的惯例）：中央经线 150°E，在 30°W 切开（只有格陵兰跨这条线，切成两半各画一边）。
// 改精度后重新跑：node scripts/buildWorldMap.mjs
import { writeFileSync } from 'node:fs'

const NE = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson'
const CN = 'https://geo.datav.aliyun.com/areas_v3/bound/100000.json'
const CN_FULL = 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json'
const [ne, cn, cnFull] = await Promise.all([NE, CN, CN_FULL].map(async u => (await fetch(u)).json()))

const CUT = -30
const W = 1000
// 米勒圆柱投影：高纬不像墨卡托那样放大得离谱
const miller = lat => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * (lat * Math.PI) / 180))
const LAT_TOP = 84, LAT_BOTTOM = -57
const X0 = CUT, S = W / 360
const Y0 = miller(LAT_TOP)
const YS = W / (2 * Math.PI) // 经度 1 弧度 = YS 像素，和 x 同比例
const H = Math.round((Y0 - miller(LAT_BOTTOM)) * YS)
const shift = lng => (lng < CUT ? lng + 360 : lng)
const proj = ([lng, lat]) => [(shift(lng) - X0) * S, (Y0 - miller(Math.max(LAT_BOTTOM - 2, Math.min(LAT_TOP + 2, lat)))) * YS]

function rings(g) {
  if (g.type === 'Polygon') return g.coordinates
  if (g.type === 'MultiPolygon') return g.coordinates.flat()
  return []
}

// 跨 30°W 的环：按半平面各裁一次（Sutherland–Hodgman），西边那半挪到最右边
function splitAtCut(ring) {
  const west = ring.some(p => p[0] < CUT), east = ring.some(p => p[0] >= CUT)
  if (!west || !east) return [ring]
  const clip = keepEast => {
    const inside = p => (keepEast ? p[0] >= CUT : p[0] < CUT)
    const out = []
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length]
      if (inside(a)) out.push(a)
      if (inside(a) !== inside(b)) {
        const t = (CUT - a[0]) / (b[0] - a[0])
        const lat = a[1] + t * (b[1] - a[1])
        out.push(keepEast ? [CUT, lat] : [CUT - 1e-9, lat])
      }
    }
    return out
  }
  return [clip(true), clip(false)].filter(r => r.length >= 3)
}

function simplify(pts, tol) {
  if (pts.length < 4) return pts
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1
  // 闭合环先在离起点最远处劈开，免得首尾重合时整圈被删光
  let far = 1, fd = -1
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i } }
  keep[far] = 1
  const stack = [[0, far], [far, pts.length - 1]]
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
const toPath = ring => ring.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(x)} ${r1(y)}`).join('') + 'Z'

function shapeOf(geometry, tol, minSize) {
  const parts = []
  for (const ring of rings(geometry)) for (const half of splitAtCut(ring)) {
    const p = simplify(half.map(proj), tol)
    const xs = p.map(q => q[0]), ys = p.map(q => q[1])
    if (Math.max(...xs) - Math.min(...xs) < minSize && Math.max(...ys) - Math.min(...ys) < minSize) continue
    parts.push(toPath(p))
  }
  return parts.join('')
}

const SKIP = new Set(['CHN', 'TWN', 'ATA'])
const countries = []
for (const f of ne.features) {
  const p = f.properties
  if (SKIP.has(p.ADM0_A3)) continue
  const code = p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ADM0_A3
  const d = shapeOf(f.geometry, 0.35, 0.6)
  if (!d) continue
  countries.push({ code, name: p.NAME_ZH || p.NAME, d })
}
// 中国：DataV 的全国边界（含台湾、港澳），小岛也留着（南海诸岛太小，画个意思）
countries.push({ code: 'CN', name: '中国', d: shapeOf(cn.features[0].geometry, 0.3, 0.2) })
const jdF = cnFull.features.find(f => String(f.properties.adcode).endsWith('_JD'))
const jd = jdF ? rings(jdF.geometry).map(r => toPath(simplify(r.map(proj), 0.2))).join('') : ''

const out = { source: [NE, CN], width: W, height: H, cut: CUT, latTop: LAT_TOP, countries, jd }
writeFileSync(new URL('../src/data/world-map.json', import.meta.url), JSON.stringify(out))
console.log(`countries ${countries.length}, ${W}x${H}, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`)
