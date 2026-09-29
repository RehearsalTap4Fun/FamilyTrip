// 设置（「同行」页右上角齿轮）：风格、各家 Key、恢复示例、存档与同步。都是全局的，和哪一趟无关。
import { useState, type ReactNode } from 'react'
import { testAmapKey } from '../geo/amap'
import { PROVIDER_LABEL, type Provider } from '../llm/client'
import { THEME_LABEL, type Theme } from '../store/state'
import { Chips, Field, Segmented } from './kit/controls'
import { Sheet } from './kit/Sheet'

interface Props {
  open: boolean
  onClose: () => void
  theme: Theme
  onTheme: (t: Theme) => void
  amapKey: string
  onAmapKey: (k: string) => void
  llmProvider: Provider
  llmKeys: { anthropic?: string; deepseek?: string }
  onLlm: (p: Provider, keys: { anthropic?: string; deepseek?: string }) => void
  zhipuKey: string
  onZhipuKey: (k: string) => void
  onReset: () => void
  /** 存档与同步 */
  storage: ReactNode
}

export function SettingsSheet({ open, onClose, theme, onTheme, amapKey, onAmapKey, llmProvider, llmKeys, onLlm, zhipuKey, onZhipuKey, onReset, storage }: Props) {
  const [amapTest, setAmapTest] = useState<null | 'busy' | 'ok' | string>(null)
  const [resetting, setResetting] = useState(false)
  return (
    <>
      <Sheet open={open} onClose={onClose} title="设置">
        <div className="settings">
          <Field label="风格">
            <Chips label="视觉风格" values={[theme]} onChange={v => { const t = v.find(x => x !== theme); if (t) onTheme(t as Theme) }}
              options={(Object.keys(THEME_LABEL) as Theme[]).map(t => ({ value: t, label: THEME_LABEL[t] }))} />
          </Field>
          <Field label="高德 Key" hint="「Web服务」类型；只存在这台设备上">
            <div className="key-row">
              <input className="kinput" type="password" autoComplete="off" spellCheck={false} value={amapKey} placeholder="用来搜地方、算车程" onChange={e => { onAmapKey(e.target.value.replace(/\s/g, '')); setAmapTest(null) }} />
              <button type="button" className="kbtn" disabled={!amapKey || amapTest === 'busy'} onClick={async () => { setAmapTest('busy'); const r = await testAmapKey(amapKey); setAmapTest(r.ok ? 'ok' : r.msg) }}>{amapTest === 'busy' ? '测…' : '测一下'}</button>
            </div>
            {amapTest && amapTest !== 'busy' && <p className={'key-test ' + (amapTest === 'ok' ? 'ok' : 'bad')}>{amapTest === 'ok' ? '好用：能搜地方、算车程' : amapTest}</p>}
          </Field>
          <p className="sheet-note">到高德开放平台（lbs.amap.com）控制台创建应用，添加 Key 时服务平台选「Web服务」。个人开发者每天有免费额度。</p>
          <Field label="AI 排行程用" hint="推荐方案、读攻略、写亮点都会用到">
            <Segmented label="大模型" value={llmProvider} onChange={p => onLlm(p, llmKeys)} options={(['anthropic', 'deepseek'] as Provider[]).map(p => ({ value: p, label: PROVIDER_LABEL[p] }))} />
          </Field>
          <Field label={`${PROVIDER_LABEL[llmProvider]} API Key`} hint="只存在这台设备上">
            <input className="kinput" type="password" autoComplete="off" spellCheck={false} value={llmKeys[llmProvider] ?? ''} placeholder={llmProvider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
              onChange={e => onLlm(llmProvider, { ...llmKeys, [llmProvider]: e.target.value.trim() })} />
          </Field>
          <Field label="智谱 API Key" hint="联网搜索攻略用；只存在这台设备上">
            <input className="kinput" type="password" autoComplete="off" spellCheck={false} value={zhipuKey} placeholder="选填" onChange={e => onZhipuKey(e.target.value.trim())} />
          </Field>
          <p className="sheet-note">到智谱开放平台（bigmodel.cn）控制台的「API Keys」里创建，要复制完整（中间有个点）。填了以后，AI 推荐方案会先到网上搜一轮攻略，方案附原帖链接；每次搜索约 ¥0.2。不填就凭 AI 自己的知识推荐。</p>
          <button type="button" className="kbtn danger wide" onClick={() => setResetting(true)}>恢复示例行程</button>
        </div>
        {storage}
      </Sheet>
      <Sheet open={resetting} onClose={() => setResetting(false)} title="恢复示例行程？" done="恢复" onDone={() => { setResetting(false); onReset() }}
        footer={<button type="button" className="kbtn wide" onClick={() => setResetting(false)}>算了</button>}>
        <p className="sheet-note">示例行程会换回最初的样子，你自己建的行程、家庭成员和红黑榜不受影响。</p>
      </Sheet>
    </>
  )
}
