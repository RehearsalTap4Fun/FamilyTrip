// 单趟分享：「同行」页这趟旅程下面的分享卡片，和「我的行程」里的加入面板。
import { useEffect, useState } from 'react'
import type { Trip } from '@core/types'
import type { ShareLocal } from '../store/syncStore'
import { normalizeSyncCode } from '../sync/crypto'
import { inviteText } from '../sync/share'
import { Field } from './kit/controls'
import { Sheet } from './kit/Sheet'

const fmtTime = (t?: number) => {
  if (!t) return '还没同步过'
  const d = new Date(t)
  const same = d.toDateString() === new Date().toDateString()
  return (same ? '今天 ' : `${d.getMonth() + 1}/${d.getDate()} `) + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export interface ShareCardProps {
  trip: Trip
  status?: ShareLocal
  syncing: boolean
  onShare: () => void
  onSyncNow: () => void
  onStop: (deleteCloud: boolean) => void
}

export function ShareCard({ trip, status, syncing, onShare, onSyncNow, onStop }: ShareCardProps) {
  const [copied, setCopied] = useState<'' | 'invite' | 'code'>('')
  const [stopping, setStopping] = useState(false)
  const copy = async (what: 'invite' | 'code', text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1500) } catch { /* 复制不了就让人手抄 */ }
  }
  if (trip.sample) return null

  if (!trip.share) {
    return (
      <div className="cloud card-pad share-card">
        <div className="cloud-hd"><b>和同行好友一起改</b><span className="pill">没分享</span></div>
        <ul className="cloud-points">
          <li>把分享码或邀请链接发给同行的人，他们就能看到、也能改这一趟：谁打了卡、加了站、写了红黑榜，大家几秒内都能看到</li>
          <li>只分享这一趟：你的其他行程、Key 都不会给出去</li>
          <li>拿到码的人都能改，只发给一起出去的人</li>
        </ul>
        <button type="button" className="kbtn primary wide" onClick={onShare}>分享给同行好友</button>
      </div>
    )
  }

  const { code, role } = trip.share
  return (
    <div className="cloud card-pad share-card">
      <div className="cloud-hd">
        <b>{role === 'owner' ? '已分享给同行好友' : '和好友共享的行程'}</b>
        <span className={'pill ' + (syncing ? 'busy' : status?.lastError ? 'bad' : 'on')}>{syncing ? '同步中…' : status?.lastError ? '上次失败' : '共享中'}</span>
      </div>
      <p className="cloud-code mono" aria-label={code}>{code.slice(0, 14)}<br />{code.slice(15)}</p>
      <div className="foot-row">
        <button type="button" className="kbtn primary" onClick={() => copy('invite', inviteText(trip, code))}>{copied === 'invite' ? '已复制' : '复制邀请'}</button>
        <button type="button" className="kbtn" onClick={() => copy('code', code)}>{copied === 'code' ? '已复制' : '只复制码'}</button>
      </div>
      <p className="sheet-note">邀请里带着链接，发到微信群里，好友点开就能加入。上次同步 {fmtTime(status?.lastSyncAt)}{status?.lastError ? ` · ${status.lastError}` : ''}</p>
      <div className="foot-row">
        <button type="button" className="kbtn" disabled={syncing} onClick={onSyncNow}>立即同步</button>
        <button type="button" className="kbtn danger" onClick={() => setStopping(true)}>{role === 'owner' ? '停止分享' : '退出这趟'}</button>
      </div>
      <Sheet open={stopping} onClose={() => setStopping(false)} title={role === 'owner' ? '停止分享这趟？' : '退出这趟共享？'}
        done={role === 'owner' ? '只在本机停止' : '退出'} doneTone={role === 'owner' ? 'plain' : 'primary'} onDone={() => { setStopping(false); onStop(false) }}
        footer={<div className="foot-row">
          {role === 'owner' && <button type="button" className="kbtn danger" onClick={() => { setStopping(false); onStop(true) }}>停止并删掉云端</button>}
          <button type="button" className="kbtn" onClick={() => setStopping(false)}>算了</button>
        </div>}>
        <p className="sheet-note">{role === 'owner'
          ? '只在本机停止：你这边不再同步，好友还能继续一起改。停止并删掉云端：好友那边下次同步会知道分享停了，各自留着现在的版本。两种都不动你这边的行程。'
          : '退出后这趟留在你这里，变成你自己的，不再和好友同步。'}</p>
      </Sheet>
    </div>
  )
}

export function JoinSheet({ open, initialCode, onJoin, onClose }: { open: boolean; initialCode?: string; onJoin: (code: string) => Promise<void>; onClose: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (open) { setCode(initialCode ?? ''); setErr(''); setBusy(false) } }, [open, initialCode])
  const norm = normalizeSyncCode(code)
  const go = async () => {
    if (!norm) return
    setBusy(true); setErr('')
    try { await onJoin(norm) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <Sheet open={open} onClose={onClose} title="加入同行好友的行程" done={busy ? '正在找…' : '加入'} doneDisabled={!norm || busy} onDone={go}>
      <Field label="好友发来的分享码" hint="不分大小写，连字符可以不填">
        <input className="kinput mono" value={code} onChange={e => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autoCapitalize="characters" autoComplete="off" spellCheck={false} />
      </Field>
      {err && <p className="issue-msg lv-error" role="alert">{err}</p>}
      <p className="sheet-note">加入后这趟会出现在「我的行程」里：你改的好友能看到，好友改的你也能看到。你自己的其他行程不会给出去。</p>
    </Sheet>
  )
}
