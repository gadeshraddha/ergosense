import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import PageHeader from '../components/PageHeader'
import { useRawPosture } from '../hooks/usePostureTracking'

interface CalStatus {
  running: boolean
  elapsed_s: number
  duration_s: number
  progress_pct: number
  valid_samples: number
  quality: number
  reason: string | null
  completed: boolean
  baseline_ok: boolean
  message?: string | null
  features?: string[]
}

/** Send at most ~7 samples/second — plenty for a baseline, easy on the network. */
const SAMPLE_INTERVAL_MS = 150

export default function Calibration() {
  const [step, setStep] = useState<'ready' | 'calibrating' | 'done' | 'failed'>('ready')
  const [duration, setDuration] = useState(150)
  const [elapsed, setElapsed] = useState(0)
  const [valid, setValid] = useState(0)
  const [quality, setQuality] = useState(0)
  const [reason, setReason] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [demo, setDemo] = useState(false)
  const [running, setRunning] = useState(false)
  const lastSentRef = useRef(0)
  const finishingRef = useRef(false)

  const { videoRef, isReady, cameraError } = useRawPosture((s) => {
    if (!running || step !== 'calibrating') return
    const now = Date.now()
    if (now - lastSentRef.current < SAMPLE_INTERVAL_MS) return
    lastSentRef.current = now

    api<{ ok: boolean; valid_samples: number }>('/calibration/sample', {
      method: 'POST',
      body: s,
    })
      .then((r) => {
        setValid(r.valid_samples)
        setError(null)
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Could not save a sample')
      })
  })

  useEffect(() => {
    let id: number | null = null
    if (running && step === 'calibrating') {
      id = window.setInterval(() => setElapsed((e) => e + 1), 1000)
    }
    return () => {
      if (id) window.clearInterval(id)
    }
  }, [running, step])

  useEffect(() => {
    if (running && elapsed >= duration && !finishingRef.current) {
      void finish()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, running, duration])

  async function startSession() {
    return api<{ ok: boolean; duration_s: number }>('/calibration/start', {
      method: 'POST',
      body: { demo },
    })
  }

  async function start() {
    setError(null)
    setReason(null)
    try {
      let res
      try {
        res = await startSession()
      } catch (e) {
        // A previous run may still be open on the server (e.g. you closed the tab).
        if (e instanceof ApiError && e.status === 409) {
          await api('/calibration/cancel', { method: 'POST' }).catch(() => {})
          res = await startSession()
        } else {
          throw e
        }
      }
      setDuration(res.duration_s)
      setElapsed(0)
      setValid(0)
      setQuality(0)
      lastSentRef.current = 0
      finishingRef.current = false
      setStep('calibrating')
      setRunning(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start calibration')
    }
  }

  async function finish() {
    finishingRef.current = true
    setRunning(false)
    // The backend owns the clock, so ask it until it is really done.
    const deadline = Date.now() + 8000
    try {
      while (Date.now() < deadline) {
        const st = await api<CalStatus>('/calibration/status')
        if (!st.running) {
          setQuality(st.quality || 0)
          setValid(st.valid_samples || 0)
          setReason(st.reason || null)
          setError(null)
          setStep(st.baseline_ok ? 'done' : 'failed')
          return
        }
        await new Promise((r) => setTimeout(r, 400))
      }
      setStep('failed')
      setReason('The server took too long to finish. Please try again.')
    } catch (e) {
      setStep('failed')
      setReason(e instanceof Error ? e.message : 'Could not finish calibration')
    } finally {
      finishingRef.current = false
    }
  }

  async function cancel() {
    await api('/calibration/cancel', { method: 'POST' }).catch(() => {})
    setRunning(false)
    setStep('ready')
    setElapsed(0)
    setValid(0)
    setError(null)
    setReason(null)
  }

  function redo() {
    setStep('ready')
    setElapsed(0)
    setValid(0)
    setReason(null)
    setError(null)
  }

  const progress = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0

  return (
    <>
      <PageHeader title="Calibration" description="Teach ErgoSense what your normal posture looks like." />
      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
        {step === 'ready' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <input id="demo" type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
              <label htmlFor="demo" className="text-sm text-slate-600 dark:text-slate-300">
                Quick demo (20s instead of 2.5 min)
              </label>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Sit normally, keep your face and shoulders visible. Samples are collected until the timer
              finishes.
            </p>
            <button
              onClick={start}
              disabled={!isReady && !cameraError}
              className="rounded-lg bg-teal-600 px-4 py-2 text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {isReady ? 'Start Calibration' : 'Waiting for camera...'}
            </button>
            {cameraError && (
              <p className="text-sm text-red-600">Camera error: {cameraError.message}</p>
            )}
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          </div>
        )}

        {step === 'calibrating' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Time left: {Math.max(0, duration - elapsed)}s
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-300">Samples: {valid}</p>
              </div>
              <button onClick={cancel} className="rounded-lg border px-3 py-1 text-sm">
                Cancel
              </button>
            </div>
            <div className="h-2 w-full rounded bg-slate-200 dark:bg-slate-700">
              <div className="h-2 rounded bg-teal-600 transition-all" style={{ width: `${progress}%` }} />
            </div>
            {valid === 0 && (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                No samples yet — make sure your face and both shoulders are in the frame.
              </p>
            )}
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Calibration complete</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">Valid samples: {valid}</p>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Quality: {(quality * 100).toFixed(0)}%
            </p>
            <button
              onClick={redo}
              className="rounded-lg bg-teal-600 px-4 py-2 text-white hover:bg-teal-700"
            >
              Recalibrate
            </button>
          </div>
        )}

        {step === 'failed' && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Calibration failed</h2>
            {reason && (
              <p className="text-sm text-red-600 dark:text-red-400">{reason}</p>
            )}
            <button
              onClick={redo}
              className="rounded-lg bg-teal-600 px-4 py-2 text-white hover:bg-teal-700"
            >
              Try again
            </button>
          </div>
        )}
      </div>

      {/*
        The camera hook attaches the MediaStream once, when this page mounts.
        The <video> must therefore exist from the very first render, so it stays in
        the DOM and is only hidden outside the sampling step.
      */}
      <div className={step === 'calibrating' ? 'mt-4' : 'hidden'}>
        <video
          ref={videoRef}
          width={320}
          height={240}
          className="mx-auto transform scale-x-[-1] rounded-lg"
          playsInline
          autoPlay
          muted
        />
      </div>
    </>
  )
}
