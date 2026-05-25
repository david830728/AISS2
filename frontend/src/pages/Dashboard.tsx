import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookOpen, ScanLine, CheckCircle, Clock,
  TrendingUp, FileText, ArrowRight, AlertCircle,
} from 'lucide-react'
import { dashboardApi, DashboardData } from '../api'

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'bg-gray-100 text-gray-600' },
  active: { label: '进行中', color: 'bg-blue-100 text-blue-700' },
  completed: { label: '已完成', color: 'bg-green-100 text-green-700' },
  archived: { label: '已归档', color: 'bg-yellow-100 text-yellow-700' },
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    dashboardApi.get().then(setData).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  const stats = [
    {
      label: '考试总数', value: data?.total_exams ?? 0,
      icon: BookOpen, color: 'bg-blue-500', bg: 'bg-blue-50',
    },
    {
      label: '待处理扫描', value: data?.pending_scans ?? 0,
      icon: ScanLine, color: 'bg-orange-500', bg: 'bg-orange-50',
    },
    {
      label: '待评分试卷', value: data?.pending_grading ?? 0,
      icon: Clock, color: 'bg-yellow-500', bg: 'bg-yellow-50',
    },
    {
      label: '已完成评分', value: data?.completed_grading ?? 0,
      icon: CheckCircle, color: 'bg-green-500', bg: 'bg-green-50',
    },
  ]

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">系统概览</h1>
        <p className="text-gray-500 mt-1 text-sm">乐清市白石中学 AI阅卷系统</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="card flex items-center gap-4">
            <div className={`${bg} w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0`}>
              <Icon className={`w-6 h-6 text-white ${color.replace('bg-', 'text-').replace('-500', '-600')}`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="text-sm text-gray-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Exams */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-500" /> 最近考试
            </h2>
            <button onClick={() => navigate('/exams')}
              className="text-sm text-blue-600 hover:underline flex items-center gap-1">
              查看全部 <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          {!data?.recent_exams?.length ? (
            <div className="text-center py-8 text-gray-400">
              <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>暂无考试记录</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.recent_exams.map((e) => {
                const s = STATUS_MAP[e.status] || { label: e.status, color: 'bg-gray-100 text-gray-600' }
                return (
                  <div key={e.id}
                    onClick={() => navigate(`/exams/${e.id}`)}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                    <div>
                      <p className="font-medium text-sm text-gray-800">{e.name}</p>
                      <p className="text-xs text-gray-500">{e.subject}</p>
                    </div>
                    <span className={`badge ${s.color}`}>{s.label}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="card">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-blue-500" /> 快速操作
          </h2>
          <div className="space-y-3">
            {[
              { icon: BookOpen, label: '新建考试阅卷任务', desc: '设置试卷模板和题目答案', to: '/exams/new', color: 'text-blue-600 bg-blue-50' },
              { icon: ScanLine, label: '扫描文件监控', desc: '查看和处理扫描文件', to: '/scans', color: 'text-green-600 bg-green-50' },
              { icon: CheckCircle, label: '查看成绩报告', desc: '统计分析与教学建议', to: '/reports', color: 'text-purple-600 bg-purple-50' },
            ].map(({ icon: Icon, label, desc, to, color }) => (
              <button key={to} onClick={() => navigate(to)}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-gray-100 hover:border-blue-200 hover:shadow-sm transition-all text-left">
                <div className={`w-10 h-10 rounded-lg ${color.split(' ')[1]} flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 ${color.split(' ')[0]}`} />
                </div>
                <div>
                  <p className="font-medium text-sm text-gray-800">{label}</p>
                  <p className="text-xs text-gray-500">{desc}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-300 ml-auto" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Info Banner */}
      {(data?.pending_grading ?? 0) > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-yellow-800">
              有 {data?.pending_grading} 份试卷待完成评分
            </p>
            <p className="text-xs text-yellow-600 mt-0.5">
              主观题需要AI或人工评分才能完成最终成绩汇总
            </p>
          </div>
          <button onClick={() => navigate('/exams')}
            className="ml-auto text-sm text-yellow-700 font-medium hover:underline whitespace-nowrap">
            前往处理
          </button>
        </div>
      )}
    </div>
  )
}
