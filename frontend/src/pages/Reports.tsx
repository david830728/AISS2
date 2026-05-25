import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileDown, BarChart2, TrendingUp, Users, BookOpen, RefreshCw } from 'lucide-react'
import { examApi, reportsApi, ExamSummary } from '../api'
import toast from 'react-hot-toast'

interface ClassAnalysis {
  exam_id: number
  exam_name: string
  subject: string
  total_students: number
  graded_students: number
  avg_score: number
  max_score: number
  min_score: number
  pass_count: number
  pass_rate: number
  score_distribution: Record<string, number>
  question_analysis: Array<{
    question_number: number
    question_type: string
    avg_score: number
    max_score: number
    full_score_count: number
    zero_score_count: number
  }>
}

export default function Reports() {
  const [searchParams] = useSearchParams()
  const initExamId = searchParams.get('exam_id')

  const [exams, setExams] = useState<ExamSummary[]>([])
  const [selectedExamId, setSelectedExamId] = useState<number | ''>(initExamId ? Number(initExamId) : '')
  const [analysis, setAnalysis] = useState<ClassAnalysis | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    examApi.list().then(setExams)
  }, [])

  useEffect(() => {
    if (selectedExamId) loadAnalysis()
  }, [selectedExamId])

  const loadAnalysis = async () => {
    if (!selectedExamId) return
    setLoading(true)
    try {
      const data = await reportsApi.getClassAnalysis(Number(selectedExamId))
      setAnalysis(data)
    } catch (err: unknown) {
      toast.error((err as Error).message)
      setAnalysis(null)
    } finally {
      setLoading(false)
    }
  }

  const handleExport = () => {
    if (!selectedExamId) { toast.error('请先选择考试'); return }
    reportsApi.downloadExcel(Number(selectedExamId))
    toast.success('正在下载...')
  }

  const Q_TYPE_LABEL: Record<string, string> = { choice: '选择题', fill: '填空题', subjective: '主观题' }

  const distBuckets = analysis ? Object.entries(analysis.score_distribution).sort(([a], [b]) => a.localeCompare(b)) : []

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">分析报告</h1>
          <p className="text-sm text-gray-500 mt-1">查看考试成绩统计与教学分析</p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadAnalysis} disabled={!selectedExamId || loading} className="btn-secondary">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
          </button>
          <button onClick={handleExport} disabled={!selectedExamId} className="btn-secondary">
            <FileDown className="w-4 h-4" /> 导出Excel
          </button>
        </div>
      </div>

      {/* Exam Selector */}
      <div className="card">
        <label className="label">选择考试</label>
        <select className="input max-w-sm" value={selectedExamId}
          onChange={e => setSelectedExamId(Number(e.target.value) || '')}>
          <option value="">请选择考试</option>
          {exams.map(e => <option key={e.id} value={e.id}>{e.name} ({e.subject})</option>)}
        </select>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
        </div>
      )}

      {!loading && !analysis && selectedExamId && (
        <div className="text-center py-16 text-gray-400">
          <BarChart2 className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>暂无分析数据，请先处理扫描文件并完成评分</p>
        </div>
      )}

      {!loading && !selectedExamId && (
        <div className="text-center py-16 text-gray-400">
          <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>请选择考试以查看分析报告</p>
        </div>
      )}

      {!loading && analysis && (
        <>
          {/* Overview Cards */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { icon: Users, label: '参考人数', value: analysis.graded_students, unit: '人', color: 'text-blue-600 bg-blue-50' },
              { icon: TrendingUp, label: '平均分', value: analysis.avg_score?.toFixed(1) ?? '—', unit: '分', color: 'text-green-600 bg-green-50' },
              { icon: BarChart2, label: '最高分', value: analysis.max_score ?? '—', unit: '分', color: 'text-purple-600 bg-purple-50' },
              { icon: BookOpen, label: '及格率', value: `${(analysis.pass_rate * 100).toFixed(1)}%`, unit: '', color: 'text-orange-600 bg-orange-50' },
            ].map(({ icon: Icon, label, value, unit, color }) => (
              <div key={label} className="card flex items-center gap-3 py-4">
                <div className={`w-10 h-10 rounded-lg ${color.split(' ')[1]} flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`w-5 h-5 ${color.split(' ')[0]}`} />
                </div>
                <div>
                  <p className="text-xl font-bold text-gray-900">{value}<span className="text-sm font-normal text-gray-400 ml-0.5">{unit}</span></p>
                  <p className="text-xs text-gray-500">{label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Score Distribution */}
          {distBuckets.length > 0 && (
            <div className="card space-y-4">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-blue-500" /> 分数段分布
              </h2>
              <div className="space-y-2">
                {distBuckets.map(([range, count]) => {
                  const pct = analysis.graded_students > 0
                    ? Math.round((count / analysis.graded_students) * 100) : 0
                  return (
                    <div key={range} className="flex items-center gap-3">
                      <span className="text-sm text-gray-600 w-20 text-right flex-shrink-0">{range}</span>
                      <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                          style={{ width: `${Math.max(pct, 2)}%` }}>
                          {pct > 5 && <span className="text-xs text-white font-medium">{pct}%</span>}
                        </div>
                      </div>
                      <span className="text-sm text-gray-500 w-12 flex-shrink-0">{count} 人</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Per-Question Analysis */}
          {analysis.question_analysis?.length > 0 && (
            <div className="card space-y-4">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-500" /> 逐题得分分析
              </h2>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="table-header">题号</th>
                    <th className="table-header">题型</th>
                    <th className="table-header text-right">满分</th>
                    <th className="table-header text-right">平均得分</th>
                    <th className="table-header text-right">得分率</th>
                    <th className="table-header text-right">满分人数</th>
                    <th className="table-header text-right">零分人数</th>
                    <th className="table-header">难易程度</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.question_analysis.map(q => {
                    const rate = q.max_score > 0 ? q.avg_score / q.max_score : 0
                    const difficulty = rate >= 0.8 ? { label: '容易', color: 'text-green-600 bg-green-50' }
                      : rate >= 0.6 ? { label: '中等', color: 'text-blue-600 bg-blue-50' }
                      : rate >= 0.4 ? { label: '偏难', color: 'text-orange-600 bg-orange-50' }
                      : { label: '困难', color: 'text-red-600 bg-red-50' }
                    return (
                      <tr key={q.question_number} className="border-b border-gray-50">
                        <td className="table-cell font-medium">第 {q.question_number} 题</td>
                        <td className="table-cell">
                          <span className="badge bg-gray-100 text-gray-600 text-xs">
                            {Q_TYPE_LABEL[q.question_type] || q.question_type}
                          </span>
                        </td>
                        <td className="table-cell text-right">{q.max_score}</td>
                        <td className="table-cell text-right font-medium">{q.avg_score?.toFixed(2)}</td>
                        <td className="table-cell text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${rate * 100}%` }} />
                            </div>
                            <span className="text-sm">{(rate * 100).toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="table-cell text-right text-green-600">{q.full_score_count}</td>
                        <td className="table-cell text-right text-red-500">{q.zero_score_count}</td>
                        <td className="table-cell">
                          <span className={`badge ${difficulty.color} text-xs`}>{difficulty.label}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
