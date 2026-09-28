// 「红黑榜」：列表按这趟同行的人排序；「记一笔」拉起面板：先按红或黑，再写名字，最后点跟谁有关。
import { useState } from 'react'
import { partyOnDay } from '@core/party'
import { aggregate, partyFit, placeKey, rankForParty, type FitTag, type PlaceVerdict, type Rating, type RatingKind } from '@core/ratings'
import type { Trip } from '@core/types'
import { uid } from '../store/state'
import { Chips, Field, Segmented } from './kit/controls'
import { Sheet } from './kit/Sheet'
import { useToast } from './kit/Toast'
import { SightMark } from './symbols'

const KIND: Record<RatingKind, string> = { food: '吃', lodging: '住', sight: '玩' }
const FIT: Record<FitTag, string> = { elder: '老人', kid: '小孩', toddler: '幼儿', pet: '宠物', drive: '自驾', wheelchair: '轮椅' }

interface Props { trip: Trip; ratings: Rating[]; onRatings: (r: Rating[]) => void; dayIndex: number }

type DraftR = { kind: RatingKind; name: string; city: string; verdict: 'red' | 'black' | null; note: string; fit: FitTag[] }
const empty = (fit: FitTag[]): DraftR => ({ kind: 'food', name: '', city: '', verdict: null, note: '', fit })

export function RatingsPage({ trip, ratings, onRatings, dayIndex }: Props) {
  const dp = partyOnDay(trip.party, Math.max(0, Math.min(dayIndex, trip.days.length - 1)))
  const fit = partyFit(dp)
  const toast = useToast()
  const [draft, setDraft] = useState<DraftR | null>(null)
  const [viewing, setViewing] = useState<PlaceVerdict | null>(null)
  const list = rankForParty(aggregate(ratings), dp)
  // 新记一笔时，默认勾上这趟同行里会受影响的人群
  const defaultFit = ([...fit] as FitTag[]).filter(f => f !== 'drive' && f !== 'kid')

  const save = () => {
    if (!draft?.name.trim() || !draft.verdict) return
    onRatings([{ id: uid('r'), kind: draft.kind, name: draft.name.trim(), city: draft.city.trim() || undefined, verdict: draft.verdict, note: draft.note.trim() || undefined, fit: draft.fit, by: '我', tripId: trip.id, at: Date.now() }, ...ratings])
    setDraft(null)
  }
  const removePlace = (v: PlaceVerdict) => {
    const before = ratings
    onRatings(ratings.filter(r => placeKey(r) !== v.key))
    setViewing(null)
    toast(`已删除 ${v.name}`, () => onRatings(before))
  }

  return (
    <div className="ratings2">
      <header className="head"><div><h1 className="title">红黑榜</h1><p className="sub">踩过的坑、挖到的好地方；排行程时会避开黑榜</p></div></header>

      <div className="rate-keys">
        <button type="button" className="rate-key red" onClick={() => setDraft({ ...empty(defaultFit), verdict: 'red' })}><b>红</b>记一个好地方</button>
        <button type="button" className="rate-key black" onClick={() => setDraft({ ...empty(defaultFit), verdict: 'black' })}><b>黑</b>记一个坑</button>
      </div>

      {list.length === 0 ? (
        <p className="empty">还没有记录，按上面的红或黑记一笔。</p>
      ) : (
        <div className="card-list">
          {list.map(v => {
            const rel = v.fit.filter(f => fit.has(f))
            return (
              <button key={v.key} type="button" className={'card-btn rate-card v-' + v.verdict} onClick={() => setViewing(v)}>
                <span className="badge">{v.verdict === 'red' ? '红' : v.verdict === 'black' ? '黑' : '半'}</span>
                <span className="cbody">
                  <span className="cname">{v.kind === 'sight' && <SightMark size={14} />}{v.name}{v.city && <small> {v.city}</small>}</span>
                  {v.notes[0] && <span className="csub">{v.notes[0]}</span>}
                  {rel.length > 0 && <span className="ctags">{rel.map(f => <span key={f}>和{FIT[f]}有关</span>)}</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <Sheet open={!!draft} onClose={() => setDraft(null)} title={draft?.verdict === 'black' ? '记一个坑' : '记一个好地方'} done="记下" onDone={save} doneDisabled={!draft?.name.trim() || !draft?.verdict}>
        {draft && (
          <>
            <Segmented label="红榜还是黑榜" value={draft.verdict ?? 'red'} onChange={verdict => setDraft({ ...draft, verdict })}
              options={[{ value: 'red' as const, label: '红 · 好' }, { value: 'black' as const, label: '黑 · 坑' }]} />
            <Field label="是哪里"><input className="kinput" placeholder="地方名称" value={draft.name} autoFocus onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Segmented label="类别" value={draft.kind} onChange={kind => setDraft({ ...draft, kind })} options={(Object.keys(KIND) as RatingKind[]).map(k => ({ value: k, label: KIND[k] }))} />
            <Field label="一句话" hint="可以不写"><input className="kinput" placeholder={draft.verdict === 'black' ? '坑在哪' : '好在哪'} value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} /></Field>
            <Field label="跟谁有关" hint="带着这些人出门时优先提醒"><Chips label="跟谁有关" values={draft.fit} onChange={f => setDraft({ ...draft, fit: f })} options={(Object.keys(FIT) as FitTag[]).map(f => ({ value: f, label: FIT[f] }))} /></Field>
            <Field label="城市" hint="可以不写"><input className="kinput" value={draft.city} onChange={e => setDraft({ ...draft, city: e.target.value })} /></Field>
          </>
        )}
      </Sheet>

      <Sheet open={!!viewing} onClose={() => setViewing(null)} title={viewing?.name ?? ''} done="关闭" doneTone="plain"
        footer={viewing ? <button type="button" className="kbtn danger wide" onClick={() => removePlace(viewing)}>删除这条</button> : undefined}>
        {viewing && (
          <>
            <p className="sheet-note">{KIND[viewing.kind]}{viewing.city ? ` · ${viewing.city}` : ''} · 红 {viewing.red} 黑 {viewing.black}</p>
            {viewing.notes.map((t, i) => <p key={i} className="issue-msg">{t}</p>)}
            {viewing.fit.length > 0 && <p className="sheet-note">跟{viewing.fit.map(f => FIT[f]).join('、')}有关</p>}
          </>
        )}
      </Sheet>
    </div>
  )
}
