// 全局设置：目前只有高德 Key。放在 context 里，站点面板、行程页不用层层传参。
import { createContext, useContext } from 'react'

import type { LlmConfig } from '../llm/client'

export interface Settings { amapKey: string; llm: LlmConfig }
export const SettingsCtx = createContext<Settings>({ amapKey: '', llm: { provider: 'anthropic', apiKey: '' } })
export const useSettings = () => useContext(SettingsCtx)
