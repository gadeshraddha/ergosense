import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../api/client'
import type { LightingSummary } from '../api/types'
import PageHeader from '../components/PageHeader'
import { useMonitoring } from '../monitoring/MonitoringProvider'

interface CurvePoint {
  lux: number
  target_pct: number
}

interface TrendPoint {
  t: number
  lux: number | null
  target: number
}

const STATUS_TEXT: Record<string, string> = {
  too_dark: 'Too dark',
  comfortable: 'Comfortable',
  too_bright: 'Too bright',
  unknown: 'No reading',
}

const STATUS_TONE: Record<string, string> = {
  too_dark: 'text-amber-600 dark:text-amber-400',
  comfortable: 'text-emerald-600 dark:text-emerald-400',
  too_bright: 'text-amber-600 dark:text-amber-400',
  unknown: 'text-slate-500 dark:text-slate-400',
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-3 text-sm font-semibold text-slate-500 dark:text-slate-400">{title}</h2>
      {children}
    </div>
  )
}

export default function Lighting() {
  const { data: live } = useMonitoring()
  const [summary, setSummary] = useState<LightingSummary | null>(null)
  const [curve, setCurve] = useState<CurvePoint[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState(60)
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const trendRef = useRef<TrendPoint[]>([])

  const load = useCallback(async () => {
    try {
      const s = await api<LightingSummary>('/lighting/summary')
      setSummary(s)
      setError(null)
      trendRef.current = [
        ...trendRef.current,
        { t: Date.now(), lux: s.lux, target: s.target_pct },
      ].slice(-40)
      setTrend(trendRef.current)
      return s
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load lighting data')
      return null
    }
  }, [])

  useEffect(() => {
    void load()
    api<CurvePoint[]>('/lighting/curve').then(setCurve).catch(() => undefined)
    const id = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(id)
  }, [load])

  const changeMode = async (mode: 'auto' | 'manual') => {
    setBusy(true)
    try {
      const s = await api<LightingSummary>('/lighting/mode', { method: 'POST', body: { mode } })
      setSummary(s)
      if (s.current_pct != null) setManual(Math.round(s.current_pct))
    } finally {
      setBusy(false)
    }
  }

  const applyManual = async (value: number) => {
    setManual(value)
    setBusy(true)
    try {
      const s = await api<LightingSummary>('/lighting/brightness', {
        method: 'POST',
        body: { brightness: value },
      })
      setSummary(s)
    } finally {
      setBusy(false)
    }
  }

  const lux = live?.lux ?? summary?.lux ?? null
  const status = summary?.status ?? 'unknown'
  const comfortLow = summary?.comfort_min ?? 300
  const comfortHigh = summary?.comfort_max ?? 1000
  const bandLeft = (Math.min(comfortLow, 2000) / 2000) * 100
  const bandWidth = ((Math.min(comfortHigh, 2000) - Math.min(comfortLow, 2000)) / 2000) * 100

  return (
    <>
      <PageHeader
        title="Lighting"
        description="Room light from the BH1750 sensor, and automatic screen brightness."
        actions={
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full border border-slate-200 px-3 py-1 text-slate-600 dark:border-slate-700 dark:text-slate-300">
              ESP32: {summary?.device ?? '—'}
            </span>
            {live?.mode === 'mock' && (
              <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                Mock
              </span>
            )}
          </div>
        }
      />

      {error && (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="Ambient light">
          <p className="text-3xl font-bold">{lux != null ? `${Math.round(lux)} lx` : '—'}</p>
          <p className={`mt-1 text-xs font-semibold ${STATUS_TONE[status]}`}>{STATUS_TEXT[status]}</p>
        </Card>
        <Card title="Comfort zone">
          <p className="text-2xl font-bold">
            {Math.round(comfortLow)}–{Math.round(comfortHigh)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">lux range</p>
        </Card>
        <Card title="Target brightness">
          <p className="text-3xl font-bold text-teal-600 dark:text-teal-400">
            {summary ? `${Math.round(summary.target_pct)}%` : '—'}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {summary?.mode === 'manual' ? 'Manual mode' : 'Auto mode'}
          </p>
        </Card>
        <Card title="Screen brightness">
          <p className="text-3xl font-bold">
            {summary?.current_pct != null ? `${Math.round(summary.current_pct)}%` : '—'}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {summary?.supported ? 'Controllable' : 'Not supported on this laptop'}
          </p>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Lux to brightness curve">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={curve} margin={{ top: 8, right: 16, bottom: 4, left: -12 }}>
                  <defs>
                    <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0d9488" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#0d9488" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.2)" />
                  <XAxis
                    dataKey="lux"
                    type="number"
                    domain={[0, 2000]}
                    tickFormatter={(v: number) => `${v}`}
                    fontSize={11}
                  />
                  <YAxis domain={[0, 100]} fontSize={11} tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip
                    formatter={(value, name) =>
                      name === 'target_pct'
                        ? [`${Math.round(Number(value))}%`, 'Target']
                        : [String(value), String(name)]
                    }
                    labelFormatter={(label) => `${Number(label)} lx`}
                  />
                  <Area
                    type="monotone"
                    dataKey="target_pct"
                    stroke="#0d9488"
                    strokeWidth={2}
                    fill="url(#curveFill)"
                    isAnimationActive={false}
                  />
                  {lux != null && summary && (
                    <ReferenceDot
                      x={lux}
                      y={summary.target_pct}
                      r={6}
                      fill="#0d9488"
                      stroke="#ffffff"
                      strokeWidth={2}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="relative mt-3 h-2 rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="absolute inset-y-0 rounded-full bg-emerald-200/70 dark:bg-emerald-500/20"
                style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }}
              />
              {lux != null && (
                <div
                  className="absolute -top-1 h-4 w-1 -translate-x-1/2 rounded bg-teal-600"
                  style={{ left: `${Math.min(100, (lux / 2000) * 100)}%` }}
                />
              )}
            </div>
          </Card>
        </div>

        <Card title="Brightness control">
          <div className="mb-4 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => changeMode('auto')}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition disabled:opacity-50 ${
                summary?.mode === 'auto'
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              Auto
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => changeMode('manual')}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition disabled:opacity-50 ${
                summary?.mode === 'manual'
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              Manual
            </button>
          </div>

          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Manual brightness: {manual}%
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={manual}
            disabled={busy}
            onChange={(e) => setManual(Number(e.target.value))}
            onMouseUp={(e) => applyManual(Number((e.target as HTMLInputElement).value))}
            onTouchEnd={(e) => applyManual(Number((e.target as HTMLInputElement).value))}
            className="mt-2 w-full accent-teal-600"
          />

          {summary?.paused && (
            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              Auto control is paused after your manual change.
            </p>
          )}
          {summary && !summary.supported && (
            <p className="mt-4 text-xs text-amber-600 dark:text-amber-400">
              This laptop does not allow brightness control; the target is still shown.
            </p>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Ambient light over time">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 8, right: 16, bottom: 4, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.2)" />
                <XAxis
                  dataKey="t"
                  fontSize={11}
                  tickFormatter={(v: number) => new Date(v).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })}
                />
                <YAxis fontSize={11} />
                <Tooltip
                  labelFormatter={(label) => new Date(Number(label)).toLocaleTimeString()}
                  formatter={(value, name) =>
                    name === 'lux'
                      ? [`${Math.round(Number(value))} lx`, 'Light']
                      : [`${Math.round(Number(value))}%`, 'Target']
                  }
                />
                <Line type="monotone" dataKey="lux" stroke="#0d9488" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="target" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </>
  )
}
