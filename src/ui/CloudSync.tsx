// 「存档与同步」：云同步（同步码，端到端加密，与饮食日记同一套）+ 存档文件导出 / 导入。放在设置面板里（「同行」页右上角齿轮）。
import { useRef, useState } from 'react'
import { generateSyncCode, normalizeSyncCode } from '../sync/crypto'
import type { SyncLocal } from '../store/syncStore'
import { Field } from './kit/controls'
import { Sheet } from './kit/Sheet'

export interface CloudProps {
  sync: SyncLocal
  syncing: boolean
  onEnable: (code: string, mode: 'new' | 'join') => void
  onDisable: (removeRemote: boolean) => void
  onSyncNow: () => void
  onExport: () => void
  onImport: (text: string) => void
}

const fmtTime = (t?: number) => {
  if (!t) return '还没同步过'
  const d = new Date(t)
  const same = d.toDateString() === new Date().toDateString()
  return (same ? '今天 ' : `${d.getMonth() + 1}/${d.getDate()} `) + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function StorageSection(p: CloudProps) {
  return (
    <>
      <div className="section-h"><h2>存档与同步</h2></div>
      <CloudSyncCard {...p} />
      <BackupCard onExport={p.onExport} onImport={p.onImport} syncOn={p.sync.enabled} />
    </>
  )
}

function CloudSyncCard({ sync, syncing, onEnable, onDisable, onSyncNow }: CloudProps) {
  const [mode, setMode] = useState<'idle' | 'new' | 'join'>('idle')
  const [fresh, setFresh] = useState('')
  const [typed, setTyped] = useState('')
  const [show, setShow] = useState(false)
  const [closing, setClosing] = useState(false)
  const [copied, setCopied] = useState(false)
  const copy = async (c: string) => { try { await navigator.clipboard.writeText(c); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* 复制不了就让人手抄 */ } }
  const norm = normalizeSyncCode(typed)

  if (!sync.enabled || !sync.code) {
    return (
      <div className="cloud card-pad">
        <div className="cloud-hd"><b>云同步</b><span className="pill">未开</span></div>
        {mode === 'idle' && (
          <>
            <ul className="cloud-points">
              <li>手机、电脑都能看到同一份行程和红黑榜，在一台上改，别的设备自动跟上</li>
              <li>用一串同步码加密后才上传，服务器上只有密文；同步码丢了，云端的数据就找不回来</li>
              <li>按每一站、每个人分开合并：两台设备各改各的，都能保留</li>
              <li>高德和大模型的 Key、示例行程不同步</li>
            </ul>
            <button type="button" className="kbtn primary wide" onClick={() => { setFresh(generateSyncCode()); setMode('new') }}>生成同步码并开启</button>
            <button type="button" className="kbtn wide" onClick={() => { setTyped(''); setMode('join') }}>我有同步码，接入</button>
          </>
        )}
        {mode === 'new' && (
          <>
            {/* 24 位分两行、每行三组，抄的时候不容易串行 */}
            <p className="cloud-code mono" aria-label={fresh}>{fresh.slice(0, 14)}<br />{fresh.slice(15)}</p>
            <p className="sheet-note">这就是你的同步码。抄到备忘录或拍下来：在别的设备上输入它就能接入；丢了就没法找回云端数据。</p>
            <div className="foot-row">
              <button type="button" className="kbtn" onClick={() => setMode('idle')}>取消</button>
              <button type="button" className="kbtn" onClick={() => copy(fresh)}>{copied ? '已复制' : '复制'}</button>
            </div>
            <button type="button" className="kbtn primary wide" onClick={() => { onEnable(fresh, 'new'); setMode('idle') }}>记下了，开启同步</button>
          </>
        )}
        {mode === 'join' && (
          <>
            <Field label="已有的同步码" hint="不分大小写，连字符可以不填">
              <input className="kinput mono" value={typed} onChange={e => setTyped(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autoCapitalize="characters" autoComplete="off" spellCheck={false} />
            </Field>
            <p className="sheet-note">接入后，云端的行程会和这台设备上的合在一起，两边都不丢。</p>
            <div className="foot-row">
              <button type="button" className="kbtn" onClick={() => setMode('idle')}>取消</button>
              <button type="button" className="kbtn primary" disabled={!norm} onClick={() => { if (norm) { onEnable(norm, 'join'); setMode('idle') } }}>接入</button>
            </div>
          </>
        )}
      </div>
    )
  }

  const masked = sync.code.replace(/[A-Z0-9]/g, '•')
  return (
    <div className="cloud card-pad">
      <div className="cloud-hd"><b>云同步</b><span className={'pill ' + (syncing ? 'busy' : sync.lastError ? 'bad' : 'on')}>{syncing ? '同步中…' : sync.lastError ? '上次失败' : '已开'}</span></div>
      <div className="cloud-coderow">
        <span className="mono">{show ? sync.code : masked}</span>
        <button type="button" className="linkish" onClick={() => setShow(!show)}>{show ? '隐藏' : '显示'}</button>
        <button type="button" className="linkish" onClick={() => copy(sync.code!)}>{copied ? '已复制' : '复制'}</button>
      </div>
      <p className="sheet-note">上次同步 {fmtTime(sync.lastSyncAt)}{sync.version ? ` · 云端第 ${sync.version} 版` : ''}{sync.lastError ? ` · ${sync.lastError}` : ''}</p>
      <details className="more">
        <summary>别的设备怎么接入</summary>
        <p className="sheet-note">在另一台设备上打开同路 →「同行」页右上角的设置 →「输入已有同步码」，填上面这串码。改动会在几秒内同步过去，回到应用时也会再同步一次。</p>
      </details>
      <div className="foot-row">
        <button type="button" className="kbtn" disabled={syncing} onClick={onSyncNow}>立即同步</button>
        <button type="button" className="kbtn danger" onClick={() => setClosing(true)}>关闭同步</button>
      </div>
      <Sheet open={closing} onClose={() => setClosing(false)} title="关闭云同步？" done="只在本机关闭" doneTone="plain" onDone={() => { setClosing(false); onDisable(false) }}
        footer={<div className="foot-row">
          <button type="button" className="kbtn danger" onClick={() => { setClosing(false); onDisable(true) }}>关闭并删除云端</button>
          <button type="button" className="kbtn" onClick={() => setClosing(false)}>算了</button>
        </div>}>
        <p className="sheet-note">只在本机关闭：这台设备不再同步，云端和别的设备照旧。关闭并删除云端：云端副本删掉，别的设备下次同步会失败。两种都不动这台设备上的数据。</p>
      </Sheet>
    </div>
  )
}

function BackupCard({ onExport, onImport, syncOn }: Pick<CloudProps, 'onExport' | 'onImport'> & { syncOn: boolean }) {
  const file = useRef<HTMLInputElement>(null)
  const [paste, setPaste] = useState(false)
  const [text, setText] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const read = (f: File) => { const r = new FileReader(); r.onload = () => setPending(String(r.result ?? '')); r.readAsText(f) }
  return (
    <div className="cloud card-pad">
      <div className="cloud-hd"><b>存档</b></div>
      <p className="sheet-note">把所有行程、同行、红黑榜存成一个文件，换设备或想留个底时用。Key 不会存进去。</p>
      <div className="foot-row">
        <button type="button" className="kbtn" onClick={onExport}>导出存档文件</button>
        <button type="button" className="kbtn" onClick={() => file.current?.click()}>导入存档</button>
      </div>
      <input ref={file} type="file" accept=".json,application/json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = '' }} />
      <button type="button" className="linkish" onClick={() => setPaste(!paste)}>{paste ? '收起' : '选不了文件？粘贴存档内容'}</button>
      {paste && (
        <>
          <textarea className="kinput mono" rows={4} value={text} onChange={e => setText(e.target.value)} placeholder="把存档文件里的内容整段粘贴进来" />
          <button type="button" className="kbtn wide" disabled={!text.trim()} onClick={() => setPending(text)}>导入粘贴的存档</button>
        </>
      )}
      <Sheet open={pending != null} onClose={() => setPending(null)} title={syncOn ? '把这份存档并进来？' : '用这份存档替换？'} done={syncOn ? '并进来' : '替换'} onDone={() => { const t = pending; setPending(null); if (t) onImport(t) }}
        footer={<button type="button" className="kbtn wide" onClick={() => setPending(null)}>算了</button>}>
        <p className="sheet-note">{syncOn
          ? '开着云同步，所以不整份替换（那样存档里没有的行程会在所有设备上被删掉）：存档里的行程覆盖同一趟、没有的加进来，其余保留，然后同步到云端。可以撤销。'
          : '这台设备上现在的行程、红黑榜会换成存档里的（Key 保留）。可以撤销。'}</p>
      </Sheet>
    </div>
  )
}
