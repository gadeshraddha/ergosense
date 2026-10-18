import type { IconName } from './Icon'

export interface NavItem {
  to: string
  label: string
  icon: IconName
  /** which module builds the real content of this page */
  module: string
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard', module: 'M4' },
  { to: '/posture', label: 'Posture', icon: 'posture', module: 'M4' },
  { to: '/lighting', label: 'Lighting', icon: 'lighting', module: 'M5' },
  { to: '/sessions', label: 'Sessions', icon: 'sessions', module: 'M6' },
  { to: '/history', label: 'History', icon: 'history', module: 'M6' },
  { to: '/alerts', label: 'Alerts & Settings', icon: 'bell', module: 'M5' },
  { to: '/calibration', label: 'Calibration', icon: 'calibrate', module: 'M3' },
]
