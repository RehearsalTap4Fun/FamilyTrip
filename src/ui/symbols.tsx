// 图例符号。地图册的点状符号为主，路标（GB 5768）只借四样：国家高速路牌盾、黄三角警告、红圈限制牌、棕色景点方标。
import type { Member, Pet, StopKind } from '@core/types'
import type { Level } from '@core/validate'

export function SightMark({ size = 16 }: { size?: number }) {
  return (
    <svg className="sym-sight" width={size} height={size} viewBox="0 0 16 16" aria-label="景点">
      <rect width="16" height="16" rx="2" fill="var(--sign-brown)" />
      <path d="M8 3 L13 6.5 H3 Z M4 7.5h1.5v4H4z M7.25 7.5h1.5v4h-1.5z M10.5 7.5H12v4h-1.5z M3 12.3h10v1.2H3z" fill="#fff" />
    </svg>
  )
}

export function ParkMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-label="服务区">
      <rect x=".5" y=".5" width="13" height="13" rx="2" fill="var(--sign-green)" stroke="#fff" />
      <text x="7" y="10.4" textAnchor="middle" fontFamily="var(--sans)" fontWeight="900" fontSize="8.5" fill="#fff">服</text>
    </svg>
  )
}

export function WarnMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.9} viewBox="0 0 30 27" aria-label="留意">
      <path d="M15 2 L28 25 H2 Z" fill="var(--hwy-core)" stroke="var(--ink)" strokeWidth="2.4" strokeLinejoin="round" />
      <rect x="13.8" y="9" width="2.4" height="8" fill="var(--ink)" />
      <rect x="13.8" y="19" width="2.4" height="2.4" fill="var(--ink)" />
    </svg>
  )
}

export function RingMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-label="必改">
      <circle cx="7" cy="7" r="5.6" fill="#fff" stroke="var(--hwy)" strokeWidth="2.6" />
    </svg>
  )
}

export function TipMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-label="待核实">
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--water)" strokeWidth="1.3" strokeDasharray="2 1.5" />
      <circle cx="7" cy="7" r="1.6" fill="var(--water)" />
    </svg>
  )
}

export function LevelMark({ level, size }: { level: Level; size?: number }) {
  if (level === 'error') return <RingMark size={size} />
  if (level === 'warn') return <WarnMark size={size} />
  return <TipMark size={size} />
}

/** 国家高速路牌盾：只有路名里写了 G 编号才画 */
export function Shield({ code }: { code: string }) {
  const w = 10 + code.length * 7.2
  return (
    <svg className="shield" width={w} height="26" viewBox={`0 0 ${w} 26`} aria-label={`${code} 国家高速`}>
      <rect x="1" y="1" width={w - 2} height="24" rx="3.5" fill="var(--sign-green)" stroke="#fff" strokeWidth="1.6" />
      <rect x="1" y="1" width={w - 2} height="8" rx="3" fill="var(--hwy)" />
      <rect x=".5" y=".5" width={w - 1} height="25" rx="4" fill="none" stroke="var(--ink)" strokeWidth=".75" />
      <text x={w / 2} y="7.4" textAnchor="middle" fontFamily="var(--sans)" fontWeight="700" fontSize="5.6" fill="#fff">国家高速</text>
      <text x={w / 2} y="21.5" textAnchor="middle" fontFamily="var(--num)" fontWeight="700" fontSize="12.5" fill="#fff">{code}</text>
    </svg>
  )
}

/** 路线节点的类型：景区、服务区、歇脚、午睡、吃饭、住宿、回家、换乘、没有编号的公路 */
export type BadgeKind = 'sight' | 'sa' | 'rest' | 'nap' | 'food' | 'lodging' | 'home' | 'transit' | 'road'

export function badgeKind(s: { kind: StopKind; name: string; home?: boolean; tags?: string[] }): BadgeKind {
  if (s.kind === 'sight') return 'sight'
  if (s.kind === 'food') return 'food'
  if (s.kind === 'lodging') return s.home ? 'home' : 'lodging'
  if (s.kind === 'transit') return 'transit'
  if (s.kind === 'drive') return 'road'
  if (/服务区|停车区/.test(s.name)) return 'sa'
  // 记成「休息」的入住（「入住 束河客栈」）按住宿画
  if (/入住|客栈|酒店|民宿|宾馆/.test(s.name)) return 'lodging'
  return /午睡|补觉/.test(s.name) ? 'nap' : 'rest'
}

export const BADGE_LABEL: Record<BadgeKind, string> = { sight: '景区', sa: '服务区', rest: '歇脚', nap: '午睡', food: '餐饮', lodging: '住宿', home: '到家', transit: '换乘', road: '公路' }

