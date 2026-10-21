import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { useLive } from '../hooks/useLive'
import { usePostureCamera } from '../hooks/usePostureTracking'
import type { CameraErrorKind, RawPostureSample } from '../hooks/usePostureTracking'
import type { LiveSnapshot } from '../api/types'

/** How often browser camera frames are forwarded to the engine (ms). */
const FEED_INTERVAL_MS = 400

interface MonitoringValue {
  /** Newest live snapshot from the WebSocket (null until the first frame). */
  data: LiveSnapshot | null
  connected: boolean
  busy: boolean
  start: () => Promise<void>
  stop: () => Promise<void>
  /** Fetch a fresh snapshot right now (HTTP), for after a control change. */
  refresh: () => Promise<void>
  /** In real mode, the shared webcam stream (posture + ambient light source). */
  cameraStream: MediaStream | null
  cameraReady: boolean
  cameraError: Error | null
  /** Which half failed: the webcam itself, or the pose model download. */
  cameraErrorKind: CameraErrorKind | null
  /** Try the camera again after a failure. */
  retryCamera: () => void
  /** The newest raw posture features from the camera. */
  cameraSample: RawPostureSample | null
  /** Ask the shared camera to run (e.g. on the Calibration page). */
  requestCamera: (on: boolean) => void
}

const MonitoringContext = createContext<MonitoringValue | null>(null)

/** Owns the single live WebSocket for the whole app shell. */
export function MonitoringProvider({ children }: { children: ReactNode }) {
  const { data, connected, refresh } = useLive()
  const [busy, setBusy] = useState(false)
  const [cameraRequested, setCameraRequested] = useState(false)

  // The webcam is the posture *and* ambient-light source, so it runs app-wide
  // whenever real mode is monitoring (one shared stream, no per-page cameras).
  const realMode = data?.mode === 'real' && data?.monitoring === true
  const cameraOn = realMode || cameraRequested
  const camera = usePostureCamera(cameraOn)

  const lastSentRef = useRef(0)

  useEffect(() => {
    if (!realMode) return
    const sample = camera.latest
    if (!sample) return
    const now = Date.now()
    if (now - lastSentRef.current < FEED_INTERVAL_MS) return
    lastSentRef.current = now
    void api('/monitor/feed', {
      method: 'POST',
      body: { ...sample, lux: camera.lux },
    }).catch(() => undefined)
  }, [camera.latest, camera.lux, realMode])

  const requestCamera = useCallback((on: boolean) => setCameraRequested(on), [])

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
    <MonitoringContext.Provider
      value={{
        data,
        connected,
        busy,
        start,
        stop,
        refresh,
        cameraStream: camera.stream,
        cameraReady: camera.ready,
        cameraError: camera.error,
        cameraErrorKind: camera.errorKind,
        retryCamera: camera.retry,
        cameraSample: camera.latest,
        requestCamera,
      }}
    >
      {children}
    </MonitoringContext.Provider>
  )
}

export function useMonitoring(): MonitoringValue {
  const value = useContext(MonitoringContext)
  if (!value) throw new Error('useMonitoring must be used within a MonitoringProvider')
  return value
}
