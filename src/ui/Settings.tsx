// 全局设置：各种 Key 与大模型选择。放在 context 里，站点面板、行程页不用层层传参。
import { createContext, useContext } from 'react'

import type { LlmConfig } from '../llm/client'

export interface Settings {
  amapKey: string
  llm: LlmConfig
  /** 智谱 API Key：联网搜索攻略用 */
  zhipuKey: string
}
export const SettingsCtx = createContext<Settings>({ amapKey: '', llm: { provider: 'anthropic', apiKey: '' }, zhipuKey: '' })
export const useSettings = () => useContext(SettingsCtx)