/**
 * 路线节点图标（26×26）：一眼分得出是什么——
 * 景区棕牌（路标的景点方标）、服务区绿牌「服」、吃饭橙圆刀叉、住宿蓝牌床、回家房子、换乘火车；
 * 歇脚、午睡用蓝圆里的字。已打卡的右下角一个对勾
 */
export function RouteBadge({ kind, done, size = 26 }: { kind: BadgeKind; done?: boolean; size?: number }) {
  const w = '#fff'
  const body = (() => {
    switch (kind) {
      case 'sight':
        return <g><rect x="1" y="1" width="24" height="24" rx="3.5" fill="var(--sign-brown)" /><path d="M13 5 L20.5 10 H5.5 Z M7 11.5h2.2v6H7z M11.9 11.5h2.2v6h-2.2z M16.8 11.5H19v6h-2.2z M5.5 18.8h15v1.8h-15z" fill={w} /></g>
      case 'sa':
        return <g><rect x="1" y="1" width="24" height="24" rx="3.5" fill="var(--sign-green)" /><text x="13" y="18.2" textAnchor="middle" fontFamily="var(--sans)" fontWeight="900" fontSize="14" fill={w}>服</text></g>
      case 'rest':
      case 'nap':
        return <g><circle cx="13" cy="13" r="11.5" fill="var(--water)" /><text x="13" y="17.8" textAnchor="middle" fontFamily="var(--sans)" fontWeight="900" fontSize="13" fill={w}>{kind === 'nap' ? '睡' : '歇'}</text></g>
      case 'food':
        return <g><circle cx="13" cy="13" r="11.5" fill="#D9731A" /><path d="M9.3 6.5v5.2M11.3 6.5v5.2M7.3 6.5v5.2M7.3 11.7c0 1.4 4 1.4 4 0M9.3 12.4V19.5" stroke={w} strokeWidth="1.5" strokeLinecap="round" fill="none" /><path d="M17 6.5c-1.8 1.2-2 4.6-.2 5.8V19.5" stroke={w} strokeWidth="1.6" strokeLinecap="round" fill="none" /></g>
      case 'lodging':
        return <g><rect x="1" y="1" width="24" height="24" rx="3.5" fill="#2C5DA8" /><path d="M5.5 8v11M5.5 15.5h15V19M5.5 13h4.5a1.8 1.8 0 0 0 0-3.6H5.5" stroke={w} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M11.5 13V10.6a1.6 1.6 0 0 1 1.6-1.6h5.2a2.2 2.2 0 0 1 2.2 2.2V15.5" stroke={w} strokeWidth="1.7" strokeLinejoin="round" fill="none" /></g>
      case 'home':
        return <g><rect x="1" y="1" width="24" height="24" rx="3.5" fill="var(--ink)" /><path d="M6 12.5 L13 6.5 L20 12.5 M8 11v8h10v-8 M11.5 19v-4.5h3V19" stroke={w} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" /></g>
      case 'transit':
        return <g><rect x="1" y="1" width="24" height="24" rx="3.5" fill="var(--ink)" /><rect x="7.5" y="5.5" width="11" height="12" rx="2.5" stroke={w} strokeWidth="1.6" fill="none" /><path d="M7.5 12h11M10 20.5l-1.5 1.5M16 20.5l1.5 1.5" stroke={w} strokeWidth="1.6" strokeLinecap="round" /><circle cx="10.3" cy="14.8" r="1" fill={w} /><circle cx="15.7" cy="14.8" r="1" fill={w} /></g>
      case 'road':
      default:
        return <g><rect x="3" y="3" width="20" height="20" rx="3" fill="#5B5B57" /><path d="M10 6.5 L8 19.5 M16 6.5 L18 19.5" stroke={w} strokeWidth="1.6" strokeLinecap="round" /><path d="M13 7v2.4M13 11.8v2.4M13 16.6V19" stroke={w} strokeWidth="1.6" strokeLinecap="round" /></g>
    }
  })()
  return (
    <svg className={'route-badge b-' + kind + (done ? ' done' : '')} width={size} height={size} viewBox="0 0 26 26" role="img" aria-label={BADGE_LABEL[kind] + (done ? '（已打卡）' : '')}>
      {body}
      {done && <g><circle cx="21" cy="21" r="5" fill="var(--ink)" stroke="#fff" strokeWidth="1.3" /><path d="M18.6 21.1l1.6 1.6 3-3.2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /></g>}
    </svg>
  )
}

/** 同行图例：成人实心圆、老人半圆、小孩红点、宠物菱形 */
export function MemberGlyph({ m, size = 16 }: { m: Member; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
      {m.role === 'adult' && <circle cx="9" cy="9" r="6" fill="var(--ink)" />}
      {m.role === 'elder' && (<><circle cx="9" cy="9" r="6" fill="#fff" stroke="var(--ink)" strokeWidth="1.4" /><path d="M9 3a6 6 0 0 1 0 12z" fill="var(--ink)" /></>)}
      {m.role === 'kid' && <circle cx="9" cy="9" r="4" fill="var(--hwy)" />}
    </svg>
  )
}

export function PetGlyph({ size = 16 }: { p?: Pet; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
      <rect x="4" y="4" width="10" height="10" fill="none" stroke="var(--ink)" strokeWidth="1.4" transform="rotate(45 9 9)" />
    </svg>
  )
}

export function TabIcon({ name }: { name: 'today' | 'trip' | 'party' | 'ratings' | 'footprint' }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      {name === 'today' && (<><circle cx="12" cy="12" r="8" {...p} /><circle cx="12" cy="12" r="3" fill="currentColor" /></>)}
      {name === 'trip' && <path d="M5 4v16M5 4h11l-2 4 2 4H5" {...p} />}
      {name === 'party' && (<><circle cx="8" cy="9" r="3" {...p} /><circle cx="16" cy="10" r="2.4" {...p} /><path d="M3 19c0-3 2.2-5 5-5s5 2 5 5M13 19c.3-2.4 1.5-4 3.4-4 2 0 3.3 1.6 3.6 4" {...p} /></>)}
      {name === 'ratings' && (<><path d="M4 6h16M4 12h16M4 18h10" {...p} /><circle cx="19" cy="18" r="2" fill="currentColor" /></>)}
      {name === 'footprint' && (<><path d="M4 7l5-3 6 3 5-3v13l-5 3-6-3-5 3z" {...p} /><path d="M9 4v13M15 7v13" {...p} /></>)}
    </svg>
  )
}

