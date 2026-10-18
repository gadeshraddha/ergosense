import { NavLink } from 'react-router-dom'
import Icon from './Icon'
import Logo, { LogoMark } from './Logo'
import { NAV_ITEMS } from './nav'

interface SidebarProps {
  collapsed: boolean
  mobileOpen: boolean
  onToggleCollapse: () => void
  onNavigate: () => void
}

export default function Sidebar({ collapsed, mobileOpen, onToggleCollapse, onNavigate }: SidebarProps) {
  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white transition-all duration-200 dark:border-slate-800 dark:bg-slate-900 ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      } lg:translate-x-0 ${collapsed ? 'lg:w-[72px]' : 'lg:w-64'}`}
    >
      <div className={`flex h-16 items-center border-b border-slate-200 px-5 dark:border-slate-800 ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}>
        <span className={collapsed ? 'lg:hidden' : ''}>
          <Logo />
        </span>
        {collapsed && (
          <span className="hidden lg:block">
            <LogoMark />
          </span>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                collapsed ? 'lg:justify-center' : ''
              } ${
                isActive
                  ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
              }`
            }
          >
            <Icon name={item.icon} className="h-5 w-5 shrink-0" />
            <span className={collapsed ? 'lg:hidden' : ''}>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="hidden border-t border-slate-200 p-3 dark:border-slate-800 lg:block">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} className="h-5 w-5" />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  )
}
