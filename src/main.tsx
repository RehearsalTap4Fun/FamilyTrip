import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// 数字字体很小，两个版本都内嵌；中文字体见 fonts.ts
import '@fontsource/barlow-semi-condensed/latin-600.css'
import '@fontsource/barlow-semi-condensed/latin-700.css'
import '@fontsource/barlow/latin-300.css'
import '@fontsource/barlow/latin-500.css'
import './styles.css'
import './scope.css'
import './themes.css'
import './kit.css'

if (import.meta.env.MODE !== 'single') import('./fonts')

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
