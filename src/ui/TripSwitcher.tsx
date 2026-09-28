// 「我的行程」：按进行中 / 计划中 / 去过的分组，点一下切过去，左滑删除（可撤销），最下面新建。
import { sortTrips, STATUS_LABEL, tripStatus, type TripStatus } from '@core/trips'
import type { Trip } from '@core/types'
import { fmtShort, MODE_LABEL } from './format'
import { Sheet } from './kit/Sheet'
import { SwipeList } from './kit/SwipeList'

interface Props {
  open: boolean
  trips: Trip[]
  currentId: string
  now: Date
  onPick: (id: string) => void
  onDelete: (id: string) => void
  onNew: () => void
  onJoin: () => void
  onClose: () => void
  onExited?: () => void
}

const GROUPS: TripStatus[] = ['ongoing', 'planning', 'done']

export function tripLine(t: Trip): string {
  const people = t.party.members.length + (t.party.pets.length ? ` 人 + ${t.party.pets.length} 宠` : ' 人')
  return `${fmtShort(t.startDate, 0)}–${fmtShort(t.startDate, t.days.length - 1)} · ${t.days.length} 天 · ${MODE_LABEL[t.party.mode]} · ${people}`
}

export function TripSwitcher({ open, trips, currentId, now, onPick, onDelete, onNew, onJoin, onClose, onExited }: Props) {
  const sorted = sortTrips(trips, now)
  const canDelete = trips.length > 1
  return (
    <Sheet open={open} onClose={onClose} onExited={onExited} title="我的行程" done="关闭" doneTone="plain"
      footer={<div className="switch-foot">
        <button type="button" className="kbtn primary wide" onClick={onNew}>＋ 新建行程</button>
        <button type="button" className="kbtn wide" onClick={onJoin}>加入同行好友的行程</button>
      </div>}>
      {GROUPS.map(g => {
        const list = sorted.filter(t => tripStatus(t, now) === g)
        if (!list.length) return null
        return (
          <section key={g} className="trips-group">
            <h3>{STATUS_LABEL[g]}</h3>
            <SwipeList
              onOpen={onPick}
              items={list.map(t => ({
                id: t.id,
                actions: canDelete ? [{ label: '删除', tone: 'danger' as const, onAct: () => onDelete(t.id) }] : undefined,
                content: (
                  <span className={'trip-row' + (t.id === currentId ? ' on' : '')}>
                    <span className="cbody">
                      <span className="cname">{t.title}{t.sample && <em>示例</em>}{t.share && <em className="shared">共享</em>}</span>
                      <span className="csub">{tripLine(t)}</span>
                    </span>
                    {t.id === currentId && <svg className="tick" viewBox="0 0 16 16" aria-label="正在看"><path d="M3 8.5l3.2 3L13 5" /></svg>}
                  </span>
                ),
              }))}
            />
          </section>
        )
      })}
      {canDelete && <p className="sheet-note">左滑可以删除；删错了能撤销。删掉共享的行程只是你自己退出，好友那边不受影响。</p>}
    </Sheet>
  )
}

/** 行程页首屏的入口：看全部行程、新建（这一页的主操作，放在最显眼处）；新建时定过排法的行程再给一个「排这趟」 */
export function TripActions({ count, onSwitch, onNew, trip, onPlan }: { count: number; onSwitch: () => void; onNew: () => void; trip?: Trip; onPlan?: () => void }) {
  const flow = trip?.plan?.flow
  return (
    <>
      <div className="trip-actions">
        <button type="button" className="kbtn" onClick={onSwitch}>我的行程<span className="n mono">{count}</span></button>
        <button type="button" className="kbtn primary" onClick={onNew}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>新建行程
        </button>
      </div>
      {flow === 'places' && onPlan && (
        <button type="button" className="card-btn plan-cta" onClick={onPlan}>
          <span className="cbody">
            <span className="cname">{trip?.plan?.places?.length ? '改地点，重新排' : '排这趟：列出要去的地方'}</span>
            <span className="csub">{trip?.plan?.places?.length ? `上次排了 ${trip.plan.places.length} 个点` : '按同行人的限制，自动安排开车、吃饭、午睡和住处'}</span>
          </span>
          <svg className="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
        </button>
      )}
      {flow === 'region' && (
        <p className="sheet-note plan-soon">「{trip?.plan?.region}」的去处推荐还在做（导入攻略、搜索推荐），先可以手动加站。</p>
      )}
    </>
  )
}
