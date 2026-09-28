// 撤销代替确认：删了就删，底部给 5 秒反悔。
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

interface ToastMsg { id: number; text: string; undo?: () => void }
const Ctx = createContext<(text: string, undo?: () => void) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<ToastMsg | null>(null)
  const timer = useRef(0)
  const show = useCallback((text: string, undo?: () => void) => {
    clearTimeout(timer.current)
    const id = Date.now()
    setMsg({ id, text, undo })
    timer.current = window.setTimeout(() => setMsg(m => (m?.id === id ? null : m)), 5000)
  }, [])
  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="toast-slot" aria-live="polite">
        {msg && (
          <div key={msg.id} className="toast">
            <span>{msg.text}</span>
            {msg.undo && <button type="button" onClick={() => { msg.undo!(); setMsg(null) }}>撤销</button>}
          </div>
        )}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)
