import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, BookOpen, Trash2, BarChart2, ChevronRight, Edit2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { examApi, ExamSummary } from '../api'

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'bg-gray-100 text-gray-600' },
  active: { label: '进行中', color: 'bg-blue-100 text-blue-700' },
  completed: { label: '已完成', color: 'bg-green-100 text-green-700' },
  archived: { label: '已归档', color: 'bg-yellow-100 text-yellow-700' },
}

const SUBJECT_COLORS: Record<string, string> = {
  语文: 'bg-red-100 text-red-700',
  数学: 'bg-blue-100 text-blue-700',
  英语: 'bg-green-100 text-green-700',
  物理: 'bg-purple-100 text-purple-700',
  化学: 'bg-orange-100 text-orange-700',
  生物: 'bg-teal-100 text-teal-700',
  历史: 'bg-amber-100 text-amber-700',
  地理: 'bg-cyan-100 text-cyan-700',
  政治: 'bg-pink-100 text-pink-700',
}

export default function ExamList() {
  const [exams, setExams] = useState<ExamSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  const load = () => {
    setLoading(true)
    examApi.list().then(setExams).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (e: React.MouseEvent, id: number, name: string) => {
    e.stopPropagation()
    if (!confirm(`确定删除考试「${name}」？此操作不可撤销。`)) return
    try {
      await examApi.delete(id)
      toast.success('已删除')
      load()
    } catch (err: unknown) {
      toast.error((err as Error).message)
    }
  }

  const filtered = exams.filter(e =>
    e.name.includes(search) || e.subject.includes(search) || (e.grade || '').includes(search)
  )

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">考试管理</h1>
          <p className="text-sm text-gray-500 mt-1">管理所有阅卷任务</p>
        </div>
        <button className="btn-primary" onClick={() => navigate('/exams/new')}>
          <Plus className="w-4 h-4" /> 新建考试
        </button>
      </div>

      <div className="card p-0 overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-gray-100 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input pl-9 py-1.5 text-sm"
              placeholder="搜索考试名称、科目..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <span className="text-sm text-gray-500">共 {filtered.length} 条</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="text-base">暂无考试记录</p>
            <button className="btn-primary mt-4 text-sm" onClick={() => navigate('/exams/new')}>
              <Plus className="w-4 h-4" /> 新建第一个考试
            </button>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="table-header">考试名称</th>
                <th className="table-header">科目</th>
                <th className="table-header">年级/班级</th>
                <th className="table-header text-center">题目数</th>
                <th className="table-header text-center">学生数</th>
                <th className="table-header text-center">已评分</th>
                <th className="table-header text-center">状态</th>
                <th className="table-header">创建时间</th>
                <th className="table-header text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((exam) => {
                const s = STATUS_MAP[exam.status] || { label: exam.status, color: 'bg-gray-100 text-gray-600' }
                const subjectColor = SUBJECT_COLORS[exam.subject] || 'bg-gray-100 text-gray-600'
                const progress = exam.student_count > 0
                  ? Math.round(exam.graded_count / exam.student_count * 100) : 0
                return (
                  <tr key={exam.id}
                    onClick={() => navigate(`/exams/${exam.id}`)}
                    className="border-b border-gray-50 hover:bg-blue-50/30 cursor-pointer transition-colors">
                    <td className="table-cell">
                      <div className="font-medium text-gray-900">{exam.name}</div>
                      {exam.exam_date && (
                        <div className="text-xs text-gray-400 mt-0.5">
                          {new Date(exam.exam_date).toLocaleDateString('zh-CN')}
                        </div>
                      )}
                    </td>
                    <td className="table-cell">
                      <span className={`badge ${subjectColor}`}>{exam.subject}</span>
                    </td>
                    <td className="table-cell text-gray-600">{exam.grade || ''}{exam.class_name ? ` ${exam.class_name}` : ''}</td>
                    <td className="table-cell text-center">{exam.question_count}</td>
                    <td className="table-cell text-center">{exam.student_count}</td>
                    <td className="table-cell text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-sm font-medium">{exam.graded_count}/{exam.student_count}</span>
                        {exam.student_count > 0 && (
                          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-green-500 rounded-full" style={{ width: `${progress}%` }} />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="table-cell text-center">
                      <span className={`badge ${s.color}`}>{s.label}</span>
                    </td>
                    <td className="table-cell text-gray-500 text-xs">
                      {new Date(exam.created_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={e => { e.stopPropagation(); navigate(`/results/${exam.id}`) }}
                          className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg" title="查看成绩">
                          <BarChart2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); navigate(`/exams/${exam.id}/edit`) }}
                          className="p-1.5 text-gray-400 hover:bg-gray-50 rounded-lg" title="编辑">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={e => handleDelete(e, exam.id, exam.name)}
                          className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg" title="删除">
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <ChevronRight className="w-4 h-4 text-gray-300" />
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
