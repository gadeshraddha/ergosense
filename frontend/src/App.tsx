import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { GuestRoute, ProtectedRoute } from './auth/ProtectedRoute'
import Layout from './components/Layout'
import Alerts from './pages/Alerts'
import Calibration from './pages/Calibration'
import Dashboard from './pages/Dashboard'
import History from './pages/History'
import Lighting from './pages/Lighting'
import Login from './pages/Login'
import NotFound from './pages/NotFound'
import Posture from './pages/Posture'
import Register from './pages/Register'
import Sessions from './pages/Sessions'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public pages (logged-in users are bounced to the dashboard) */}
          <Route element={<GuestRoute />}>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
          </Route>

          {/* Private pages (logged-out users are bounced to /login) */}
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/posture" element={<Posture />} />
              <Route path="/lighting" element={<Lighting />} />
              <Route path="/sessions" element={<Sessions />} />
              <Route path="/history" element={<History />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/calibration" element={<Calibration />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
