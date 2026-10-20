import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { useLive } from '../hooks/useLive'
import type { LiveSnapshot } from '../api/types'

interface MonitoringValue {
  /** Newest live snapshot from the WebSocket (null until the first frame). */
  data: LiveSnapshot | null
  connected: boolean
  busy: boolean
  start: () => Promise<void>
  stop: () => Promise<void>
  /** Fetch a fresh snapshot right now (HTTP), for after a control change. */
  refresh: () => Promise<void>
}

const MonitoringContext = createContext<MonitoringValue | null>(null)

/** Owns the single live WebSocket for the whole app shell. */
export function MonitoringProvider({ children }: { children: ReactNode }) {
  const { data, connected, refresh } = useLive()
  const [busy, setBusy] = useState(false)

  const start = useCallback(async () => {
    setBusy(true)
    try {
      await api('/monitor/start', { method: 'POST' })
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const stop = useCallback(async () => {
    setBusy(true)
    try {
      await api('/monitor/stop', { method: 'POST' })
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [refresh])

  return (
    <MonitoringContext.Provider value={{ data, connected, busy, start, stop, refresh }}>
      {children}
    </MonitoringContext.Provider>
  )
}

export function useMonitoring(): MonitoringValue {
  const value = useContext(MonitoringContext)
  if (!value) throw new Error('useMonitoring must be used within a MonitoringProvider')
  return value
}
