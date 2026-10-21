import { useCallback, useEffect, useState } from 'react'
import { api, getToken } from '../api/client'
import type { LiveSnapshot } from '../api/types'

function liveUrl(token: string): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${window.location.host}/ws/live?token=${encodeURIComponent(token)}`
}

/**
 * The live socket lives *outside* React, on purpose.
 *
 * React (especially StrictMode in development) mounts components twice and can
 * unmount/remount them at any time. A socket that is created and closed again
 * straight away is aborted while it is still handshaking, which the browser
 * reports as "WebSocket is closed before the connection is established" and the
 * Vite dev proxy reports as a noisy socket error.
 *
 * One socket per page, shared by every consumer, reconnects by itself and is
 * closed when the last consumer goes away.
 */
interface Listener {
  onData: (snapshot: LiveSnapshot) => void
  onStatus: (connected: boolean) => void
}

const listeners = new Set<Listener>()
let socket: WebSocket | null = null
let socketToken: string | null = null
let retryTimer: number | undefined
let closeTimer: number | undefined
let attempts = 0
let refCount = 0
let lastSnapshot: LiveSnapshot | null = null

function notifyData(snapshot: LiveSnapshot): void {
  lastSnapshot = snapshot
  listeners.forEach((l) => l.onData(snapshot))
}

function notifyStatus(connected: boolean): void {
  listeners.forEach((l) => l.onStatus(connected))
}

function openSocket(token: string): void {
  let ws: WebSocket
  try {
    ws = new WebSocket(liveUrl(token))
  } catch {
    scheduleReconnect()
    return
  }
  socket = ws
  socketToken = token

  ws.onopen = () => {
    attempts = 0
    notifyStatus(true)
  }
  ws.onmessage = (event) => {
    try {
      notifyData(JSON.parse(event.data) as LiveSnapshot)
    } catch {
      /* ignore malformed frame */
    }
  }
  ws.onclose = () => {
    if (socket === ws) {
      socket = null
      socketToken = null
    }
    notifyStatus(false)
    scheduleReconnect()
  }
  ws.onerror = () => {
    try {
      ws.close()
    } catch {
      /* ignore */
    }
  }
}

/** Make sure a socket for the current token exists. */
function ensureSocket(): void {
  const token = getToken()
  if (!token) return

  if (socket) {
    if (socketToken === token) {
      // Still good: connecting or connected.
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) return
      // Dead socket - replace it.
      socket = null
      socketToken = null
    } else {
      // The user signed in as somebody else - start over.
      closeSocket()
    }
  }
  openSocket(token)
}

function closeSocket(): void {
  if (retryTimer) {
    window.clearTimeout(retryTimer)
    retryTimer = undefined
  }
  const ws = socket
  socket = null
  socketToken = null
  if (!ws) return
  ws.onopen = null
  ws.onmessage = null
  ws.onclose = null
  ws.onerror = null
  try {
    ws.close()
  } catch {
    /* ignore */
  }
}

function scheduleReconnect(): void {
  if (retryTimer) return
  attempts += 1
  const delay = Math.min(5000, 500 * attempts)
  retryTimer = window.setTimeout(() => {
    retryTimer = undefined
    ensureSocket()
  }, delay)
}

/** A consumer wants the live data. */
function retain(): void {
  refCount += 1
  if (closeTimer) {
    window.clearTimeout(closeTimer)
    closeTimer = undefined
  }
  ensureSocket()
}

/** A consumer is gone. The socket is closed a moment later, in case React
 *  is only remounting the tree. */
function release(): void {
  refCount -= 1
  if (refCount > 0) return
  if (closeTimer) window.clearTimeout(closeTimer)
  closeTimer = window.setTimeout(() => {
    closeTimer = undefined
    if (refCount === 0) {
      attempts = 0
      closeSocket()
    }
  }, 1000)
}

/**
 * Opens the live WebSocket and returns the newest snapshot plus connection state.
 * Auto-reconnects with a small backoff; closes cleanly on unmount.
 */
export function useLive() {
  const [data, setData] = useState<LiveSnapshot | null>(lastSnapshot)
  const [connected, setConnected] = useState<boolean>(() => socket?.readyState === WebSocket.OPEN)

  /** Pull one snapshot over HTTP (used right after a control change). */
  const refresh = useCallback(async () => {
    try {
      const snapshot = await api<LiveSnapshot>('/monitor/live')
      notifyData(snapshot)
    } catch {
      /* the socket will catch up on its own */
    }
  }, [])

  useEffect(() => {
    const listener: Listener = {
      onData: (snapshot) => setData(snapshot),
      onStatus: (isConnected) => setConnected(isConnected),
    }
    listeners.add(listener)
    retain()
    return () => {
      listeners.delete(listener)
      release()
    }
  }, [])

  return { data, connected, refresh }
}
