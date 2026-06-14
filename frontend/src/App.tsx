import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import {
  LayoutDashboard, BookOpen, ScanLine, BarChart2,
  Settings, GraduationCap, LogOut, UserCircle,
} from 'lucide-react'
import Dashboard from './pages/Dashboard'
import ExamList from './pages/ExamList'
import ExamCreate from './pages/ExamCreate'
import ExamDetail from './pages/ExamDetail'
import ScanMonitor from './pages/ScanMonitor'
import Results from './pages/Results'
import ResultDetail from './pages/ResultDetail'
import Reports from './pages/Reports'
import SettingsPage from './pages/Settings'
import Login from './pages/Login'
import { clsx } from 'clsx'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: '仪表盘', exact: true },
  { to: '/exams', icon: BookOpen, label: '考试管理' },
  { to: '/scans', icon: ScanLine, label: '扫描监控' },
  { to: '/reports', icon: BarChart2, label: '成绩报告' },
  { to: '/settings', icon: Settings, label: '系统设置' },
]

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('token')
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

function handleLogout() {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  window.location.href = '/login'
}

function AppLayout() {
  const location = useLocation()
  const user = JSON.parse(localStorage.getItem('user') || '{}')
  const isAdmin = user.role === 'admin'

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Toaster position="top-right" />

      {/* Sidebar */}
      <aside className="w-64 bg-gradient-to-b from-blue-900 to-blue-800 flex flex-col flex-shrink-0">
        {/* Logo */}
        <div className="px-6 py-5 border-b border-blue-700/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-white font-bold text-sm leading-tight">AI阅卷系统</div>
              <div className="text-blue-200 text-xs leading-tight mt-0.5">乐清市白石中学</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.filter(({ to }) => to !== '/settings' || isAdmin).map(({ to, icon: Icon, label, exact }) => {
            const active = exact
              ? location.pathname === to
              : location.pathname.startsWith(to)
            return (
              <NavLink
                key={to}
                to={to}
                className={clsx(
                  'flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all',
                  active
                    ? 'bg-white/20 text-white shadow-sm'
                    : 'text-blue-100 hover:bg-white/10 hover:text-white'
                )}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {label}
              </NavLink>
            )
          })}
        </nav>

        {/* User info + logout */}
        <div className="px-4 py-4 border-t border-blue-700/50 space-y-3">
          <div className="flex items-center gap-2.5 px-2">
            <UserCircle className="w-8 h-8 text-blue-300 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-white text-sm font-medium truncate">{user.name || user.username || '用户'}</p>
              <p className="text-blue-300 text-xs">{isAdmin ? '管理员' : '教师'}</p>
            </div>
          </div>
          <a
            href="/portal.html"
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-blue-200 hover:bg-white/10 hover:text-white text-sm transition-all"
          >
            切换系统
          </a>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-blue-200 hover:bg-white/10 hover:text-white text-sm transition-all"
          >
            <LogOut className="w-4 h-4" />
            退出登录
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/exams" element={<ExamList />} />
            <Route path="/exams/new" element={<ExamCreate />} />
            <Route path="/exams/:id" element={<ExamDetail />} />
            <Route path="/exams/:id/edit" element={<ExamCreate />} />
            <Route path="/scans" element={<ScanMonitor />} />
            <Route path="/results/:examId" element={<Results />} />
            <Route path="/results/:examId/student/:studentExamId" element={<ResultDetail />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={
        <PrivateRoute>
          <AppLayout />
        </PrivateRoute>
      } />
    </Routes>
  )
}
