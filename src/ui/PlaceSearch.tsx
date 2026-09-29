// 在高德里搜地方：选中一条，名字和坐标、行政区划、高德 id 一起写进站点。
import { useEffect, useRef, useState } from 'react'
import { AmapError, searchPlaces, type Place } from '../geo/amap'
import { Sheet } from './kit/Sheet'
import { useSettings } from './Settings'

interface Props {
  open: boolean
  keyword: string
  city?: string
  onPick: (p: Place) => void
  onClose: () => void
}

export function PlaceSearch({ open, keyword, city, onPick, onClose }: Props) {
  const { amapKey } = useSettings()
  const [q, setQ] = useState(keyword)
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'loading' } | { kind: 'done'; list: Place[] } | { kind: 'error'; msg: string }>({ kind: 'idle' })
  const seq = useRef(0)

  const run = async (text: string) => {
    if (!text.trim()) return
    const my = ++seq.current
    setState({ kind: 'loading' })
    try {
      const list = await searchPlaces(text.trim(), amapKey, { city })
      if (my === seq.current) setState({ kind: 'done', list })
    } catch (e) {
      if (my === seq.current) setState({ kind: 'error', msg: e instanceof AmapError ? e.message : '搜索失败' })
    }
  }
  // 打开时直接用站点现在的名字搜一次
  useEffect(() => { if (open) { setQ(keyword); if (amapKey) run(keyword); else setState({ kind: 'idle' }) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet open={open} onClose={onClose} title="在高德里找" done="取消" doneTone="plain">
      {!amapKey ? (
        <p className="sheet-note">先在「同行」页右上角的设置里填上高德 Key（「Web服务」类型），才能搜地方、算车程。</p>
      ) : (
        <>
          <form className="search-row" onSubmit={e => { e.preventDefault(); run(q) }}>
            <input className="kinput" value={q} onChange={e => setQ(e.target.value)} placeholder="地名、店名" enterKeyHint="search" aria-label="搜索地方" />
            <button type="submit" className="kbtn primary">搜</button>
          </form>
          {city && <p className="sheet-note">优先在「{city}」附近找</p>}
          {state.kind === 'loading' && <p className="sheet-note" aria-live="polite">正在找…</p>}
          {state.kind === 'error' && <p className="issue-msg lv-error" role="alert">{state.msg}</p>}
          {state.kind === 'done' && (state.list.length === 0 ? <p className="sheet-note">没找到，换个叫法试试</p> : (
            <div className="card-list">
              {state.list.map(p => (
                <button key={p.poi.amapId ?? p.name + p.poi.lng} type="button" className="card-btn place" onClick={() => onPick(p)}>
                  <span className="cbody">
                    <span className="cname">{p.name}</span>
                    <span className="csub">{[p.area, p.address].filter(Boolean).join(' · ')}</span>
                    {p.type && <span className="ctags"><span>{p.type.split(';').pop()}</span></span>}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </>
      )}
    </Sheet>
  )
}
