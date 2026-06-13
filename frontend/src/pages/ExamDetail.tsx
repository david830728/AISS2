import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Edit2, ScanLine, BarChart2, Play, Upload,
  Users, CheckCircle, Clock, BookOpen, FileDown, Bug,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { examApi, scanApi, reportsApi, studentsApi, AnswerSheetStatus, Exam, ScanFile } from '../api'
import AnswerSheetDebugView from '../components/AnswerSheetDebugView'
import type { SheetQuestion } from '../components/AnswerSheetPreview'

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'bg-gray-100 text-gray-600' },
  active: { label: '进行中', color: 'bg-blue-100 text-blue-700' },
  completed: { label: '已完成', color: 'bg-green-100 text-green-700' },
}
const SCAN_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: '待处理', color: 'bg-yellow-100 text-yellow-700' },
  processing: { label: '处理中', color: 'bg-blue-100 text-blue-700' },
  completed: { label: '已完成', color: 'bg-green-100 text-green-700' },
  failed: { label: '失败', color: 'bg-red-100 text-red-700' },
}

export default function ExamDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [exam, setExam] = useState<Exam | null>(null)
  const [scans, setScans] = useState<ScanFile[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [activeTab, setActiveTab] = useState<'questions' | 'scans'>('questions')
  const [debugOpen, setDebugOpen] = useState(false)
  const [sheetStatus, setSheetStatus] = useState<AnswerSheetStatus | null>(null)
  const [generatingPdf, setGeneratingPdf] = useState(false)

  const load = async () => {
    if (!id) return
    try {
      const [e, s] = await Promise.all([
        examApi.get(Number(id)),
        scanApi.list(Number(id)),
      ])
      setExam(e)
      setScans(s)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id])

  useEffect(() => {
    if (!id) return
    studentsApi.sheetStatus(Number(id)).then(setSheetStatus).catch(() => {})
  }, [id])

  const handleDownloadPdf = async () => {
    if (!id) return
    const token = localStorage.getItem('token')
    const res = await fetch(`/api/exams/${id}/answer-sheet/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) {
      toast.error('下载失败，请重新登录')
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `答题卡_${id}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleGeneratePdf = async (layout = 'by_student') => {
    if (!id) return
    setGeneratingPdf(true)
    try {
      const r = await studentsApi.generatePdf(Number(id), layout)
      toast.success(`答题卡PDF生成中，共 ${r.student_count} 份...`)
      // 轮询直到生成完成
      const poll = setInterval(async () => {
        const s = await studentsApi.sheetStatus(Number(id))
        setSheetStatus(s)
        if (s.has_pdf) { clearInterval(poll); setGeneratingPdf(false) }
      }, 2000)
      setTimeout(() => { clearInterval(poll); setGeneratingPdf(false) }, 60000)
    } catch (err: unknown) {
      toast.error((err as Error).message)
      setGeneratingPdf(false)
    }
  }

  const handleActivate = async () => {
    if (!exam) return
    const newStatus = exam.status === 'draft' ? 'active' : 'completed'
    await examApi.update(exam.id, { status: newStatus })
    setExam({ ...exam, status: newStatus })
    toast.success(newStatus === 'active' ? '考试已激活' : '考试已完成')
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !id) return
    setUploading(true)
    try {
      const files = Array.from(e.target.files)
      await scanApi.upload(Number(id), files)
      toast.success(`成功上传 ${files.length} 个文件`)
      load()
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleProcessAll = async () => {
    if (!id) return
    setProcessing(true)
    try {
      const result = await scanApi.processBatch(Number(id))
      toast.success(`处理完成：${result.success} 成功，${result.failed} 失败`)
      load()
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setProcessing(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
    </div>
  )
  if (!exam) return <div className="p-8 text-gray-500">考试不存在</div>

  const s = STATUS_MAP[exam.status] || { label: exam.status, color: 'bg-gray-100 text-gray-600' }
  const pendingScans = scans.filter(sf => sf.status === 'pending').length
  const completedScans = scans.filter(sf => sf.status === 'completed').length
  const Q_TYPE_LABEL: Record<string, string> = { choice: '选择题', fill: '填空题', subjective: '主观题' }

  return (
    <div className="p-8 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/exams')} className="btn-secondary p-2">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{exam.name}</h1>
              <span className={`badge ${s.color}`}>{s.label}</span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              {exam.subject} · {exam.grade || ''} {exam.class_name || ''} ·
              满分 {exam.total_score} 分 · {exam.questions.length} 道题
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(`/exams/${id}/edit`)} className="btn-secondary">
            <Edit2 className="w-4 h-4" /> 编辑
          </button>
          {exam.status !== 'archived' && (
            <button onClick={handleActivate} className="btn-primary">
              {exam.status === 'draft' ? '激活考试' : '标记完成'}
            </button>
          )}
        </div>
      </div>

      {/* Answer Sheet PDF Card */}
      {sheetStatus && (
        <div className="card flex items-center gap-4 py-4 border-blue-100 bg-blue-50/40">
          <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
            <FileDown className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1">
            {sheetStatus.student_count === 0 ? (
              <p className="text-sm text-gray-500">
                尚无考生名单，请在
                <button onClick={() => navigate(`/exams/${id}/edit`)} className="text-blue-600 underline mx-1">编辑页</button>
                上传名单后生成答题卡
              </p>
            ) : sheetStatus.has_pdf ? (
              <div className="flex items-center gap-3">
                <p className="text-sm text-gray-700">答题卡PDF已生成（共 {sheetStatus.student_count} 份）</p>
                <button onClick={handleDownloadPdf}
                  className="btn-primary text-xs py-1 px-3">
                  <FileDown className="w-3.5 h-3.5" /> 下载PDF
                </button>
                <button onClick={() => handleGeneratePdf()} disabled={generatingPdf}
                  className="btn-secondary text-xs py-1 px-3">
                  {generatingPdf ? '生成中...' : '重新生成'}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <p className="text-sm text-gray-700">已有 {sheetStatus.student_count} 名考生，答题卡尚未生成</p>
                <button onClick={() => handleGeneratePdf()} disabled={generatingPdf}
                  className="btn-primary text-xs py-1 px-3">
                  {generatingPdf ? '生成中...' : '生成答题卡PDF'}
                </button>
                <button onClick={() => handleGeneratePdf('by_side')} disabled={generatingPdf}
                  className="btn-secondary text-xs py-1 px-3">按面排列</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { icon: BookOpen, label: '题目数', value: exam.questions.length, color: 'text-blue-600 bg-blue-50' },
          { icon: ScanLine, label: '扫描文件', value: scans.length, color: 'text-orange-600 bg-orange-50' },
          { icon: CheckCircle, label: '已处理', value: completedScans, color: 'text-green-600 bg-green-50' },
          { icon: Clock, label: '待处理', value: pendingScans, color: 'text-yellow-600 bg-yellow-50' },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="card flex items-center gap-3 py-4">
            <div className={`w-10 h-10 rounded-lg ${color.split(' ')[1]} flex items-center justify-center`}>
              <Icon className={`w-5 h-5 ${color.split(' ')[0]}`} />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Action Bar */}
      <div className="card flex items-center gap-3 py-4">
        <label className={`btn-secondary cursor-pointer ${uploading ? 'opacity-50' : ''}`}>
          <Upload className="w-4 h-4" />
          {uploading ? '上传中...' : '上传扫描文件'}
          <input type="file" className="hidden" multiple
            accept=".jpg,.jpeg,.png,.tiff,.tif,.bmp,.pdf"
            onChange={handleUpload} disabled={uploading} />
        </label>
        {pendingScans > 0 && (
          <button onClick={handleProcessAll} disabled={processing} className="btn-primary">
            <Play className="w-4 h-4" />
            {processing ? '处理中...' : `批量处理 (${pendingScans} 个待处理)`}
          </button>
        )}
        <button onClick={() => navigate(`/results/${id}`)} className="btn-secondary ml-auto">
          <Users className="w-4 h-4" /> 查看成绩
        </button>
        <button onClick={() => reportsApi.downloadExcel(Number(id))} className="btn-secondary">
          <FileDown className="w-4 h-4" /> 导出Excel
        </button>
        <button onClick={() => navigate(`/reports?exam_id=${id}`)} className="btn-secondary">
          <BarChart2 className="w-4 h-4" /> 分析报告
        </button>
        <button onClick={() => setDebugOpen(true)} className="btn-secondary" title="区域调试视图">
          <Bug className="w-4 h-4" /> 调试区域
        </button>
      </div>

      {/* Tabs */}
      <div className="card p-0 overflow-hidden">
        <div className="flex border-b border-gray-100">
          {(['questions', 'scans'] as const).map(tab => (
            <button key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                  : 'text-gray-500 hover:text-gray-700'
              }`}>
              {tab === 'questions' ? `题目设置 (${exam.questions.length})` : `扫描文件 (${scans.length})`}
            </button>
          ))}
        </div>

        {activeTab === 'questions' && (
          <div>
            {exam.questions.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <p>尚未设置题目，请先编辑考试</p>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="table-header">题号</th>
                    <th className="table-header">题型</th>
                    <th className="table-header">分值</th>
                    <th className="table-header">标准答案</th>
                    <th className="table-header">评分标准</th>
                  </tr>
                </thead>
                <tbody>
                  {[...exam.questions].sort((a, b) => a.order_index - b.order_index).map(q => (
                    <tr key={q.id} className="border-b border-gray-50">
                      <td className="table-cell font-medium">第 {q.question_number} 题</td>
                      <td className="table-cell">
                        <span className="badge bg-gray-100 text-gray-600">
                          {Q_TYPE_LABEL[q.question_type] || q.question_type}
                        </span>
                      </td>
                      <td className="table-cell">{q.max_score} 分</td>
                      <td className="table-cell">
                        {q.sub_questions && q.sub_questions.length > 0 ? (
                          <div className="space-y-0.5 text-xs">
                            {q.sub_questions.map((sq, i) => (
                              <div key={i} className="text-gray-700">
                                <span className="font-medium text-gray-400 mr-1">{sq.label}</span>
                                {q.question_type === 'fill'
                                  ? (sq.blank_answers && sq.blank_answers.filter(Boolean).length > 0
                                      ? sq.blank_answers.map((a, bi) => (
                                          <span key={bi} className="font-mono mr-1 bg-gray-50 px-1 rounded">{a || '—'}</span>
                                        ))
                                      : <span className="text-gray-300">—</span>)
                                  : <span className="text-gray-500">{sq.standard_answer || <span className="text-gray-300">—</span>}</span>
                                }
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="font-mono text-sm">{q.standard_answer || '—'}</span>
                        )}
                      </td>
                      <td className="table-cell text-gray-500 text-sm max-w-xs">
                        {q.sub_questions && q.sub_questions.length > 0 ? (
                          <div className="space-y-0.5 text-xs">
                            {q.sub_questions.map((sq, i) => (
                              <div key={i} className="truncate">
                                <span className="font-medium text-gray-400 mr-1">{sq.label}</span>
                                <span>{sq.grading_criteria || <span className="text-gray-300">—</span>}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="truncate block">{q.grading_criteria || '—'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'scans' && (
          <div>
            {scans.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <ScanLine className="w-10 h-10 mx-auto mb-2 opacity-20" />
                <p>暂无扫描文件，请上传</p>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="table-header">文件名</th>
                    <th className="table-header">大小</th>
                    <th className="table-header">卷面编号</th>
                    <th className="table-header text-center">状态</th>
                    <th className="table-header">上传时间</th>
                    <th className="table-header">错误信息</th>
                  </tr>
                </thead>
                <tbody>
                  {scans.map(sf => {
                    const ss = SCAN_STATUS[sf.status] || { label: sf.status, color: 'bg-gray-100 text-gray-600' }
                    return (
                      <tr key={sf.id} className="border-b border-gray-50">
                        <td className="table-cell font-mono text-xs">{sf.file_name || sf.file_path.split('/').pop()}</td>
                        <td className="table-cell text-gray-500 text-xs">
                          {sf.file_size ? `${(sf.file_size / 1024).toFixed(1)} KB` : '—'}
                        </td>
                        <td className="table-cell text-sm">
                          {sf.detected_student_id ? (
                            <span className="font-mono">
                              {sf.detected_student_id}
                              {sf.detected_page_side && (
                                <span className={`ml-1.5 px-1.5 py-0.5 rounded text-xs font-bold ${
                                  sf.detected_page_side === 'A'
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'bg-orange-100 text-orange-700'
                                }`}>{sf.detected_page_side}面</span>
                              )}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="table-cell text-center">
                          <span className={`badge ${ss.color}`}>{ss.label}</span>
                        </td>
                        <td className="table-cell text-xs text-gray-400">
                          {new Date(sf.created_at).toLocaleString('zh-CN')}
                        </td>
                        <td className="table-cell text-xs text-red-500 max-w-xs truncate">
                          {sf.error_message || '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* 全屏调试视图 */}
      {debugOpen && exam && (
        <AnswerSheetDebugView
          questions={exam.questions.map((q, i): SheetQuestion => ({
            _key:            q.id,
            question_number: q.question_number,
            question_type:   q.question_type as SheetQuestion['question_type'],
            title:           q.title ?? '',
            max_score:       q.max_score,
            standard_answer: q.standard_answer ?? '',
            sub_questions:   q.sub_questions ?? [],
            answer_lines:    q.answer_lines ?? 8,
          }))}
          examName={exam.name}
          subject={exam.subject}
          examId={exam.id}
          onClose={() => setDebugOpen(false)}
        />
      )}
    </div>
  )
}
