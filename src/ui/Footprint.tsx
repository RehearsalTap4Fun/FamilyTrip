// 「足迹」：两层地图。世界层按国家着色（去过国外时默认先看这层），点中国进中国层；中国层按省着色，南海诸岛放在右下角的插图框里（国内地图的惯例）。
// 世界地图数据有 98 KB，打开足迹页才加载。
import { useEffect, useMemo, useState } from 'react'
import { footprint, provinceOf } from '@core/footprint'
import type { Stop, Trip } from '@core/types'
import map from '../data/china-map.json'
import { Sheet } from './kit/Sheet'
import { makeCountryAt, worldProjector, type WorldMap } from './worldMath'

interface Props { trips: Trip[] }
type Layer = 'world' | 'china'

// 主图只画到海南以南一点，南海诸岛进插图
const MAIN_H = 720
const INSET = { x: 511, y: 573, w: 325, h: 442 }
const project = (lng: number, lat: number) => [(lng * map.k - map.minX) * map.scale, (-lat - map.minY) * map.scale]
const NAMES = Object.fromEntries(map.provinces.map(p => [p.adcode, p.name]))

const toneOf = (v?: { trips: number }) => (!v ? 'fp-none' : v.trips >= 2 ? 'fp-2' : 'fp-1')

export function FootprintPage({ trips }: Props) {
  const [world, setWorld] = useState<WorldMap | null>(null)
  useEffect(() => {
    let alive = true
    import('../data/world-map.json').then(m => { if (alive) setWorld(m.default as WorldMap) }).catch(() => undefined)
    return () => { alive = false }
  }, [])
  const countryAt = useMemo(() => (world ? makeCountryAt(world) : undefined), [world])
  const fp = useMemo(() => footprint(trips, countryAt), [trips, countryAt])
  const abroad = [...fp.countries.keys()].some(c => c !== 'CN')
  const [layerPick, setLayer] = useState<Layer | null>(null)
  // 没手动切过：去过国外先看世界，否则看中国
  const layer: Layer = layerPick ?? (abroad && world ? 'world' : 'china')
  const [pick, setPick] = useState<{ layer: Layer; code: string } | null>(null)
  const tripCount = new Set(fp.points.map(p => p.tripId)).size
  const countryName = useMemo(() => new Map((world?.countries ?? []).map(c => [c.code, c.name])), [world])

  const done = (t: Trip) => t.days.flatMap(d => d.stops).filter((s): s is Stop & { poi: NonNullable<Stop['poi']> } => s.status === 'done' && !!s.poi)
  const inPick = (s: Stop & { poi: NonNullable<Stop['poi']> }) => !pick ? false
    : pick.layer === 'china' ? !!s.poi.adcode && provinceOf(s.poi.adcode) === pick.code
    : pick.code === 'CN' ? !!s.poi.adcode : !s.poi.adcode && countryAt?.(s.poi.lng, s.poi.lat) === pick.code
  const detail = pick ? trips.map(t => ({ trip: t, places: done(t).filter(inPick).map(s => s.name) })).filter(x => x.places.length) : []
  const pickName = !pick ? '' : pick.layer === 'china' ? NAMES[pick.code] ?? '' : countryName.get(pick.code) ?? pick.code

  const openCountry = (code: string) => { if (code === 'CN') setLayer('china'); else if (fp.countries.has(code)) setPick({ layer: 'world', code }) }

  const chinaShapes = (withLabels: boolean) => (
    <>
      {map.provinces.map(p => (
        <path key={p.adcode} d={p.d} className={'fp-prov ' + toneOf(fp.provinces.get(p.adcode))} onClick={() => fp.provinces.has(p.adcode) && setPick({ layer: 'china', code: p.adcode })}>
          <title>{p.name}</title>
        </path>
      ))}
      <path d={map.jd} className="fp-jd" />
      {fp.points.map((pt, i) => { const [x, y] = project(pt.lng, pt.lat); return <circle key={i} cx={x} cy={y} r={withLabels ? 4.5 : 3} className="fp-pt" /> })}
    </>
  )

  const worldProject = world ? worldProjector(world) : undefined
  const countries = [...fp.countries.values()].sort((a, b) => b.first.localeCompare(a.first))
  const provinces = [...fp.provinces.values()].sort((a, b) => b.first.localeCompare(a.first))

  return (
    <div className="footprint">
      <header className="head"><div><h1 className="title">足迹</h1><p className="sub">打过卡的地方会落到地图上</p></div></header>

      <div className="fp-layer" role="tablist" aria-label="地图">
        {(['world', 'china'] as const).map(l => (
          <button key={l} type="button" role="tab" aria-selected={layer === l} className={layer === l ? 'on' : ''} disabled={l === 'world' && !world} onClick={() => setLayer(l)}>{l === 'world' ? '世界' : '中国'}</button>
        ))}
      </div>

      {layer === 'world' && world && worldProject ? (
        <>
          <div className="fp-stats">
            <div><b className="mono">{fp.countries.size}</b><span>个国家和地区</span></div>
            <div><b className="mono">{fp.cities.size}</b><span>个国内城市</span></div>
            <div><b className="mono">{tripCount}</b><span>次旅程</span></div>
          </div>
          <div className="fp-map">
            <svg viewBox={`0 0 ${world.width} ${world.height}`} role="img" aria-label={`去过 ${fp.countries.size} 个国家和地区：${countries.map(c => countryName.get(c.code) ?? c.code).join('、')}`}>
              {world.countries.map(c => (
                <path key={c.code} d={c.d} className={'fp-prov fp-country ' + toneOf(fp.countries.get(c.code)) + (c.code === 'CN' ? ' fp-cn' : '')} onClick={() => openCountry(c.code)}>
                  <title>{c.name}{c.code === 'CN' ? '（点开看各省）' : ''}</title>
                </path>
              ))}
              <path d={world.jd} className="fp-jd" />
              {fp.points.map((pt, i) => { const [x, y] = worldProject(pt.lng, pt.lat); return <circle key={i} cx={x} cy={y} r={2.6} className="fp-pt" /> })}
            </svg>
            <div className="fp-legend"><span><i className="fp-1" />去过 1 次</span><span><i className="fp-2" />2 次以上</span><span><i className="fp-dot" />打卡点</span></div>
          </div>

          <div className="section-h"><h2>去过的国家和地区</h2><small>点中国看各省</small></div>
          {countries.length === 0 ? <p className="empty">还没有打过卡。旅途中点「到了」，那里就会出现在这张图上。</p> : (
            <div className="card-list">
              {countries.map(v => (
                <button key={v.code} type="button" className="card-btn" onClick={() => openCountry(v.code)}>
                  <i className={'cdot ' + toneOf(v)} aria-hidden="true" />
                  <span className="cbody">
                    <span className="cname">{countryName.get(v.code) ?? v.code}</span>
                    <span className="csub">{v.trips} 次 · 第一次 {v.first.slice(0, 7).replace('-', ' 年 ')} 月{v.code === 'CN' ? ` · ${fp.provinces.size} 个省` : ''}</span>
                  </span>
                  <svg className="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="fp-stats">
            <div><b className="mono">{fp.provinces.size}</b><span>个省</span></div>
            <div><b className="mono">{fp.cities.size}</b><span>个城市</span></div>
            <div><b className="mono">{tripCount}</b><span>次旅程</span></div>
          </div>
          <div className="fp-map">
            <svg viewBox={`0 0 ${map.width} ${MAIN_H}`} role="img" aria-label={`去过 ${fp.provinces.size} 个省：${provinces.map(p => NAMES[p.code]).join('、')}`}>
              {chinaShapes(true)}
              <g className="fp-inset">
                <rect x="838" y="462" width="158" height="254" className="fp-inset-frame" />
                <svg x="838" y="462" width="158" height="232" viewBox={`${INSET.x} ${INSET.y} ${INSET.w} ${INSET.h}`} preserveAspectRatio="xMidYMid meet">{chinaShapes(false)}</svg>
                <text x="917" y="708" textAnchor="middle" className="fp-inset-label">南海诸岛</text>
              </g>
            </svg>
            <div className="fp-legend"><span><i className="fp-1" />去过 1 次</span><span><i className="fp-2" />2 次以上</span><span><i className="fp-dot" />打卡点</span></div>
          </div>

          <div className="section-h"><h2>去过的省</h2><small>点一个看具体地方</small></div>
          {provinces.length === 0 ? <p className="empty">国内还没有打过卡。旅途中点「到了」，那里就会出现在这张图上。</p> : (
            <div className="card-list">
              {provinces.map(v => (
                <button key={v.code} type="button" className="card-btn" onClick={() => setPick({ layer: 'china', code: v.code })}>
                  <i className={'cdot ' + toneOf(v)} aria-hidden="true" />
                  <span className="cbody">
                    <span className="cname">{NAMES[v.code] ?? v.code}</span>
                    <span className="csub">{v.trips} 次 · 第一次 {v.first.slice(0, 7).replace('-', ' 年 ')} 月</span>
                  </span>
                  <svg className="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <Sheet open={!!pick} onClose={() => setPick(null)} title={pickName} done="关闭" doneTone="plain">
        {detail.map(({ trip, places }) => (
          <div key={trip.id} className="fp-trip">
            <b>{trip.title}</b><small className="mono">{trip.startDate}</small>
            <p>{places.join('、')}</p>
          </div>
        ))}
      </Sheet>
    </div>
  )
}
