import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Health } from '../api/types'

export type HealthState =
  | { status: 'checking' }
  | { status: 'online'; mock: boolean; app: string }
  | { status: 'offline' }

/** Asks the backend "are you alive?" now and then. Real data, shown in the top bar. */
export function useHealth(intervalMs = 15000): HealthState {
  const [state, setState] = useState<HealthState>({ status: 'checking' })

  useEffect(() => {
    let cancelled = false
    const check = () => {
      api<Health>('/health', { auth: false })
        .then((h) => {
          if (!cancelled) setState({ status: 'online', mock: h.mock, app: h.app })
        })
        .catch(() => {
          if (!cancelled) setState({ status: 'offline' })
        })
    }
    check()
    const id = window.setInterval(check, intervalMs)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [intervalMs])

  return state
}
