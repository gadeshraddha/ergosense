import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, downloadFile } from '../api/client'
import type { AlertEvent, EventPage, HistoryRange, HistorySeries, HistorySummary } from '../api/types'
import Icon from '../components/Icon'
import PageHeader from '../components/PageHeader'
import { Card, EmptyState, ScoreChip, StatCard } from '../components/ui'

const RANGES: { key: HistoryRange; label: string }[] = [
  { key: '1h', label: '1 hour' },
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
]

const METRICS: { key: string; label: string; color: string }[] = [
  { key: 'score', label: 'Ergo Score', color: '#0d9488' },
  { key: 'posture', label: 'Posture', color: '#e11d48' },
  { key: 'screen', label: 'Screen', color: '#f59e0b' },
  { key: 'lighting', label: 'Lighting', color: '#3b82f6' },
  { key: 'movement', label: 'Movement', color: '#8b5cf6' },
]

const TONE: Record<string, string> = {
  info: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  danger: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
}

const PAGE = 20

function fmtAxis(range: HistoryRange, iso: string): string {
  const d = new Date(iso)
  if (range === '1h' || range === 'today') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function History() {
  const [range, setRange] = useState<HistoryRange>('7d')
  const [metrics, setMetrics] = useState<string[]>(['score', 'posture'])
  const [series, setSeries] = useState<HistorySeries | null>(null)
  const [summary, setSummary] = useState<HistorySummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // events table
  const [events, setEvents] = useState<AlertEvent[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [typeFilter, setTypeFilter] = useState('all')
  const [types, setTypes] = useState<string[]>([])

  const metricKey = metrics.slice().sort().join(',')

  const loadSeries = useCallback(async () => {
    try {
      const [s, sum] = await Promise.all([
        api<HistorySeries>(`/history?range=${range}&metrics=${metricKey || 'score'}`),
        api<HistorySummary>(`/history/summary?range=${range}`),
      ])
      setSeries(s)
      setSummary(sum)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your history')
    }
  }, [range, metricKey])

  const loadEvents = useCallback(async () => {
    const q = new URLSearchParams({ limit: String(PAGE), offset: String(offset) })
    if (typeFilter !== 'all') q.set('type', typeFilter)
    const page = await api<EventPage>(`/history/events?${q.toString()}`)
    setEvents(page.items)
    setTotal(page.total)
  }, [offset, typeFilter])

  useEffect(() => {
    void loadSeries()
  }, [loadSeries])

  useEffect(() => {
    void loadEvents().catch(() => undefined)
  }, [loadEvents])

  useEffect(() => {
    // reset "type" filters that no longer exist after a range change
    void api<string[]>('/history/event-types')
      .then(setTypes)
      .catch(() => undefined)
  }, [])

  const toggleMetric = (key: string) => {
    setMetrics((cur) =>
      cur.includes(key) ? (cur.length > 1 ? cur.filter((m) => m !== key) : cur) : [...cur, key],
    )
  }

  const exportCsv = async () => {
    setBusy(true)
    try {
      await downloadFile('/history/export.csv', `ergosense-history-${range}.csv`, { range })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  const heat = useMemo(() => {
    const cells = summary?.heatmap ?? []
    const days = Array.from(new Set(cells.map((c) => c.day))).sort()
    const hours = Array.from(new Set(cells.map((c) => c.hour))).sort((a, b) => a - b)
    const byKey = new Map(cells.map((c) => [`${c.day}-${c.hour}`, c]))
    return { days, hours, byKey }
  }, [summary])

  const heatColor = (score: number, n: number): string => {
    if (!n) return 'bg-slate-100 dark:bg-slate-800'
    if (score >= 85) return 'bg-emerald-500'
    if (score >= 70) return 'bg-emerald-400/70'
    if (score >= 55) return 'bg-amber-400'
    return 'bg-rose-500'
  }

  const hasPoints = (series?.points.length ?? 0) > 0

  return (
    <>
      <PageHeader
        title="History"
        description="Trends over hours, days and weeks, straight from your recorded samples."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => {
                    setRange(r.key)
                    setOffset(0)
                  }}
                  className={`px-3 py-2 text-xs font-semibold transition ${
                    range === r.key
                      ? 'bg-teal-600 text-white'
                      : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={exportCsv}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Icon name="history" className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Average score"
          value={summary?.avg_score != null ? Math.round(summary.avg_score) : '—'}
          caption={summary ? `${summary.samples} readings in range` : ''}
        />
        <StatCard
          label="Good time (80+)"
          value={summary?.good_pct != null ? Math.round(summary.good_pct) : '—'}
          unit={summary?.good_pct != null ? '%' : undefined}
          tone="good"
          caption={summary ? `${summary.breaks} breaks • ${summary.sessions} sessions` : ''}
        />
        <StatCard
          label="Drift episodes"
          value={summary ? summary.drift_episodes : '—'}
          tone={summary && summary.drift_episodes > 0 ? 'warning' : 'neutral'}
          caption="Gradual changes detected"
        />
        <StatCard
          label="Work time"
          value={summary ? `${summary.hours.toFixed(1)}` : '—'}
          unit={summary ? 'h' : undefined}
          caption={summary ? `Best ${summary.best_score != null ? Math.round(summary.best_score) : '—'} • worst ${summary.worst_score != null ? Math.round(summary.worst_score) : '—'}` : ''}
        />
      </div>

      {summary?.insight && (
        <div className="mt-4 rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900 dark:border-teal-500/40 dark:bg-teal-500/10 dark:text-teal-200">
          {summary.insight}
        </div>
      )}

      <div className="mt-4">
        <Card
          title="Score & factor trend"
          hint={series ? `about ${Math.round(series.bucket_minutes)} minutes per point` : undefined}
          actions={
            <div className="flex flex-wrap gap-1">
              {METRICS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => toggleMetric(m.key)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    metrics.includes(m.key)
                      ? 'text-white'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                  style={metrics.includes(m.key) ? { backgroundColor: m.color } : undefined}
                >
                  {m.label}
                </button>
              ))}
            </div>
          }
        >
          {hasPoints ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series?.points ?? []} margin={{ top: 8, right: 16, bottom: 4, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.2)" />
                  <XAxis dataKey="ts" fontSize={11} tickFormatter={(v: string) => fmtAxis(range, v)} />
                  <YAxis domain={[0, 100]} fontSize={11} />
                  <Tooltip
                    labelFormatter={(v) => new Date(String(v)).toLocaleString()}
                    formatter={(value, name) => {
                      const meta = METRICS.find((m) => m.key === name)
                      return [Math.round(Number(value)), meta?.label ?? String(name)]
                    }}
                  />
                  <Legend formatter={(name) => METRICS.find((m) => m.key === name)?.label ?? name} />
                  {METRICS.filter((m) => metrics.includes(m.key)).map((m) => (
                    <Line
                      key={m.key}
                      type="monotone"
                      dataKey={m.key}
                      stroke={m.color}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              icon={<Icon name="history" className="h-5 w-5" />}
              title="No readings in this range"
              message="Nothing was recorded in this time window. Try a wider range, or start monitoring to fill it in."
            />
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Score by hour" hint="Pick a busier day if a row looks empty." className="lg:col-span-2">
          {heat.days.length ? (
            <div className="overflow-x-auto">
              <div className="min-w-[560px]">
                <div className="flex">
                  <div className="w-16 shrink-0" />
                  {heat.hours.map((h) => (
                    <div key={h} className="flex-1 text-center text-[10px] text-slate-400">
                      {h % 3 === 0 ? `${h}` : ''}
                    </div>
                  ))}
                </div>
                {heat.days.map((d) => (
                  <div key={d} className="flex items-center">
                    <div className="w-16 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">
                      {new Date(`${d}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </div>
                    {heat.hours.map((h) => {
                      const cell = heat.byKey.get(`${d}-${h}`)
                      return (
                        <div
                          key={h}
                          title={cell ? `${cell.avg_score} (${cell.n} readings)` : 'no data'}
                          className={`m-0.5 h-6 flex-1 rounded ${heatColor(cell?.avg_score ?? 0, cell?.n ?? 0)}`}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState
              title="No hourly data yet"
              message="The heatmap lights up once samples are stored for the days in this range."
            />
          )}
        </Card>

        <Card title="Detected deviations">
          <div className="mb-3 flex flex-wrap gap-1">
            {['all', ...types].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTypeFilter(t)
                  setOffset(0)
                }}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
                  typeFilter === t
                    ? 'bg-teal-600 text-white'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          {events.length ? (
            <>
              <ul className="space-y-3">
                {events.map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <span
                      className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        TONE[e.severity] ?? TONE.info
                      }`}
                    >
                      {e.severity}
                    </span>
                    <div>
                      <p className="text-sm font-medium">{e.message}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        <span className="capitalize">{e.type}</span> • {new Date(e.ts).toLocaleString()}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              {total > PAGE && (
                <div className="mt-4 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    disabled={offset === 0}
                    onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
                    className="rounded-lg border border-slate-200 px-3 py-1 font-semibold disabled:opacity-40 dark:border-slate-700"
                  >
                    Newer
                  </button>
                  <span className="text-slate-500 dark:text-slate-400">
                    {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
                  </span>
                  <button
                    type="button"
                    disabled={offset + PAGE >= total}
                    onClick={() => setOffset((o) => o + PAGE)}
                    className="rounded-lg border border-slate-200 px-3 py-1 font-semibold disabled:opacity-40 dark:border-slate-700"
                  >
                    Older
                  </button>
                </div>
              )}
            </>
          ) : (
            <EmptyState
              title="No events here"
              message="Drift alerts, voice prompts and breaks appear in this list as they happen."
            />
          )}
        </Card>
      </div>

      {summary?.by_day && summary.by_day.length > 0 && (
        <div className="mt-4">
          <Card title="Day by day">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    <th className="pb-2 pr-4 font-semibold">Day</th>
                    <th className="pb-2 pr-4 font-semibold">Work time</th>
                    <th className="pb-2 pr-4 font-semibold">Avg score</th>
                    <th className="pb-2 pr-4 font-semibold">Good %</th>
                    <th className="pb-2 font-semibold">Sessions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {summary.by_day.map((d) => (
                    <tr key={d.day}>
                      <td className="py-2 pr-4">
                        {new Date(`${d.day}T00:00:00`).toLocaleDateString([], {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td className="py-2 pr-4">{d.hours.toFixed(1)}h</td>
                      <td className="py-2 pr-4">
                        {d.avg_score != null ? <ScoreChip score={d.avg_score} /> : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="py-2 pr-4">{d.good_pct != null ? `${Math.round(d.good_pct)}%` : '—'}</td>
                      <td className="py-2">{d.sessions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  )
}
