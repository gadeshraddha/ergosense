import { useCallback, useEffect, useRef, useState } from 'react'
import { api, getToken } from '../api/client'
import type { LiveSnapshot } from '../api/types'

function liveUrl(token: string): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${window.location.host}/ws/live?token=${encodeURIComponent(token)}`
}

/**
 * Opens the live WebSocket and returns the newest snapshot plus connection state.
 * Auto-reconnects with a small backoff; closes cleanly on unmount.
 */
export function useLive() {
  const [data, setData] = useState<LiveSnapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<WebSocket | null>(null)

  /** Pull one snapshot over HTTP (used right after a control change). */
  const refresh = useCallback(async () => {
    try {
      setData(await api<LiveSnapshot>('/monitor/live'))
    } catch {
      /* the socket will catch up on its own */
    }
  }, [])

  useEffect(() => {
    let closed = false
    let retry: number | undefined
    let attempts = 0

    const connect = () => {
      const token = getToken()
      if (!token || closed) return

      const ws = new WebSocket(liveUrl(token))
      socketRef.current = ws

      ws.onopen = () => {
        attempts = 0
        setConnected(true)
      }
      ws.onmessage = (event) => {
        try {
          setData(JSON.parse(event.data) as LiveSnapshot)
        } catch {
          /* ignore malformed frame */
        }
      }
      ws.onclose = () => {
        setConnected(false)
        if (closed) return
        attempts += 1
        const delay = Math.min(5000, 500 * attempts)
        retry = window.setTimeout(connect, delay)
      }
      ws.onerror = () => {
        try {
          ws.close()
        } catch {
          /* ignore */
        }
      }
    }

    connect()
    return () => {
      closed = true
      if (retry) window.clearTimeout(retry)
      const ws = socketRef.current
      if (ws) {
        ws.onclose = null
        try {
          ws.close()
        } catch {
          /* ignore */
        }
      }
    }
  }, [])

  return { data, connected, refresh }
}
