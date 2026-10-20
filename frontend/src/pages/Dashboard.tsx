import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { AlertEvent } from '../api/types'
import CameraPreview from '../components/CameraPreview'
import PageHeader from '../components/PageHeader'
import { Card, EmptyState, ScoreChip, StatCard, StatusBadge, scoreTone } from '../components/ui'
import { useMonitoring } from '../monitoring/MonitoringProvider'

const SEVERITY_TONE: Record<string, 'neutral' | 'warning' | 'danger'> = {
  info: 'neutral',
  warning: 'warning',
  danger: 'danger',
}

/** The landing page: the live Ergo Score, insight, devices and recent alerts. */
export default function Dashboard() {
  const { data: live, cameraStream, cameraReady, cameraError } = useMonitoring()
  const [alerts, setAlerts] = useState<AlertEvent[]>([])

  useEffect(() => {
    let active = true
    const load = () =>
      api<AlertEvent[]>('/alerts')
        .then((rows) => active && setAlerts(rows.slice(0, 5)))
        .catch(() => undefined)
    void load()
    const id = window.setInterval(load, 10000)
    return () => {
      active = false
      window.clearInterval(id)
    }
  }, [])

  const score = live?.score ?? null
  const realMode = live?.mode === 'real'

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Your live Ergo Score, what it means, and what the system is doing right now."
        actions={
          <StatusBadge tone={live?.monitoring ? 'good' : 'neutral'}>
            {live?.monitoring ? 'Monitoring' : 'Stopped'}
          </StatusBadge>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Ergo Score"
          value={
            score == null ? (
              '—'
            ) : (
              <span className="flex items-center gap-2">
                {Math.round(score)} <ScoreChip score={score} />
              </span>
            )
          }
          tone={score == null ? 'neutral' : scoreTone(score)}
          caption={live?.calibrated ? 'Personal baseline active' : 'Not calibrated yet'}
        />
        <StatCard
          label="Posture"
          value={live?.factors ? Math.round(live.factors.posture) : '—'}
          tone={live?.factors ? scoreTone(live.factors.posture) : 'neutral'}
          caption="How you sit vs your normal"
        />
        <StatCard
          label="Ambient light"
          value={live?.lux != null ? Math.round(live.lux) : '—'}
          unit={live?.lux != null ? 'lx' : undefined}
          caption={
            live?.lux == null
              ? 'No light reading'
              : live.mode === 'mock'
                ? 'Simulated (mock)'
                : live.devices?.esp32 === 'ok'
                  ? 'ESP32 live'
                  : 'From the webcam'
          }
        />
        <StatCard
          label="Drift"
          value={live?.drift?.level ?? 'none'}
          tone={
            live?.drift?.level === 'significant'
              ? 'danger'
              : live?.drift?.level === 'mild'
                ? 'warning'
                : 'good'
          }
          caption={
            live?.drift && live.drift.level !== 'none'
              ? `${live.drift.feature.replace('_', ' ')} • ${Math.round(live.drift.minutes)} min`
              : 'No gradual drift detected'
          }
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Live insight" className="lg:col-span-2">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {live ? live.insight : 'Start monitoring to see your live Ergo Score.'}
          </p>
          {live && (
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(live.devices).map(([device, state]) => (
                <StatusBadge
                  key={device}
                  tone={state === 'ok' ? 'good' : state === 'supported' ? 'good' : 'neutral'}
                >
                  {device}: {state}
                </StatusBadge>
              ))}
            </div>
          )}
        </Card>

        <Card title="Recent alerts">
          {alerts.length === 0 ? (
            <EmptyState
              title="No alerts yet"
              message="ErgoSense will quietly tell you here when something is worth a nudge."
            />
          ) : (
            <ul className="space-y-3">
              {alerts.map((a) => (
                <li key={a.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <StatusBadge tone={SEVERITY_TONE[a.severity] ?? 'neutral'}>{a.type}</StatusBadge>
                    <span className="text-xs text-slate-400">
                      {new Date(a.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-600 dark:text-slate-300">{a.message}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Webcam (real mode)">
          {realMode ? (
            <>
              <div className="relative w-fit overflow-hidden rounded-lg bg-black">
                <CameraPreview stream={cameraStream} />
                {!cameraReady && !cameraError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-xs text-white">
                    Starting camera…
                  </div>
                )}
              </div>
              {cameraError && (
                <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">
                  {cameraError.message || 'Camera unavailable.'}
                </p>
              )}
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                One camera serves both posture and ambient light, analysed in your browser.
              </p>
            </>
          ) : (
            <EmptyState
              title="Mock mode"
              message="Switch to real mode from Alerts → Demo controls to use the webcam. Mock mode streams synthetic posture instead."
            />
          )}
        </Card>
      </div>
    </>
  )
}
