import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Search, FileDown, BarChart2, Eye, Trash2, GitMerge, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import { resultsApi, examApi, reportsApi, StudentExamSummary, Exam } from '../api'

const GRADING_STATUS: Record<string, { label: string; color: string }> = {
  pending:        { label: '待评分', color: 'bg-gray-100 text-gray-500' },
  auto_graded:    { label: '自动评分', color: 'bg-blue-100 text-blue-600' },
  ai_graded:      { label: 'AI评分', color: 'bg-purple-100 text-purple-600' },
  manual_graded:  { label: '人工评分', color: 'bg-orange-100 text-orange-600' },
  completed:      { label: '已完成', color: 'bg-green-100 text-green-700' },
}

interface GradeProgress { running: boolean; graded: number; total: number; failed: number; done: boolean }

export default function Results() {
  const { examId } = useParams()
  const navigate = useNavigate()
  const [exam, setExam] = useState<Exam | null>(null)
  const [results, setResults] = useState<StudentExamSummary[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [grade, setGrade] = useState<GradeProgress>({ running: false, graded: 0, total: 0, failed: 0, done: false })
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = async () => {
    if (!examId) return
    console.log('[Results] 加载成绩，examId:', examId, 'URL:', window.location.pathname)
    setLoading(true)
    try {
      const [e, r] = await Promise.all([
        examApi.get(Number(examId)),
        resultsApi.listByExam(Number(examId)),
      ])
      setExam(e)
      setResults(r)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [examId])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const handleGradeAll = async () => {
    if (!examId || grade.running) return
    try {
      await resultsApi.aiGradeAllExam(Number(examId))
      setGrade({ running: true, graded: 0, total: 0, failed: 0, done: false })
      pollRef.current = setInterval(async () => {
        try {
          const s = await resultsApi.aiGradeAllExamStatus(Number(examId))
          setGrade(prev => ({ ...prev, graded: s.graded, total: s.total, failed: s.failed }))
          if (s.status === 'completed' || s.status === 'failed') {
            clearInterval(pollRef.current!)
            pollRef.current = null
            const ok = s.status === 'completed'
            setGrade({ running: false, graded: s.graded, total: s.total, failed: s.failed, done: true })
            toast[ok ? 'success' : 'error'](
              ok ? `批改完成，共 ${s.graded} 题，失败 ${s.failed} 题` : 'AI批改任务失败'
            )
            if (ok) {
              await load()
              setTimeout(() => setGrade(g => ({ ...g, done: false })), 3000)
            }
          }
        } catch { clearInterval(pollRef.current!); pollRef.current = null }
      }, 2000)
    } catch (err: unknown) {
      toast.error((err as Error).message)
    }
  }

  const handleMerge = async () => {
    if (!examId) return
    try {
      const r = await resultsApi.mergeSheets(Number(examId))
      toast.success(r.merged > 0 ? `合并完成，合并了 ${r.merged} 条重复记录` : '没有需要合并的记录')
      if (r.merged > 0) await load()
    } catch (err: unknown) {
      toast.error((err as Error).message)
    }
  }

  const handleDelete = async (id: number) => {
    if (!examId || !confirm('确定删除该学生成绩记录？')) return
    try {
      await resultsApi.delete(Number(examId), id)
      toast.success('已删除')
      setResults(prev => prev.filter(r => r.id !== id))
    } catch (err: unknown) {
      toast.error((err as Error).message)
    }
  }

  const filtered = results.filter(r =>
    !search ||
    (r.student_name || '').includes(search) ||
    (r.student_number || '').includes(search) ||
    (r.class_name || '').includes(search)
  )

  const scores = results.filter(r => r.total_score != null).map(r => r.total_score as number)
  const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—'
  const max = scores.length ? Math.max(...scores) : '—'
  const min = scores.length ? Math.min(...scores) : '—'
  const passLine = (exam?.total_score || 100) * 0.6
  const passRate = scores.length
    ? Math.round(scores.filter(s => s >= passLine).length / scores.length * 100) : 0

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
    </div>
  )

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/exams/${examId}`)} className="btn-secondary p-2">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {exam?.name || '成绩列表'}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {exam?.subject} · 满分 {exam?.total_score} 分 · 共 {results.length} 人
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* 一键AI批改 */}
          <button
            onClick={handleGradeAll}
            disabled={grade.running}
            className={`btn-primary flex items-center gap-1.5 text-sm ${
              grade.done ? '!bg-green-500 hover:!bg-green-600' : ''
            }`}
          >
            <Sparkles className="w-4 h-4" />
            {grade.running
              ? `批改中... ${grade.graded}/${grade.total || '?'}`
              : grade.done
              ? '批改完成'
              : '一键AI批改所有试卷'}
          </button>
          {/* 进度条 */}
          {grade.running && grade.total > 0 && (
            <div className="flex items-center gap-2 self-center">
              <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all"
                  style={{ width: `${Math.round(grade.graded / grade.total * 100)}%` }}
                />
              </div>
              <span className="text-xs text-gray-500">{Math.round(grade.graded / grade.total * 100)}%</span>
            </div>
          )}
          <button onClick={() => navigate(`/reports?exam_id=${examId}`)} className="btn-secondary">
            <BarChart2 className="w-4 h-4" /> 分析报告
          </button>
          <button onClick={handleMerge} className="btn-secondary" title="将正反面(001_1/001_2)合并为同一学生记录">
            <GitMerge className="w-4 h-4" /> 合并正反面
          </button>
          <button onClick={() => reportsApi.downloadExcel(Number(examId))} className="btn-secondary">
            <FileDown className="w-4 h-4" /> 导出Excel
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      {scores.length > 0 && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: '平均分', value: avg },
            { label: '最高分', value: max },
            { label: '最低分', value: min },
            { label: '及格率', value: `${passRate}%` },
          ].map(({ label, value }) => (
            <div key={label} className="card text-center py-4">
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="text-sm text-gray-500 mt-1">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-9 py-1.5 text-sm" placeholder="搜索姓名、学号、班级..."
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <span className="text-sm text-gray-500">{filtered.length} 人</span>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">暂无成绩记录</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="table-header">排名</th>
                <th className="table-header">姓名</th>
                <th className="table-header">学号</th>
                <th className="table-header">班级</th>
                <th className="table-header text-right">得分</th>
                <th className="table-header text-right">满分比</th>
                <th className="table-header text-center">评分状态</th>
                <th className="table-header">评分时间</th>
                <th className="table-header text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, idx) => {
                const s = GRADING_STATUS[r.grading_status] || { label: r.grading_status, color: 'bg-gray-100 text-gray-500' }
                const pct = r.total_score != null && exam?.total_score
                  ? Math.round(r.total_score / exam.total_score * 100) : null
                const isPass = r.total_score != null && r.total_score >= passLine
                return (
                  <tr key={r.id}
                    onClick={() => navigate(`/results/${examId}/student/${r.id}`)}
                    className="border-b border-gray-50 hover:bg-blue-50/30 cursor-pointer transition-colors">
                    <td className="table-cell">
                      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                        idx === 0 ? 'bg-yellow-400 text-white' :
                        idx === 1 ? 'bg-gray-300 text-white' :
                        idx === 2 ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600'
                      }`}>{idx + 1}</span>
                    </td>
                    <td className="table-cell font-medium">{r.student_name || '—'}</td>
                    <td className="table-cell font-mono text-sm">{r.student_number || '—'}</td>
                    <td className="table-cell text-gray-600">{r.class_name || '—'}</td>
                    <td className="table-cell text-right">
                      <span className={`text-lg font-bold ${
                        isPass ? 'text-green-600' : 'text-red-500'
                      }`}>
                        {r.total_score != null ? r.total_score.toFixed(1) : '—'}
                      </span>
                    </td>
                    <td className="table-cell text-right text-sm text-gray-500">
                      {pct != null ? `${pct}%` : '—'}
                    </td>
                    <td className="table-cell text-center">
                      <span className={`badge ${s.color}`}>{s.label}</span>
                    </td>
                    <td className="table-cell text-xs text-gray-400">
                      {new Date(r.created_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                        <button onClick={() => navigate(`/results/${examId}/student/${r.id}`)}
                          className="p-1.5 text-blue-400 hover:bg-blue-50 rounded-lg">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(r.id)}
                          className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
