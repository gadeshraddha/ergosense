import type { IconName } from './Icon'

export interface NavItem {
  to: string
  label: string
  icon: IconName
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/posture', label: 'Posture', icon: 'posture' },
  { to: '/lighting', label: 'Lighting', icon: 'lighting' },
  { to: '/sessions', label: 'Sessions', icon: 'sessions' },
  { to: '/history', label: 'History', icon: 'history' },
  { to: '/alerts', label: 'Alerts & Settings', icon: 'bell' },
  { to: '/calibration', label: 'Calibration', icon: 'calibrate' },
]
