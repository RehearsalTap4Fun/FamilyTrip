// 站点头图：高德收录的第一张照片。新排的站点自带（Stop.photo，搜地点时顺便拿）；以前排好的按高德 POI id 补查，
// 补查结果只存在这台设备上（localStorage，不改行程、不同步），一次最多 10 个一起问。国外的地方先不放（Google 的照片要另外付费）。
import { useEffect, useState } from 'react'
import type { Stop } from '@core/types'
import { photoByName, photosById } from '../geo/amap'
import { inChina } from '../geo/inChina'
import { useSettings } from './Settings'

const KEY = 'tonglu.photos'
const MAX = 800
let cache: Record<string, string | ''> | null = null
const load = (): Record<string, string | ''> => {
  if (cache) return cache
  try { cache = JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { cache = {} }
  return cache!
}
const save = () => {
  try {
    const c = load(), keys = Object.keys(c)
    if (keys.length > MAX) for (const k of keys.slice(0, keys.length - MAX)) delete c[k]
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch { /* 存不了就算了，下次再查 */ }
}

// 同一轮渲染里要的 id 攒一下，一起问
const want = new Set<string>()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null
function request(id: string, key: string) {
  want.add(id)
  if (timer) return
  timer = setTimeout(async () => {
    timer = null
    const ids = [...want]; want.clear()
    try {
      const got = await photosById(ids, key)
      const c = load()
      for (const id of ids) c[id] = got.get(id) ?? '' // 查过没有的记成空，不再反复问
      save()
    } catch { /* 网络不好：不记，下次打开再试 */ }
    listeners.forEach(f => f())
  }, 60)
}

// 没有 POI id 的按名字搜：一个一个问（同一个名字 + 位置只问一次）
const asking = new Set<string>()
async function requestByName(k: string, name: string, at: { lng: number; lat: number }, key: string) {
  if (asking.has(k)) return
  asking.add(k)
  try {
    const u = await photoByName(name, at, key)
    load()[k] = u ?? ''
    save()
  } catch { /* 下次再试 */ } finally { asking.delete(k) }
  listeners.forEach(f => f())
}

/** 这一站的头图地址；没有返回 undefined（需要的话在后台补查，查到了自动刷新） */
export function usePhoto(s?: Stop): string | undefined {
  const { maps } = useSettings()
  const [, bump] = useState(0)
  const id = s?.poi?.amapId
  const nameKey = s?.poi && !id ? `n:${s.name}@${s.poi.lng.toFixed(3)},${s.poi.lat.toFixed(3)}` : undefined
  const ck = id ?? nameKey
  const known = s?.photo ?? (ck ? load()[ck] : undefined)
  useEffect(() => {
    if (known !== undefined || !ck || !maps.amap || !s?.poi || !inChina(s.poi)) return
    const f = () => bump(x => x + 1)
    listeners.add(f)
    if (id) request(id, maps.amap)
    else requestByName(ck, s.name, s.poi, maps.amap)
    return () => { listeners.delete(f) }
  }, [ck, id, known, maps.amap, s?.poi, s?.name])
  return known || undefined
}

function Img({ url, alt, onBad }: { url: string; alt: string; onBad: () => void }) {
  // 不带来源页（高德的图床按来源页限制）、懒加载
  return <img src={url} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={onBad} />
}

/** 哪些站在列表里占一格小图：景点、吃饭、住处（服务区、午睡、开车不占） */
export const hasMedia = (s: Stop) => (s.kind === 'sight' || s.kind === 'food' || (s.kind === 'lodging' && !s.home)) && !s.tags?.includes('restroom')

/**
 * 列表行里的小方图：固定占一格（没有图也留着），上下行的时长、把手才对得齐。
 * 只给景点、吃饭、住处；开车、服务区、午睡这类不占格（调用方不放）
 */
export function StopThumb({ s }: { s: Stop }) {
  const url = usePhoto(s)
  const [bad, setBad] = useState(false)
  return <span className={'media-slot' + (url && !bad ? ' has' : '')} aria-hidden="true">{url && !bad && <Img url={url} alt="" onBad={() => setBad(true)} />}</span>
}

/**
 * 大图图版：下一站卡片（card，3:1）与站点面板（sheet，16:9）顶部。两套风格各画各的：
 * 博朗是嵌在面板上的圆角小窗（同海报窗口的 1px 淡墨内描边）；地图册是细墨框加纸边的插图，下面一行仿宋图注。
 * 没有图就什么都不画，不留空框
 */
export function PhotoPlate({ s, variant }: { s?: Stop; variant: 'card' | 'sheet' }) {
  const url = usePhoto(s)
  const [bad, setBad] = useState(false)
  if (!url || bad) return null
  return (
    // 类名加前缀：「sheet」是主面板的类名（position: fixed），直接拿来当变体会把图版钉在屏幕上
    <figure className={'photo-plate pp-' + variant}>
      <span className="pp-img"><Img url={url} alt={s?.name ?? ''} onBad={() => setBad(true)} /></span>
      <figcaption>照片　高德地图</figcaption>
    </figure>
  )
}
