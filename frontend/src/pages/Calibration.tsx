import { useEffect, useState } from 'react'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import { useRawPosture } from '../hooks/usePostureTracking'

export default function Calibration() {
  const [step, setStep] = useState<'ready' | 'calibrating' | 'done' | 'failed'>('ready')
  const [duration, setDuration] = useState(150)
  const [elapsed, setElapsed] = useState(0)
  const [valid, setValid] = useState(0)
  const [quality, setQuality] = useState(0)
  const [reason, setReason] = useState<string | null>(null)
  const [demo, setDemo] = useState(false)
  const [running, setRunning] = useState(false)

  const { videoRef, isReady, cameraError } = useRawPosture((s) => {
    if (!running || step !== 'calibrating') return
    // feed to backend calibration session
    void api('/monitor/feed', { method: 'POST', body: s, auth: true }).catch(() => {})
    // count valid samples locally
    setValid((v) => v + 1)
  })

  useEffect(() => {
    let id: number | null = null
    if (running && step === 'calibrating') {
      id = window.setInterval(() => {
        setElapsed((e) => e + 1)
      }, 1000)
    }
    return () => { if (id) window.clearInterval(id) }
  }, [running, step])

  useEffect(() => {
    if (running && elapsed >= duration) {
      finish()
    }
  }, [elapsed, running, duration])

  async function start() {
    setReason(null)
    const res = await api<{ ok: boolean; duration_s: number }>('/calibration/start', {
      method: 'POST',
      body: { demo },
      auth: true,
    })
    setDuration(res.duration_s)
    setElapsed(0)
    setValid(0)
    setQuality(0)
    setStep('calibrating')
    setRunning(true)
  }

  async function finish() {
    setRunning(false)
    const st = await api<any>('/calibration/status', { auth: true })
    setQuality(st.quality || 0)
    setValid(st.valid_samples || valid)
    setReason(st.reason || null)
    if (st.baseline_ok) setStep('done')
    else setStep('failed')
  }

  async function cancel() {
    await api('/calibration/cancel', { method: 'POST', auth: true }).catch(() => {})
    setRunning(false)
    setStep('ready')
    setElapsed(0)
    setValid(0)
  }

  async function redo() {
    setStep('ready')
    setElapsed(0)
    setValid(0)
    setReason(null)
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
              <label htmlFor="demo" className="text-sm text-slate-600 dark:text-slate-300">Quick demo (shorter)</label>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Sit normally, keep your face and shoulders visible. We’ll collect samples until the timer finishes.
            </p>
            <button
              onClick={start}
              disabled={!isReady && !cameraError}
              className="rounded-lg bg-teal-600 px-4 py-2 text-white hover:bg-teal-700 disabled:opacity-50"
            >
              Start Calibration
            </button>
            {cameraError && <p className="text-sm text-red-600">Camera error: {cameraError.message}</p>}
          </div>
        )}

        {step === 'calibrating' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-300">Time left: {Math.max(0, duration - elapsed)}s</p>
                <p className="text-sm text-slate-600 dark:text-slate-300">Valid samples: {valid}</p>
              </div>
              <button onClick={cancel} className="rounded-lg border px-3 py-1 text-sm">Cancel</button>
            </div>
            <div className="h-2 w-full rounded bg-slate-200 dark:bg-slate-700">
              <div className="h-2 rounded bg-teal-600" style={{ width: `${progress}%` }} />
            </div>
            <video ref={videoRef} className="transform scale-x-[-1] rounded" width={320} height={240} playsInline autoPlay muted />
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Calibration complete</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">Valid samples: {valid}</p>
            <p className="text-sm text-slate-600 dark:text-slate-300">Quality: {(quality * 100).toFixed(0)}%</p>
            <button onClick={redo} className="rounded-lg bg-teal-600 px-4 py-2 text-white hover:bg-teal-700">Recalibrate</button>
          </div>
        )}

        {step === 'failed' && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Calibration failed</h2>
            {reason && <p className="text-sm text-red-600 dark:text-red-400">{reason}</p>}
            <button onClick={redo} className="rounded-lg bg-teal-600 px-4 py-2 text-white hover:bg-teal-700">Try again</button>
          </div>
        )}
      </div>
    </>
  )
}
