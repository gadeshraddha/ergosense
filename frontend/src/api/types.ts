/** Shapes returned by the backend. Keep in sync with backend/app/schemas.py */

export interface User {
  id: number
  name: string
  email: string
  created_at: string
}

export interface TokenResponse {
  access_token: string
  token_type: string
  user: User
}

export interface Health {
  status: string
  mock: boolean
  app: string
}

export interface Drift {
  level: 'none' | 'mild' | 'significant'
  feature: string
  minutes: number
}

export interface Factors {
  posture: number
  screen: number
  lighting: number
  movement: number
}

/** The live snapshot pushed over /ws/live (shape mirrors backend schemas.LiveSnapshot). */
export interface LiveSnapshot {
  ts: string
  monitoring: boolean
  mode: 'mock' | 'real'
  calibrated: boolean
  present: boolean
  features: Record<string, number>
  lux: number | null
  factors: Factors
  score: number
  drift: Drift
  insight: string
  session: { minutes: number; since_break_minutes: number; state: 'active' | 'break' }
  devices: Record<string, string>
}

export interface LightingSummary {
  lux: number | null
  comfort_min: number
  comfort_max: number
  target_pct: number
  current_pct: number | null
  mode: 'auto' | 'manual'
  supported: boolean
  status: 'too_dark' | 'comfortable' | 'too_bright' | 'unknown'
  device: string
  paused: boolean
}

export interface AppSettings {
  voice_enabled: boolean
  brightness_mode: 'auto' | 'manual'
  manual_brightness: number | null
  low_light_lux: number
  long_session_minutes: number
  voice_supported: boolean
  voice_status: string
  brightness_supported: boolean
}

export interface AlertEvent {
  id: number
  ts: string
  type: string
  severity: string
  message: string
}

export interface CalibrationStatus {
  running: boolean
  elapsed_s: number
  duration_s: number
  progress_pct: number
  valid_samples: number
  quality: number
  reason: string | null
  completed: boolean
  baseline_ok: boolean
  message: string | null
  features: string[]
}

// --- posture (M4) ----------------------------------------------------------
export interface PostureFeature {
  key: string
  label: string
  current: number | null
  baseline: number | null
  std: number | null
  z: number | null
  status: 'good' | 'attention' | 'poor' | 'unknown'
  higher_is_worse: boolean
}

export interface PostureToday {
  good_pct: number
  mild_pct: number
  poor_pct: number
  n: number
}

export interface PostureSummary {
  calibrated: boolean
  present: boolean
  score: number | null
  source: 'live' | 'stored' | 'none'
  drift: Drift
  features: PostureFeature[]
  today: PostureToday
  tip: string
}

export interface PostureTrendPoint {
  ts: string
  neck_angle: number | null
  distance_proxy: number | null
  shoulder_tilt: number | null
  z_neck: number | null
  z_distance: number | null
  n: number
}

export interface PostureTrend {
  range: string
  bucket_minutes: number
  mild_z: number
  enter_z: number
  points: PostureTrendPoint[]
}

// --- history (M4/M6) -------------------------------------------------------
export type HistoryRange = '1h' | 'today' | '7d' | '30d'

export interface HistoryPoint {
  ts: string
  n: number
  score: number | null
  posture: number | null
  screen: number | null
  lighting: number | null
  movement: number | null
  lux: number | null
}

export interface HistorySeries {
  range: HistoryRange
  from_ts: string
  to_ts: string
  bucket_minutes: number
  metrics: string[]
  points: HistoryPoint[]
}

export interface HeatmapCell {
  day: string
  hour: number
  avg_score: number
  n: number
}

export interface DaySummary {
  day: string
  hours: number
  avg_score: number | null
  good_pct: number | null
  sessions: number
}

export interface HistorySummary {
  range: HistoryRange
  from_ts: string
  to_ts: string
  samples: number
  hours: number
  avg_score: number | null
  best_score: number | null
  worst_score: number | null
  good_pct: number | null
  drift_episodes: number
  sessions: number
  breaks: number
  by_day: DaySummary[]
  heatmap: HeatmapCell[]
  insight: string
}

export interface EventPage {
  items: AlertEvent[]
  total: number
  limit: number
  offset: number
}

// --- sessions (M6) ---------------------------------------------------------
export interface SessionDay {
  day: string
  work_minutes: number
  breaks: number
  sessions: number
  avg_score: number | null
}

export interface SessionRow {
  id: number
  start: string
  end: string | null
  minutes: number
  avg_score: number | null
  break_count: number
}

export interface SessionStats {
  today_minutes: number
  today_breaks: number
  today_sessions: number
  today_avg_score: number | null
  week_minutes: number
  week_breaks: number
  next_break_minutes: number | null
  by_day: SessionDay[]
  sessions: SessionRow[]
}
