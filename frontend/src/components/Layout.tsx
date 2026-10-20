import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { MonitoringProvider } from '../monitoring/MonitoringProvider'
import Sidebar from './Sidebar'
import Topbar from './Topbar'

/** The frame around every logged-in page: sidebar + top bar + page content. */
export default function Layout() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <MonitoringProvider>
      <div className="min-h-screen">
        {mobileOpen && (
          <div
            className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
        )}
        <Sidebar
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          onNavigate={() => setMobileOpen(false)}
        />
        <div className={`transition-[padding] duration-200 ${collapsed ? 'lg:pl-[72px]' : 'lg:pl-64'}`}>
          <Topbar onOpenMobile={() => setMobileOpen(true)} />
          <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
            <Outlet />
          </main>
        </div>
      </div>
    </MonitoringProvider>
  )
}
