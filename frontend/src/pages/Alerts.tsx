import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api/client'
import type { AlertEvent, AppSettings } from '../api/types'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../auth/useAuth'
import { useMonitoring } from '../monitoring/MonitoringProvider'

const SEVERITY_TONE: Record<string, string> = {
  info: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  danger: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-3 text-sm font-semibold text-slate-500 dark:text-slate-400">{title}</h2>
      {children}
    </div>
  )
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-4 py-2 text-sm">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
          checked ? 'bg-teal-600' : 'bg-slate-300 dark:bg-slate-700'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    </label>
  )
}

export default function Alerts() {
  const { user } = useAuth()
  const { data: live, refresh: refreshLive } = useMonitoring()
  const [alerts, setAlerts] = useState<AlertEvent[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [muted, setMuted] = useState(false)
  const [mockLux, setMockLux] = useState(420)

  const load = useCallback(async () => {
    try {
      const [rows, s] = await Promise.all([
        api<AlertEvent[]>('/alerts'),
        api<AppSettings>('/settings'),
      ])
      setAlerts(rows)
      setSettings(s)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load alerts')
    }
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 8000)
    return () => window.clearInterval(id)
  }, [load])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 2500)
    return () => window.clearTimeout(id)
  }, [toast])

  const types = useMemo(() => ['all', ...Array.from(new Set(alerts.map((a) => a.type)))], [alerts])
  const visible = filter === 'all' ? alerts : alerts.filter((a) => a.type === filter)

  const testVoice = async () => {
    setBusy(true)
    try {
      const res = await api<{ spoken: boolean; supported: boolean }>('/alerts/test-voice', { method: 'POST' })
      setToast(res.spoken ? 'Voice prompt played.' : res.supported ? 'Voice is muted right now.' : 'Voice is not available on this machine.')
    } finally {
      setBusy(false)
    }
  }

  const mute = async (minutes: number) => {
    setBusy(true)
    try {
      await api('/alerts/mute', { method: 'POST', body: { minutes } })
      setMuted(true)
      setToast(`Voice muted for ${minutes} minutes.`)
    } finally {
      setBusy(false)
    }
  }

  const unmute = async () => {
    setBusy(true)
    try {
      await api('/alerts/unmute', { method: 'POST' })
      setMuted(false)
      setToast('Voice unmuted.')
    } finally {
      setBusy(false)
    }
  }

  const updateSettings = async (patch: Partial<Pick<AppSettings, 'voice_enabled' | 'brightness_mode'>>) => {
    setBusy(true)
    try {
      const s = await api<AppSettings>('/settings', { method: 'PUT', body: patch })
      setSettings(s)
      setToast('Settings saved.')
    } finally {
      setBusy(false)
    }
  }

  const setMode = async (mode: 'mock' | 'real') => {
    setBusy(true)
    try {
      await api('/monitor/mode', { method: 'POST', body: { mode } })
      await Promise.all([load(), refreshLive()])
      setToast(`Sensor mode: ${mode}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch mode')
    } finally {
      setBusy(false)
    }
  }

  const setDrift = async (drift: boolean) => {
    setBusy(true)
    try {
      await api('/monitor/mock', { method: 'POST', body: { drift } })
      setToast(drift ? 'Simulating gradual posture drift.' : 'Drift simulation off.')
      await refreshLive()
    } finally {
      setBusy(false)
    }
  }

  const setLux = async (lux: number) => {
    try {
      await api('/monitor/mock', { method: 'POST', body: { lux } })
      await refreshLive()
    } catch {
      /* the live socket will surface the change; nothing to show here */
    }
  }

  return (
    <>
      <PageHeader
        title="Alerts & Settings"
        description="Voice prompts, alert history and your preferences."
      />

      {error && (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </div>
      )}
      {toast && (
        <div className="mb-6 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800 dark:border-teal-500/40 dark:bg-teal-500/10 dark:text-teal-300">
          {toast}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Alert timeline">
            <div className="mb-4 flex flex-wrap gap-2">
              {types.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setFilter(t)}
                  className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
                    filter === t
                      ? 'bg-teal-600 text-white'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {visible.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                No alerts yet. They appear here when ErgoSense notices something worth telling you.
              </p>
            ) : (
              <ul className="space-y-3">
                {visible.map((a) => (
                  <li key={a.id} className="flex gap-3">
                    <span
                      className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        SEVERITY_TONE[a.severity] ?? SEVERITY_TONE.info
                      }`}
                    >
                      {a.severity}
                    </span>
                    <div>
                      <p className="text-sm font-medium">{a.message}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        <span className="capitalize">{a.type}</span> · {new Date(a.ts).toLocaleString()}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Voice controls">
            <button
              type="button"
              disabled={busy}
              onClick={testVoice}
              className="w-full rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50"
            >
              Test voice
            </button>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Voice engine: {settings?.voice_status ?? '—'}
              {settings && !settings.voice_supported && ' (not available here)'}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[15, 30, 60].map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={busy}
                  onClick={() => mute(m)}
                  className="rounded-lg bg-slate-100 px-2 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200"
                >
                  Snooze {m}m
                </button>
              ))}
            </div>
            {muted && (
              <button
                type="button"
                disabled={busy}
                onClick={unmute}
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
              >
                Unmute now
              </button>
            )}
          </Card>

          <Card title="Preferences">
            <Toggle
              label="Voice feedback"
              checked={settings?.voice_enabled ?? false}
              disabled={busy || !settings}
              onChange={(v) => updateSettings({ voice_enabled: v })}
            />
            <Toggle
              label="Automatic brightness"
              checked={settings?.brightness_mode === 'auto'}
              disabled={busy || !settings}
              onChange={(v) => updateSettings({ brightness_mode: v ? 'auto' : 'manual' })}
            />
            <dl className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <div className="flex justify-between">
                <dt>Low-light threshold</dt>
                <dd>{settings ? `${Math.round(settings.low_light_lux)} lx` : '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Long-session limit</dt>
                <dd>{settings ? `${Math.round(settings.long_session_minutes)} min` : '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Signed in as</dt>
                <dd>{user?.name ?? '—'}</dd>
              </div>
            </dl>
          </Card>

          <Card title="Demo controls">
            <p className="-mt-1 mb-3 text-xs text-slate-500 dark:text-slate-400">
              Drive the sensors by hand — useful with no ESP32 and no webcam.
            </p>

            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Sensor mode
            </label>
            <div className="mt-1 mb-3 flex gap-2">
              {(['mock', 'real'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={busy}
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold capitalize transition disabled:opacity-50 ${
                    live?.mode === m
                      ? 'bg-teal-600 text-white'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <p className="mb-3 text-[11px] text-slate-400 dark:text-slate-500">
              {live?.mode === 'real'
                ? 'Real mode reads the webcam on the Posture page and the ESP32 over USB.'
                : 'Mock mode generates labelled synthetic posture and light.'}
            </p>

            <button
              type="button"
              disabled={busy || live?.mode !== 'mock'}
              onClick={() => setDrift(live?.drift.level === 'none')}
              className="w-full rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200"
            >
              {live?.drift.level && live.drift.level !== 'none'
                ? 'Stop drifting'
                : 'Simulate gradual drift'}
            </button>

            <label className="mt-3 block text-xs font-semibold text-slate-500 dark:text-slate-400">
              Mock light: {mockLux} lx
            </label>
            <input
              type="range"
              min={0}
              max={1200}
              step={20}
              value={mockLux}
              disabled={live?.mode !== 'mock'}
              onChange={(e) => setMockLux(Number(e.target.value))}
              onMouseUp={(e) => setLux(Number((e.target as HTMLInputElement).value))}
              onTouchEnd={(e) => setLux(Number((e.target as HTMLInputElement).value))}
              className="mt-2 w-full accent-teal-600 disabled:opacity-50"
            />
          </Card>
        </div>
      </div>
    </>
  )
}
