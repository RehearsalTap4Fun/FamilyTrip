// 各家 Key 去哪申请：设置里每个 Key 的说明、各处缺 Key 的提示，都从这里取链接，地址只写一份。
import { Fragment } from 'react'
import type { Provider } from '../llm/client'

export type KeySite = 'amap' | 'zhipu' | Provider

/** 链到各家直接创建 Key 的那一页（2026-10 核实） */
export const KEY_SITE: Record<KeySite, { name: string; url: string }> = {
  amap: { name: '高德开放平台', url: 'https://console.amap.com/dev/key/app' },
  anthropic: { name: 'Claude 控制台', url: 'https://platform.claude.com/settings/keys' },
  deepseek: { name: 'DeepSeek 开放平台', url: 'https://platform.deepseek.com/api_keys' },
  zhipu: { name: '智谱开放平台', url: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys' },
}

/** full：名字后面带上域名，链接打不开时照着地址也能找过去 */
export function KeyLink({ site, full }: { site: KeySite; full?: boolean }) {
  const s = KEY_SITE[site]
  return <a className="key-link" href={s.url} target="_blank" rel="noopener noreferrer">{s.name}{full ? `（${new URL(s.url).host}）` : ''}</a>
}

/** 缺 Key 的提示后面接一句：没有的话去哪申请 */
export function WhereToGet({ sites }: { sites: (KeySite | false)[] }) {
  const list = sites.filter((s): s is KeySite => !!s)
  if (!list.length) return null
  return <>没有的话去这里申请：{list.map((s, i) => <Fragment key={s}>{i ? '、' : ''}<KeyLink site={s} /></Fragment>)}。</>
}
