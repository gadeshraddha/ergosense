import { useCallback, useEffect, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../api/client'
import type { PostureSummary, PostureTrend } from '../api/types'
import PageHeader from '../components/PageHeader'
import { Card, EmptyState, StatCard, StatusBadge, scoreTone } from '../components/ui'
import { useMonitoring } from '../monitoring/MonitoringProvider'
import CameraPreview from '../components/CameraPreview'

const STATUS_META: Record<string, { label: string; bar: string; tone: 'good' | 'warning' | 'danger' | 'neutral' }> = {
  good: { label: 'In your band', bar: 'bg-emerald-500', tone: 'good' },
  attention: { label: 'Slight deviation', bar: 'bg-amber-500', tone: 'warning' },
  poor: { label: 'Well outside', bar: 'bg-rose-500', tone: 'danger' },
  unknown: { label: 'No reading', bar: 'bg-slate-300 dark:bg-slate-600', tone: 'neutral' },
}

function fmt(value: number | null, digits = 3): string {
  return value == null ? '—' : value.toFixed(digits)
}

export default function Posture() {
  const { data: live, cameraStream, cameraReady, cameraError } = useMonitoring()
  const [summary, setSummary] = useState<PostureSummary | null>(null)
  const [trend, setTrend] = useState<PostureTrend | null>(null)
  const [range, setRange] = useState<'1h' | 'today' | '7d'>('1h')
  const [error, setError] = useState<string | null>(null)

  // In real mode the shared app-wide camera (see MonitoringProvider) posts
  // posture frames and ambient light to the engine for scoring.
  const realMode = live?.mode === 'real'

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([
        api<PostureSummary>('/posture/summary'),
        api<PostureTrend>(`/posture/trend?range=${range}`),
      ])
      setSummary(s)
      setTrend(t)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your posture data')
    }
  }, [range])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 5000)
    return () => window.clearInterval(id)
  }, [load])

  const calibrated = summary?.calibrated ?? false
  const score = summary?.score ?? null
  const today = summary?.today

  return (
    <>
      <PageHeader
        title="Posture"
        description="How you sit compared with your own normal, and how it drifts over time."
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge tone={summary?.source === 'live' ? 'good' : 'neutral'}>
              {summary?.source === 'live'
                ? 'Live'
                : summary?.source === 'stored'
                  ? 'Last recorded'
                  : 'No reading'}
            </StatusBadge>
            <StatusBadge tone={calibrated ? 'info' : 'warning'}>
              {calibrated ? 'Baseline ready' : 'Not calibrated'}
            </StatusBadge>
          </div>
        }
      />

      {error && (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </div>
      )}

      {!calibrated && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
          No personal baseline yet, so we cannot judge your posture. Run the calibration
          once on the Calibration page — it takes a couple of minutes.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Current score"
          value={score == null ? '—' : Math.round(score)}
          tone={score == null ? 'neutral' : scoreTone(score)}
          caption={score == null ? 'Start monitoring to see it' : 'Fused posture + screen + light'}
        />
        <StatCard
          label="Time in good posture"
          value={today && today.n ? Math.round(today.good_pct) : '—'}
          unit={today && today.n ? '%' : undefined}
          tone="good"
          caption={today && today.n ? `${today.n} readings today` : 'No readings today yet'}
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
        <StatCard
          label="Ambient light"
          value={live?.lux != null ? Math.round(live.lux) : summary?.source === 'stored' ? '—' : '—'}
          unit={live?.lux != null ? 'lx' : undefined}
          caption={live?.lux == null ? 'No sensor reading' : live.mode === 'mock' ? 'Simulated (mock)' : live.devices?.esp32 === 'ok' ? 'ESP32 live' : 'From the webcam'}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Features vs your baseline" className="lg:col-span-2">
          {summary && summary.features.some((f) => f.current != null) ? (
            <ul className="space-y-4">
              {summary.features.map((f) => {
                const meta = STATUS_META[f.status] ?? STATUS_META.unknown
                const widthPct =
                  f.z == null ? 0 : Math.min(100, (Math.abs(f.z) / 3) * 100)
                return (
                  <li key={f.key}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium">{f.label}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        now {fmt(f.current)} {f.baseline != null && `• your normal ${fmt(f.baseline)}`}
                        {f.z != null && ` • ${f.z > 0 ? '+' : ''}${f.z.toFixed(2)}σ`}
                      </span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className={`h-2 rounded-full ${meta.bar}`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[11px] text-slate-400 dark:text-slate-500">
                      <span className="capitalize">{meta.label}</span>
                      <span>deviation from your normal</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <EmptyState
              title="No feature readings yet"
              message="Once monitoring starts (or a webcam frame arrives in real mode), each feature appears here next to your baseline."
            />
          )}
        </Card>

        <Card title="Today's posture mix">
          {today && today.n ? (
            <div>
              <div className="flex h-4 overflow-hidden rounded-full">
                <div className="bg-emerald-500" style={{ width: `${today.good_pct}%` }} />
                <div className="bg-amber-500" style={{ width: `${today.mild_pct}%` }} />
                <div className="bg-rose-500" style={{ width: `${today.poor_pct}%` }} />
              </div>
              <ul className="mt-4 space-y-1 text-sm">
                <li className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Good</span>
                  <span className="font-semibold">{today.good_pct.toFixed(0)}%</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Mild deviation</span>
                  <span className="font-semibold">{today.mild_pct.toFixed(0)}%</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Poor</span>
                  <span className="font-semibold">{today.poor_pct.toFixed(0)}%</span>
                </li>
              </ul>
            </div>
          ) : (
            <EmptyState
              title="Nothing recorded today"
              message="Start a monitoring session to see how your day splits between good and poor posture."
            />
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card
          title="Trend"
          hint={`~${trend ? Math.round(trend.bucket_minutes) : 0} min per point`}
          actions={
            <div className="flex gap-1">
              {(['1h', 'today', '7d'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                    range === r
                      ? 'bg-teal-600 text-white'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {r === 'today' ? 'Today' : r}
                </button>
              ))}
            </div>
          }
        >
          {trend && trend.points.length ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={trend.points}
                  margin={{ top: 8, right: 16, bottom: 4, left: -12 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.2)" />
                  <XAxis
                    dataKey="ts"
                    fontSize={11}
                    tickFormatter={(v: string) =>
                      new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    }
                  />
                  <YAxis fontSize={11} />
                  <Tooltip
                    labelFormatter={(v) => new Date(String(v)).toLocaleString()}
                    formatter={(value, name) => {
                      const map: Record<string, string> = {
                        neck_angle: 'Neck angle',
                        distance_proxy: 'Distance',
                        z_neck: 'Neck (σ)',
                      }
                      return [fmt(Number(value)), map[String(name)] ?? String(name)]
                    }}
                  />
                  <ReferenceLine y={0} stroke="rgb(148 163 184 / 0.4)" />
                  <Line
                    type="monotone"
                    dataKey="z_neck"
                    name="Neck (σ)"
                    stroke="#e11d48"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="neck_angle"
                    name="Neck angle"
                    stroke="#0d9488"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="distance_proxy"
                    name="Distance"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              title="No readings in this range"
              message="Pick a different range or start monitoring — the chart fills in from stored samples."
            />
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="What to do" className="lg:col-span-2">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {summary?.tip ?? 'Start monitoring to get a suggestion.'}
          </p>
        </Card>

        <Card title="Webcam preview (real mode)">
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
                Frames are analysed in your browser — for posture <em>and</em> ambient light — and
                sent to the engine for scoring.
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
