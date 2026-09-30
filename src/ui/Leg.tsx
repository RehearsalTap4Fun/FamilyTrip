// 公共交通的一段路：从上一站怎么到这里（步行、坐哪条线从哪站到哪站、打车）。「今天」页当前站下面一行、站点面板里逐步列出。
import type { Leg, LegStep, Poi, Stop } from '@core/types'
import { inChina } from '../geo/inChina'

const BY: Record<LegStep['by'], string> = { walk: '步行', subway: '地铁', bus: '公交', rail: '火车', tram: '电车', ferry: '轮渡', other: '' }

/** 一句话：「地铁2号线 → 公交 K18 · 25 分」「步行 8 分」「打车 15 分」 */
export function legText(leg: Leg): string {
  if (leg.by === 'walk') return `步行 ${leg.min} 分`
  if (leg.by === 'taxi') return `${leg.summary.startsWith('包车') ? '包车或租车' : '打车'}约 ${leg.min} 分${/（(.+)）/.exec(leg.summary) ? `（${/（(.+)）/.exec(leg.summary)![1]}）` : ''}`
  return `${leg.summary} · ${leg.min} 分${leg.fare ? ` · ${fareText(leg.fare)}` : ''}`
}

const CUR: Record<string, string> = { JPY: '日元', CNY: '元', KRW: '韩元', USD: '美元', EUR: '欧元' }
export const fareText = (f: { amount: number; currency: string }) => `${Math.round(f.amount)} ${CUR[f.currency] ?? f.currency}`

/** 一步：「地铁 银座线：上野 → 浅草（3 站）6′」 */
export function stepText(s: LegStep): string {
  if (s.by === 'walk') return `步行 ${s.min}′`
  const what = [BY[s.by], s.line].filter(Boolean).join(' ')
  const where = s.from && s.to ? `：${s.from} → ${s.to}` : ''
  return `${what}${where}${s.stops ? `（${s.stops} 站）` : ''} ${s.min}′`
}

/** 「今天」页当前站下面：怎么去 */
export function LegLine({ s }: { s?: Stop }) {
  if (!s?.leg) return null
  return <p className="hl-line">怎么去：{legText(s.leg)}{s.leg.estimated ? '（估，到时查一下）' : ''}</p>
}

/**
 * 到地图 App 里查这段怎么坐（实时班次、换乘）：国内开高德，国外开 Google 地图。
 * Google 的接口查不了日本的公交地铁（2026-09-30 实测东京全都没有方案），在它自己的地图里能查
 */
export function mapLink(from: { lng: number; lat: number }, to: Poi, name: string): string {
  if (inChina(to)) return `https://uri.amap.com/navigation?from=${from.lng},${from.lat},出发&to=${to.lng},${to.lat},${encodeURIComponent(name)}&mode=bus&callnative=1`
  return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=transit`
}

/** 站点面板：逐步列出 */
export function LegSteps({ leg, to, name }: { leg: Leg; to?: Poi; name?: string }) {
  const steps = leg.steps?.length ? leg.steps : []
  return (
    <div className="leg-steps">
      <p className="leg-sum">{legText(leg)}{leg.estimated ? '（估算：地图没查到方案，到时查一下）' : ''}</p>
      {steps.length > 1 && <ol>{steps.map((x, i) => <li key={i} className={'by-' + x.by}>{stepText(x)}</li>)}</ol>}
      {leg.from && to && leg.by !== 'walk' && <a className="leg-link" href={mapLink(leg.from, to, name ?? '')} target="_blank" rel="noreferrer noopener">打开地图查换乘</a>}
    </div>
  )
}
