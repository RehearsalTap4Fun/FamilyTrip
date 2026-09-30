// 现居地、行程的起点终点：一个定了位的地方，点「搜地点」选；可以设回现居地或清掉。
import { hasMaps } from '../geo/maps'
import { useState } from 'react'
import type { PlaceRef, Trip } from '@core/types'
import { Field } from './kit/controls'
import { PlaceSearch } from './PlaceSearch'
import { useSettings } from './Settings'

/** 现居地在行程里叫「家」 */
export const homeRef = (home?: PlaceRef): PlaceRef | undefined => (home ? { name: '家', poi: home.poi, ...(home.area ? { area: home.area } : {}) } : undefined)

const same = (a?: PlaceRef, b?: PlaceRef) => !!a && !!b && Math.abs(a.poi.lng - b.poi.lng) < 1e-6 && Math.abs(a.poi.lat - b.poi.lat) < 1e-6

export function PlaceField({ label, hint, value, onChange, empty, keyword }: {
  label: string; hint?: string; value?: PlaceRef; onChange: (v?: PlaceRef) => void
  /** 没设时显示的字 */
  empty: string
  keyword?: string
}) {
  const { home, maps } = useSettings()
  // 高德或国外地图有一个就能搜地点、算车程
  const canMap = hasMaps(maps)
  const [open, setOpen] = useState(false)
  const atHome = same(value, home)
  return (
    <Field label={label} hint={hint}>
      <div className="loc-row">
        <span className={'loc ' + (value ? 'on' : 'off')}>{value ? (atHome && value.name === '家' ? `家 · ${home!.name}` : value.name) : empty}</span>
        <span className="loc-acts">
          {home && !atHome && <button type="button" className="linkish" onClick={() => onChange(homeRef(home))}>用现居地</button>}
          {value && <button type="button" className="linkish" onClick={() => onChange(undefined)}>不设</button>}
          <button type="button" className="kbtn" disabled={!canMap} title={canMap ? undefined : '先在「同行」页右上角的设置里填高德 Key'} onClick={() => setOpen(true)}>搜地点</button>
        </span>
      </div>
      <PlaceSearch open={open} keyword={keyword ?? (value && value.name !== '家' ? value.name : '')} onClose={() => setOpen(false)} onPick={p => { onChange({ name: p.name, poi: p.poi, ...(p.area ? { area: p.area } : {}) }); setOpen(false) }} />
    </Field>
  )
}

/** 行程的起点、终点：第一天从起点出发、最后一天回到终点，排程时算进路程 */
export function TripEnds({ from, to, onChange }: { from?: PlaceRef; to?: PlaceRef; onChange: (from?: PlaceRef, to?: PlaceRef) => void }) {
  return (
    <>
      <PlaceField label="从哪出发" hint="第一天排去程" value={from} empty="不设（从第一站算起）" onChange={v => onChange(v, to)} />
      <PlaceField label="最后回到" hint="最后一天排返程" value={to} empty="不设（最后一晚住当地）" onChange={v => onChange(from, v)} />
    </>
  )
}

/** 一句话说清起点终点，给面板顶上用 */
export function endsLine(trip: Trip): string {
  const f = trip.plan?.from?.name ?? trip.plan?.origin, t = trip.plan?.to?.name
  if (f && t) return f === t ? `从${f}出发、回到${f}` : `从${f}出发、回到${t}`
  if (f) return `从${f}出发`
  if (t) return `最后回到${t}`
  return ''
}
