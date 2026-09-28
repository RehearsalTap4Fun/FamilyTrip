// 「足迹」：所有旅程里打过卡的点，按省着色、按点落图。南海诸岛放在右下角的插图框里（国内地图的惯例）。
import { useMemo, useState } from 'react'
import { footprint, provinceOf } from '@core/footprint'
import type { Trip } from '@core/types'
import map from '../data/china-map.json'
import { Sheet } from './kit/Sheet'

interface Props { trips: Trip[] }

// 主图只画到海南以南一点，南海诸岛进插图
const MAIN_H = 720
const INSET = { x: 511, y: 573, w: 325, h: 442 }
const project = (lng: number, lat: number) => [(lng * map.k - map.minX) * map.scale, (-lat - map.minY) * map.scale]
const NAMES = Object.fromEntries(map.provinces.map(p => [p.adcode, p.name]))

export function FootprintPage({ trips }: Props) {
  const fp = useMemo(() => footprint(trips), [trips])
  const [pick, setPick] = useState<string | null>(null)
  const tone = (code: string) => {
    const v = fp.provinces.get(code)
    return !v ? 'fp-none' : v.trips >= 2 ? 'fp-2' : 'fp-1'
  }
  const provinces = [...fp.provinces.values()].sort((a, b) => b.first.localeCompare(a.first))
  const tripCount = new Set(fp.points.map(p => p.tripId)).size

  // 选中省份里去过的地方，按旅程分组
  const detail = pick ? trips.map(t => ({
    trip: t,
    places: t.days.flatMap(d => d.stops).filter(s => s.status === 'done' && s.poi?.adcode && provinceOf(s.poi.adcode) === pick).map(s => s.name),
  })).filter(x => x.places.length) : []

  const shapes = (withLabels: boolean) => (
    <>
      {map.provinces.map(p => (
        <path key={p.adcode} d={p.d} className={'fp-prov ' + tone(p.adcode)} onClick={() => fp.provinces.has(p.adcode) && setPick(p.adcode)}>
          <title>{p.name}</title>
        </path>
      ))}
      <path d={map.jd} className="fp-jd" />
      {fp.points.map((pt, i) => { const [x, y] = project(pt.lng, pt.lat); return <circle key={i} cx={x} cy={y} r={withLabels ? 4.5 : 3} className="fp-pt" /> })}
    </>
  )

  return (
    <div className="footprint">
      <header className="head"><div><h1 className="title">足迹</h1><p className="sub">打过卡的地方会落到地图上</p></div></header>

      <div className="fp-stats">
        <div><b className="mono">{fp.provinces.size}</b><span>个省</span></div>
        <div><b className="mono">{fp.cities.size}</b><span>个城市</span></div>
        <div><b className="mono">{tripCount}</b><span>次旅程</span></div>
      </div>

      <div className="fp-map">
        <svg viewBox={`0 0 ${map.width} ${MAIN_H}`} role="img" aria-label={`去过 ${fp.provinces.size} 个省：${provinces.map(p => NAMES[p.code]).join('、')}`}>
          {shapes(true)}
          <g className="fp-inset">
            <rect x="838" y="462" width="158" height="254" className="fp-inset-frame" />
            <svg x="838" y="462" width="158" height="232" viewBox={`${INSET.x} ${INSET.y} ${INSET.w} ${INSET.h}`} preserveAspectRatio="xMidYMid meet">{shapes(false)}</svg>
            <text x="917" y="708" textAnchor="middle" className="fp-inset-label">南海诸岛</text>
          </g>
        </svg>
        <div className="fp-legend"><span><i className="fp-1" />去过 1 次</span><span><i className="fp-2" />2 次以上</span><span><i className="fp-dot" />打卡点</span></div>
      </div>

      <div className="section-h"><h2>去过的省</h2><small>点一个看具体地方</small></div>
      {provinces.length === 0 ? <p className="empty">还没有打过卡。旅途中点「到了」，那里就会出现在这张图上。</p> : (
        <div className="card-list">
          {provinces.map(v => (
            <button key={v.code} type="button" className="card-btn" onClick={() => setPick(v.code)}>
              <i className={'cdot ' + tone(v.code)} aria-hidden="true" />
              <span className="cbody">
                <span className="cname">{NAMES[v.code] ?? v.code}</span>
                <span className="csub">{v.trips} 次 · 第一次 {v.first.slice(0, 7).replace('-', ' 年 ')} 月</span>
              </span>
              <svg className="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
            </button>
          ))}
        </div>
      )}

      <Sheet open={!!pick} onClose={() => setPick(null)} title={pick ? NAMES[pick] ?? '' : ''} done="关闭" doneTone="plain">
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
