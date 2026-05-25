import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Bot, User, Save, CheckCircle, XCircle, Zap, Loader2, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import { resultsApi, StudentExamDetail, StudentAnswer } from '../api'

const Q_TYPE_LABEL: Record<string, string> = { choice: '选择题', fill: '填空题', subjective: '主观题' }

export default function ResultDetail() {
  const { examId, studentExamId } = useParams()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<StudentExamDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [editScores, setEditScores] = useState<Record<number, string>>({})
  const [aiLoading, setAiLoading] = useState<Record<number, boolean>>({})
  const [saving, setSaving] = useState<Record<number, boolean>>({})
  const [gradeAllLoading, setGradeAllLoading] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')

  useEffect(() => {
    if (!studentExamId) return
    resultsApi.getDetail(Number(studentExamId))
      .then(setDetail)
      .finally(() => setLoading(false))
  }, [studentExamId])

  const handleSaveScore = async (ans: StudentAnswer) => {
    const newScore = parseFloat(editScores[ans.id] ?? String(ans.score ?? 0))
    if (isNaN(newScore) || newScore < 0 || newScore > ans.max_score) {
      toast.error(`分数需在 0 ~ ${ans.max_score} 之间`)
      return
    }
    setSaving(prev => ({ ...prev, [ans.id]: true }))
    try {
      const r = await resultsApi.updateScore(ans.id, newScore)
      toast.success('保存成功')
      setDetail(prev => {
        if (!prev) return prev
        return {
          ...prev,
          total_score: r.new_total,
          answers: prev.answers.map(a =>
            a.id === ans.id ? { ...a, score: newScore, grading_status: 'manual_graded' } : a
          ),
        }
      })
      setEditScores(prev => { const n = { ...prev }; delete n[ans.id]; return n })
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setSaving(prev => ({ ...prev, [ans.id]: false }))
    }
  }

  const handleSaveName = async () => {
    if (!studentExamId || !nameInput.trim()) return
    try {
      await resultsApi.updateStudentInfo(Number(studentExamId), { student_name: nameInput.trim() })
      setDetail(prev => prev ? { ...prev, student_name: nameInput.trim() } : prev)
      setEditingName(false)
      toast.success('姓名已更新')
    } catch (err: unknown) {
      toast.error((err as Error).message)
    }
  }

  const handleAIGradeAll = async () => {
    if (!studentExamId) return
    setGradeAllLoading(true)
    try {
      const r = await resultsApi.aiGradeAll(Number(studentExamId))
      toast.success(`AI批改完成：共批改填空/主观 ${r.graded} 道题，总分 ${r.total_score?.toFixed(1)} 分`)
      const fresh = await resultsApi.getDetail(Number(studentExamId))
      setDetail(fresh)
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setGradeAllLoading(false)
    }
  }

  const handleAIGrade = async (ans: StudentAnswer) => {
    if (!studentExamId) return
    setAiLoading(prev => ({ ...prev, [ans.id]: true }))
    try {
      const r = await resultsApi.aiGrade(Number(studentExamId), ans.question_id)
      toast.success(`AI评分完成：${r.score} 分`)
      setDetail(prev => {
        if (!prev) return prev
        return {
          ...prev,
          total_score: (prev.total_score || 0) - (ans.score || 0) + r.score,
          answers: prev.answers.map(a =>
            a.id === ans.id ? {
              ...a,
              score: r.score,
              ai_feedback: r.feedback,
              grading_status: 'ai_graded',
              recognized_answer: r.recognized_text || a.recognized_answer,
            } : a
          ),
        }
      })
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setAiLoading(prev => ({ ...prev, [ans.id]: false }))
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
    </div>
  )
  if (!detail) return <div className="p-8 text-gray-500">记录不存在</div>

  return (
    <div className="p-8 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/results/${examId}`)} className="btn-secondary p-2">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {editingName ? (
              <>
                <input
                  className="input text-xl font-bold py-0.5 px-2 w-40"
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false) }}
                  autoFocus
                />
                <button onClick={handleSaveName} className="text-xs px-2 py-1 bg-blue-500 text-white rounded">确定</button>
                <button onClick={() => setEditingName(false)} className="text-xs px-2 py-1 bg-gray-200 rounded">取消</button>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold text-gray-900">
                  {detail.student_name || '未知学生'}
                </h1>
                <button onClick={() => { setNameInput(detail.student_name || ''); setEditingName(true) }}
                  className="text-gray-400 hover:text-gray-600" title="编辑姓名">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            <span className="text-lg text-gray-500">的答卷详情</span>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            学号：{detail.student_number || '—'} ·
            班级：{detail.class_name || '—'} ·
            总分：<span className="font-semibold text-blue-600">{detail.total_score?.toFixed(1) ?? '—'}</span>
          </p>
        </div>
        <button
          onClick={handleAIGradeAll}
          disabled={gradeAllLoading}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors text-sm font-medium">
          {gradeAllLoading
            ? <><Loader2 className="w-4 h-4 animate-spin" /> AI批改中...</>
            : <><Zap className="w-4 h-4" /> 一键AI批改（填空+主观）</>}
        </button>
      </div>

      <div className="space-y-4">
        {detail.answers.map(ans => {
          const isChoiceCorrect = ans.question_type === 'choice' && ans.is_correct !== undefined
          const currentScore = editScores[ans.id] !== undefined
            ? editScores[ans.id]
            : String(ans.score ?? '')

          return (
            <div key={ans.id} className="card space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-gray-700">第 {ans.question_number} 题</span>
                  <span className="badge bg-gray-100 text-gray-600 text-xs">
                    {Q_TYPE_LABEL[ans.question_type] || ans.question_type}
                  </span>
                  {isChoiceCorrect && (
                    ans.is_correct
                      ? <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
                          <CheckCircle className="w-3.5 h-3.5" /> 正确
                        </span>
                      : <span className="flex items-center gap-1 text-red-500 text-xs font-medium">
                          <XCircle className="w-3.5 h-3.5" /> 错误
                        </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">满分 {ans.max_score}</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number" min={0} max={ans.max_score} step={0.5}
                      className="w-16 text-center border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={currentScore}
                      onChange={e => setEditScores(prev => ({ ...prev, [ans.id]: e.target.value }))}
                    />
                    <span className="text-xs text-gray-400">分</span>
                    {editScores[ans.id] !== undefined && (
                      <button onClick={() => handleSaveScore(ans)}
                        disabled={saving[ans.id]}
                        className="btn-primary text-xs py-1 px-2">
                        <Save className="w-3 h-3" />
                        {saving[ans.id] ? '...' : '保存'}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Answer Comparison */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-xs font-medium text-blue-600 mb-1">学生答案</p>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap min-h-[2rem]">
                    {ans.recognized_answer || <span className="text-gray-400 italic">（未识别到答案）</span>}
                  </p>
                </div>
                <div className="bg-green-50 rounded-lg p-3">
                  <p className="text-xs font-medium text-green-600 mb-1">参考答案</p>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap min-h-[2rem]">
                    {ans.standard_answer || <span className="text-gray-400 italic">—</span>}
                  </p>
                </div>
              </div>

              {/* Answer Image */}
              {ans.answer_image_path && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">答题区域图像</p>
                  <img
                    src={`/answer_images/${ans.answer_image_path.split('answer_images/')[1] || ans.answer_image_path}`}
                    alt={`第${ans.question_number}题`}
                    className="max-h-40 rounded-lg border border-gray-100 object-contain bg-gray-50"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                </div>
              )}

              {/* AI Feedback */}
              {ans.ai_feedback && (
                <div className="bg-purple-50 border border-purple-100 rounded-lg p-3 flex gap-2">
                  <Bot className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-purple-600 mb-0.5">AI评分反馈</p>
                    <p className="text-sm text-gray-700">{ans.ai_feedback}</p>
                  </div>
                </div>
              )}

              {/* AI Grade button for subjective / fill */}
              {(ans.question_type === 'subjective' || ans.question_type === 'fill') && (
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => handleAIGrade(ans)}
                    disabled={aiLoading[ans.id]}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors">
                    <Bot className="w-3.5 h-3.5" />
                    {aiLoading[ans.id] ? 'AI评分中...' : 'AI自动评分'}
                  </button>
                  <button
                    onClick={() => handleSaveScore(ans)}
                    disabled={saving[ans.id]}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors">
                    <User className="w-3.5 h-3.5" />
                    {saving[ans.id] ? '保存中...' : '人工评分'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