const icon = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, 'aria-hidden': true }
export const IconX = () => <svg {...icon}><path d="M4 4l8 8M12 4l-8 8" /></svg>
export const IconUp = () => <svg {...icon}><path d="M8 13V3M4 7l4-4 4 4" /></svg>
export const IconDown = () => <svg {...icon}><path d="M8 3v10M4 9l4 4 4-4" /></svg>

/** 出行方式的图例符号：自驾=高速线段、跟团=旗、公共交通=铁路线（黑白相间） */
export function ModeGlyph({ mode }: { mode: 'selfDrive' | 'tour' | 'transit' }) {
  return (
    <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true" className="mode-glyph">
      {mode === 'selfDrive' && (<><rect x="0" y="3" width="22" height="6" fill="var(--hwy)" /><rect x="0" y="4.8" width="22" height="2.4" fill="var(--hwy-core)" /></>)}
      {mode === 'tour' && (<><path d="M6 1v11" stroke="var(--ink)" strokeWidth="1.4" /><path d="M6 1.5h10l-2.5 3 2.5 3H6z" fill="var(--hwy)" /></>)}
      {mode === 'transit' && (<><rect x="0" y="4" width="22" height="4" fill="#fff" stroke="var(--ink)" strokeWidth="1" /><path d="M0 6h4M8 6h4M16 6h4" stroke="var(--ink)" strokeWidth="4" /></>)}
    </svg>
  )
}

/**
 * 线条图标：同一套 1.6 描边、20 格，给面板、磁贴、出行方式用（博朗面板那种安静的印字）。
 * 地图册的点状符号（StopSymbol / ModeGlyph）只留在地图册页面里。
 */
const LINE: Record<string, string> = {
  sight: 'M2.5 16.5 7.5 8l3 5 2-3 5 6.5ZM12 4.5a1.5 1.5 0 1 0 0 .01',
  food: 'M4 10h12a6 6 0 0 1-12 0ZM7 16.5h6M8 3l1.5 5M12.5 3 11 8',
  rest: 'M4 8h9v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4ZM13 9h1.5a2 2 0 0 1 0 4H13M7 3.5c-.8 1 .8 1.5 0 2.5M10 3.5c-.8 1 .8 1.5 0 2.5',
  lodging: 'M2.5 15.5V6M2.5 11h15v4.5M17.5 11V9a2 2 0 0 0-2-2H9v4M5.5 9.5a1.2 1.2 0 1 0 0-.01',
  drive: 'M4 12.5 5.5 7.5a2 2 0 0 1 1.9-1.4h5.2a2 2 0 0 1 1.9 1.4l1.5 5M3 12.5h14v3H3ZM5 15.5v1.5M15 15.5v1.5M6 14h.01M14 14h.01',
  transit: 'M5.5 3h9a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM3.5 9h13M7 17l-1.5 1.5M13 17l1.5 1.5M7 14l-1 3M13 14l1 3',
  tour: 'M5 18V2.5M5 3.5h10l-2.5 3.5L15 10.5H5',
}
export function LineIcon({ name, size = 20 }: { name: StopKind | 'selfDrive' | 'tour'; size?: number }) {
  const d = LINE[name === 'selfDrive' ? 'drive' : name]
  return (
    <svg className="line-icon" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}
