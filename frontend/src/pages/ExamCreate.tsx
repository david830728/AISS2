import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus, Trash2, Save, ArrowLeft, GripVertical, ImagePlus, FileText, Wand2, Users, Upload, FileDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { examApi, studentsApi, Student, SubQuestion } from '../api'
import TemplateRegionMapper, { Region, RegionItem } from '../components/TemplateRegionMapper'
import AnswerSheetPreview, { RegionMap } from '../components/AnswerSheetPreview'

const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治', '综合']
const GRADES = ['高一', '高二', '高三', '初一', '初二', '初三']
const COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4','#84CC16','#F97316','#6366F1']
const TABS = ['基本信息', '题目设置', '答题卡']

interface QForm {
  _key: number
  title: string
  question_number: number
  question_type: 'choice' | 'fill' | 'subjective'
  max_score: number
  standard_answer: string
  answer_options: string[]
  grading_criteria: string
  order_index: number
  region?: Region
  sub_questions: SubQuestion[]
  answer_lines: number
  page: string
}

let _keyCounter = 0

const makeQ = (order: number, type: QForm['question_type'] = 'choice'): QForm => ({
  _key: ++_keyCounter,
  answer_lines: 8,
  title: '',
  question_number: order + 1,
  question_type: type,
  max_score: type === 'choice' ? 2 : type === 'fill' ? 4 : 10,
  standard_answer: '',
  answer_options: ['A', 'B', 'C', 'D'],
  grading_criteria: '',
  order_index: order,
  page: 'A',
  sub_questions:
    type === 'fill'
      ? [{ label: '(1)', max_score: 2, blank_count: 1, blank_answers: [''], standard_answer: '', grading_criteria: '' }]
      : type === 'subjective'
      ? [
          { label: '(1)', max_score: 5, blank_count: 0, blank_answers: [], standard_answer: '', grading_criteria: '' },
          { label: '(2)', max_score: 5, blank_count: 0, blank_answers: [], standard_answer: '', grading_criteria: '' },
        ]
      : [],
})

export default function ExamCreate() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const templateInputRef = useRef<HTMLInputElement>(null)

  const [tab, setTab] = useState(0)
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('语文')
  const [paperSize, setPaperSize] = useState('A4')
  const [grade, setGrade] = useState('')
  const [className, setClassName] = useState('')
  const [examDate, setExamDate] = useState('')
  const [totalScore, setTotalScore] = useState(100)
  const [description, setDescription] = useState('')
  const [questions, setQuestions] = useState<QForm[]>([])
  const [saving, setSaving] = useState(false)

  // answer-sheet tab
  const [sheetMode, setSheetMode] = useState<'generate' | 'import'>('generate')
  const [templateUrl, setTemplateUrl] = useState<string | null>(null)
  const [templateFile, setTemplateFile] = useState<File | null>(null)
  const [uploadingTemplate, setUploadingTemplate] = useState(false)

  // student info regions from answer sheet preview
  const [studentRegions, setStudentRegions] = useState<RegionMap>({})

  // student roster
  const [rosterMode, setRosterMode] = useState<'none' | 'upload' | 'temp'>('none')
  const [tempCount, setTempCount] = useState(30)
  const [rosterFile, setRosterFile] = useState<File | null>(null)
  const [rosterPreview, setRosterPreview] = useState<Student[]>([])
  const rosterInputRef = useRef<HTMLInputElement>(null)

  // batch add counts + titles
  const [batchChoice, setBatchChoice] = useState(5)
  const [batchFill, setBatchFill] = useState(3)
  const [batchSubj, setBatchSubj] = useState(2)
  const [batchTitles, setBatchTitles] = useState({ choice: '', fill: '', subjective: '' })

  useEffect(() => {
    if (isEdit && id) {
      studentsApi.list(Number(id)).then(students => {
        if (students.length > 0) {
          setRosterPreview(students)
          setRosterMode(students[0].is_temp ? 'temp' : 'upload')
        }
      })
      examApi.get(Number(id)).then(exam => {
        setName(exam.name)
        setSubject(exam.subject)
        setGrade(exam.grade || '')
        setClassName(exam.class_name || '')
        setExamDate(exam.exam_date ? exam.exam_date.slice(0, 10) : '')
        setTotalScore(exam.total_score)
        setDescription(exam.description || '')
        const tc = exam.template_config as Record<string, unknown> | undefined
        if (tc?.paper_size) setPaperSize(tc.paper_size as string)
        if (tc?.template_image) {
          setTemplateUrl(tc.template_image as string)
          setSheetMode('import')
        }
        // Restore student info regions so they survive re-save
        const restoredRegions: RegionMap = {}
        if (tc?.name_region)  restoredRegions.student_name  = tc.name_region  as RegionMap[string]
        if (tc?.class_region) restoredRegions.student_class = tc.class_region as RegionMap[string]
        if (tc?.id_region)    restoredRegions.student_id    = tc.id_region    as RegionMap[string]
        if (Object.keys(restoredRegions).length > 0) setStudentRegions(restoredRegions)
        if (exam.questions.length > 0) {
          setQuestions(exam.questions.map(q => ({
            _key: ++_keyCounter,
            title: q.title || '',
            question_number: q.question_number,
            question_type: q.question_type,
            max_score: q.max_score,
            standard_answer: q.standard_answer || '',
            answer_options: q.answer_options || ['A', 'B', 'C', 'D'],
            grading_criteria: q.grading_criteria || '',
            order_index: q.order_index,
            region: q.region,
            sub_questions: (q.sub_questions as SubQuestion[]) || [],
            answer_lines: q.answer_lines ?? 8,
            page: q.page || 'A',
          })))
        }
      })
    }
  }, [id, isEdit])

  // ── Helpers ────────────────────────────────────────────────────────────────

  const effectiveScore = (q: QForm) =>
    q.sub_questions.length > 0
      ? q.sub_questions.reduce((s, sq) => s + Number(sq.max_score || 0), 0)
      : q.max_score

  const calcTotal = () => questions.reduce((s, q) => s + effectiveScore(q), 0)

  const updateQ = (key: number, patch: Partial<QForm>) =>
    setQuestions(prev => prev.map(q => q._key === key ? { ...q, ...patch } : q))

  const removeQuestion = (key: number) =>
    setQuestions(prev =>
      prev.filter(q => q._key !== key).map((q, i) => ({ ...q, question_number: i + 1, order_index: i }))
    )

  const changeType = (key: number, type: QForm['question_type']) =>
    setQuestions(prev => prev.map(q => {
      if (q._key !== key) return q
      const t = makeQ(q.order_index, type)
      return { ...t, _key: q._key, title: q.title, question_number: q.question_number }
    }))

  const updateSubQ = (qKey: number, si: number, patch: Partial<SubQuestion>) =>
    setQuestions(prev => prev.map(q => {
      if (q._key !== qKey) return q
      const subs = [...q.sub_questions]
      subs[si] = { ...subs[si], ...patch }
      return { ...q, sub_questions: subs }
    }))

  const addSubQ = (qKey: number) =>
    setQuestions(prev => prev.map(q => {
      if (q._key !== qKey) return q
      const n = q.sub_questions.length + 1
      const sq: SubQuestion =
        q.question_type === 'fill'
          ? { label: `(${n})`, max_score: 2, blank_count: 1, blank_answers: [''], standard_answer: '', grading_criteria: '' }
          : { label: `(${n})`, max_score: 5, blank_count: 0, blank_answers: [], standard_answer: '', grading_criteria: '' }
      return { ...q, sub_questions: [...q.sub_questions, sq] }
    }))

  const removeSubQ = (qKey: number, si: number) =>
    setQuestions(prev => prev.map(q =>
      q._key !== qKey ? q : { ...q, sub_questions: q.sub_questions.filter((_, i) => i !== si) }
    ))

  const changeBlankCount = (qKey: number, si: number, count: number) =>
    setQuestions(prev => prev.map(q => {
      if (q._key !== qKey) return q
      const subs = [...q.sub_questions]
      const old = subs[si]
      subs[si] = { ...old, blank_count: count, blank_answers: Array.from({ length: count }, (_, i) => old.blank_answers?.[i] ?? '') }
      return { ...q, sub_questions: subs }
    }))

  const handleBatchAdd = () => {
    const items: Array<{ type: QForm['question_type']; title: string }> = [
      ...Array.from({ length: batchChoice }, () => ({ type: 'choice' as const, title: batchTitles.choice })),
      ...Array.from({ length: batchFill },   () => ({ type: 'fill' as const,   title: batchTitles.fill })),
      ...Array.from({ length: batchSubj },   () => ({ type: 'subjective' as const, title: batchTitles.subjective })),
    ]
    if (items.length === 0) return
    setQuestions(prev => {
      const start = prev.length
      return [...prev, ...items.map(({ type, title }, i) => ({ ...makeQ(start + i, type), title }))]
    })
  }

  // ── Template (import mode) ─────────────────────────────────────────────────

  const handleTemplateSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setTemplateUrl(URL.createObjectURL(file))
    setTemplateFile(file)
    if (isEdit && id) {
      setUploadingTemplate(true)
      try {
        const res = await examApi.uploadTemplate(Number(id), file)
        setTemplateUrl(res.template_url)
        setTemplateFile(null)
        toast.success('模板已上传')
      } catch (err: unknown) { toast.error((err as Error).message) }
      finally { setUploadingTemplate(false) }
    }
    e.target.value = ''
  }

  const buildRegionItems = (): RegionItem[] => {
    const items: RegionItem[] = []
    questions.forEach((q, qi) => {
      if (q.sub_questions.length > 0) {
        q.sub_questions.forEach((sq, si) => items.push({
          key: `sq_${q._key}_${si}`,
          label: `第${q.question_number}题 ${sq.label || `(${si + 1})`}`,
          region: sq.region, color: COLORS[(qi + si) % COLORS.length],
        }))
      } else {
        items.push({ key: `q_${q._key}`, label: `第${q.question_number}题`, region: q.region, color: COLORS[qi % COLORS.length] })
      }
    })
    return items
  }

  const handleRegionChange = (key: string, region: Region | undefined) => {
    if (key.startsWith('q_')) {
      updateQ(parseInt(key.slice(2)), { region })
    } else if (key.startsWith('sq_')) {
      const [, qKeyStr, siStr] = key.split('_')
      setQuestions(prev => prev.map(q => {
        if (q._key !== parseInt(qKeyStr)) return q
        const subs = [...q.sub_questions]
        subs[parseInt(siStr)] = { ...subs[parseInt(siStr)], region }
        return { ...q, sub_questions: subs }
      }))
    }
  }

  const handleRegionsComputed = (regions: RegionMap) => {
    // Extract student info regions
    const studentKeys = ['student_class', 'student_name', 'student_id']
    const studentR: RegionMap = {}
    Object.entries(regions).forEach(([key, val]) => {
      if (studentKeys.includes(key)) studentR[key] = val
    })
    if (Object.keys(studentR).length > 0) setStudentRegions(studentR)
    // choice_table: 只给第一道选择题保存整体 region，其余设为 null（避免重复截图）
    const choiceTableRegion = regions['choice_table']
    setQuestions(prev => {
      let firstChoiceSeen = false
      return prev.map(q => {
        if (q.question_type === 'choice') {
          const choicePage = regions['choice_table']?.page ?? q.page
          if (!firstChoiceSeen) {
            firstChoiceSeen = true
            return { ...q, page: choicePage, region: choiceTableRegion ?? q.region }
          }
          return { ...q, page: choicePage, region: undefined }
        }
        // 填空题：从子题计算包围盒作为主region
        if (q.question_type === 'fill' && q.sub_questions.length > 0) {
          const sqRegions = q.sub_questions
            .map((sq, si) => regions[`sq_${q._key}_${si}`])
            .filter((r): r is Region => r !== undefined)
          if (sqRegions.length > 0) {
            const minX = Math.min(...sqRegions.map(r => r.x))
            const minY = Math.min(...sqRegions.map(r => r.y))
            const maxX = Math.max(...sqRegions.map(r => r.x + r.width))
            const maxY = Math.max(...sqRegions.map(r => r.y + r.height))
            const mainRegion: Region = {
              x: minX,
              y: minY,
              width: maxX - minX,
              height: maxY - minY,
            }
            return {
              ...q,
              page: regions[`sq_${q._key}_0`]?.page ?? q.page,
              region: mainRegion,
              sub_questions: q.sub_questions.map((sq, si) => ({
                ...sq, region: regions[`sq_${q._key}_${si}`] ?? sq.region,
              })),
            }
          }
        }
        return {
          ...q,
          page: regions[`q_${q._key}`]?.page ?? q.page,
          region: regions[`q_${q._key}`] ?? q.region,
          sub_questions: q.sub_questions.map((sq, si) => ({
            ...sq, region: regions[`sq_${q._key}_${si}`] ?? sq.region,
          })),
        }
      })
    })
  }

  // ── Roster helpers ──────────────────────────────────────────────────────────

  const downloadCsvTemplate = () => {
    const csv = '学号,姓名,班级\n20230128,张三,九(1)班\n20230129,李四,九(1)班'
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = '考生名单模板.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const handleRosterFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setRosterFile(file)
    e.target.value = ''
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!name.trim()) { toast.error('请输入考试名称'); return }
    if (questions.length === 0) { toast.error('请至少添加一道题目'); return }
    setSaving(true)
    try {
      const qPayload = questions.map(q => ({
        question_number: q.question_number,
        question_type: q.question_type,
        max_score: effectiveScore(q),
        title: q.title || undefined,
        standard_answer: q.sub_questions.length > 0 ? '' : q.standard_answer,
        answer_options: q.question_type === 'choice' ? q.answer_options : undefined,
        grading_criteria: q.sub_questions.length > 0 ? '' : q.grading_criteria,
        order_index: q.order_index,
        region: q.region,
        sub_questions: q.sub_questions.length > 0 ? q.sub_questions : undefined,
        answer_lines: q.question_type === 'subjective' ? q.answer_lines : undefined,
        page: q.page ?? 'A',
      }))

      // Build template_config, preserving all parts (image URL + student regions)
      const templateConfig: Record<string, unknown> = {}
      // Preserve server-side template image (never overwrite with a blob URL)
      if (templateUrl && !templateUrl.startsWith('blob:')) {
        templateConfig.template_image = templateUrl
      }
      if (studentRegions.student_name)  templateConfig.name_region  = studentRegions.student_name
      if (studentRegions.student_class) templateConfig.class_region = studentRegions.student_class
      if (studentRegions.student_id)    templateConfig.id_region    = studentRegions.student_id
      templateConfig.paper_size = paperSize
      const finalTemplateConfig = Object.keys(templateConfig).length > 0 ? templateConfig : undefined

      if (isEdit && id) {
        await examApi.update(Number(id), { name, subject, grade, class_name: className,
          exam_date: examDate ? new Date(examDate).toISOString() : undefined,
          total_score: calcTotal() || totalScore, description,
          template_config: finalTemplateConfig })
        await examApi.batchSetQuestions(Number(id), qPayload)
        await _applyRoster(Number(id))
        toast.success('保存成功')
        navigate(`/exams/${id}`)
      } else {
        const exam = await examApi.create({ name, subject, grade, class_name: className,
          exam_date: examDate ? new Date(examDate).toISOString() : undefined,
          total_score: calcTotal() || totalScore, description, questions: qPayload,
          template_config: finalTemplateConfig })
        if (templateFile) {
          try { await examApi.uploadTemplate(exam.id, templateFile) }
          catch { toast.error('考试已创建，但模板上传失败，请在编辑页重新上传') }
        }
        toast.success('创建成功')
        // 处理考生名单
        await _applyRoster(exam.id)
        navigate(`/exams/${exam.id}/edit`)
      }
    } catch (err: unknown) { toast.error((err as Error).message) }
    finally { setSaving(false) }
  }

  const _applyRoster = async (examId: number) => {
    try {
      if (rosterMode === 'temp') {
        await studentsApi.generateTemp(examId, tempCount)
        await studentsApi.generatePdf(examId)
        toast.success(`已生成 ${tempCount} 个临时学号，答题卡PDF生成中...`)
      } else if (rosterMode === 'upload' && rosterFile) {
        const res = await studentsApi.import(examId, rosterFile)
        toast.success(`已导入 ${res.imported} 名考生${res.failed ? `，${res.failed} 条失败` : ''}`)
        await studentsApi.generatePdf(examId)
        toast.success('答题卡PDF生成中...')
        setRosterFile(null)
      }
    } catch (err: unknown) {
      toast.error('名单处理失败: ' + (err as Error).message)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="btn-secondary p-2"><ArrowLeft className="w-4 h-4" /></button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{isEdit ? '编辑考试' : '新建考试'}</h1>
          <p className="text-sm text-gray-500 mt-0.5">设置考试基本信息、题目与答题卡</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-5 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
              tab === i ? 'bg-white border border-b-white border-gray-200 text-blue-600 -mb-px' : 'text-gray-500 hover:text-gray-700'
            }`}>{t}</button>
        ))}
      </div>

      {/* ── Tab 0: Basic Info ─────────────────────────────────────────────── */}
      {tab === 0 && (
        <div className="card space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">考试名称 *</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="例：2024年春季期末语文考试" />
            </div>
            <div>
              <label className="label">科目 *</label>
              <select className="input" value={subject} onChange={e => setSubject(e.target.value)}>
                {SUBJECTS.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">满分（根据题目自动计算）</label>
              <input className="input bg-gray-50" type="number" readOnly value={calcTotal() || totalScore} />
            </div>
            <div>
              <label className="label">年级</label>
              <select className="input" value={grade} onChange={e => setGrade(e.target.value)}>
                <option value="">请选择</option>
                {GRADES.map(g => <option key={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="label">班级</label>
              <input className="input" value={className} onChange={e => setClassName(e.target.value)} placeholder="例：1班或全年级" />
            </div>
            <div>
              <label className="label">考试日期</label>
              <input className="input" type="date" value={examDate} onChange={e => setExamDate(e.target.value)} />
            </div>
            <div>
              <label className="label">备注</label>
              <input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="可选" />
            </div>
          </div>

          {/* ── 考生名单 ── */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-blue-500" />
              <span className="font-medium text-gray-800 text-sm">考生名单（可选）</span>
              <span className="text-xs text-gray-400">— 用于生成个人专属答题卡PDF</span>
            </div>
            <div className="flex gap-2 mb-3">
              {(['none', 'upload', 'temp'] as const).map(m => (
                <button key={m} onClick={() => setRosterMode(m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    rosterMode === m ? 'bg-blue-500 text-white border-blue-500' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>
                  {m === 'none' ? '暂不设置' : m === 'upload' ? '上传Excel名单' : '自动生成临时学号'}
                </button>
              ))}
            </div>

            {rosterMode === 'temp' && (
              <div className="flex items-center gap-3 bg-blue-50 rounded-lg px-4 py-3">
                <span className="text-sm text-gray-700">班级人数</span>
                <input type="number" min={1} max={999} value={tempCount}
                  onChange={e => setTempCount(Math.max(1, Number(e.target.value)))}
                  className="input text-sm w-20 py-1 text-center" />
                <span className="text-sm text-gray-700">人</span>
                <span className="text-xs text-gray-400">保存后自动生成格式为 日期+座号 的临时学号</span>
              </div>
            )}

            {rosterMode === 'upload' && (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <button onClick={downloadCsvTemplate}
                    className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded-lg px-3 py-1.5">
                    <FileDown className="w-3.5 h-3.5" /> 下载Excel模板
                  </button>
                  <button onClick={() => rosterInputRef.current?.click()}
                    className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg px-3 py-1.5">
                    <Upload className="w-3.5 h-3.5" /> {rosterFile ? rosterFile.name : '选择文件 .xlsx/.csv'}
                  </button>
                  <input ref={rosterInputRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={handleRosterFileChange} />
                </div>
                {rosterPreview.length > 0 && (
                  <div className="border border-gray-100 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>{['序号','学号','姓名','班级'].map(h => <th key={h} className="px-3 py-2 text-left text-gray-500 font-medium">{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {rosterPreview.slice(0, 5).map((s, i) => (
                          <tr key={i} className="border-t border-gray-100">
                            <td className="px-3 py-1.5 text-gray-400">{i+1}</td>
                            <td className="px-3 py-1.5">{s.student_number}</td>
                            <td className="px-3 py-1.5">{s.student_name || '—'}</td>
                            <td className="px-3 py-1.5">{s.class_name || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rosterPreview.length > 5 && (
                      <p className="text-xs text-gray-400 px-3 py-1.5 border-t border-gray-100">共 {rosterPreview.length} 人</p>
                    )}
                  </div>
                )}
                {isEdit && !rosterFile && rosterPreview.length > 0 && (
                  <p className="text-xs text-blue-600">✓ 数据库中已有 {rosterPreview.length} 名考生名单</p>
                )}
                {rosterFile && <p className="text-xs text-green-600">✓ 已选择 {rosterFile.name}，保存后自动导入（将覆盖现有名单）</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab 1: Questions ──────────────────────────────────────────────── */}
      {tab === 1 && (
        <div className="space-y-4">
          {/* Batch add panel */}
          <div className="card bg-blue-50/60 border border-blue-100 space-y-3">
            <p className="text-sm font-semibold text-blue-800">快速批量添加题目</p>
            <div className="grid gap-2">
              {([
                { key: 'choice',     label: '选择题', count: batchChoice, setCount: setBatchChoice, ph: '单选题' },
                { key: 'fill',       label: '填空题', count: batchFill,   setCount: setBatchFill,   ph: '诗文默写' },
                { key: 'subjective', label: '主观题', count: batchSubj,   setCount: setBatchSubj,   ph: '阅读理解' },
              ] as const).map(({ key, label, count, setCount, ph }) => (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-sm font-medium w-14 text-right text-gray-700 flex-shrink-0">{label}</span>
                  <input type="number" min={0} max={30} value={count}
                    onChange={e => (setCount as (n: number) => void)(Math.max(0, Number(e.target.value)))}
                    className="input text-sm w-16 py-1 text-center flex-shrink-0" />
                  <span className="text-xs text-gray-400 flex-shrink-0">题</span>
                  <input
                    value={batchTitles[key]}
                    onChange={e => setBatchTitles(p => ({ ...p, [key]: e.target.value }))}
                    className="input text-sm py-1 flex-1"
                    placeholder={`大题标题（如：${ph}）`} />
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <button onClick={handleBatchAdd} className="btn-primary text-sm">
                <Plus className="w-4 h-4" />
                一键添加 {batchChoice + batchFill + batchSubj} 题
              </button>
            </div>
          </div>

          {/* Question list */}
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">题目列表</h2>
                <p className="text-xs text-gray-400 mt-0.5">共 {questions.length} 题，合计 {calcTotal()} 分</p>
              </div>
              <button onClick={() => setQuestions(prev => [...prev, makeQ(prev.length, 'choice')])} className="btn-secondary text-sm">
                <Plus className="w-4 h-4" /> 单独添加
              </button>
            </div>

            {questions.length === 0 && (
              <div className="text-center py-10 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
                使用上方「快速批量添加」或「单独添加」按钮添加题目
              </div>
            )}

            <div className="space-y-3">
              {questions.map((q, idx) => (
                <div key={q._key} className="border border-gray-200 rounded-xl bg-white shadow-sm overflow-hidden">
                  {/* Card header */}
                  <div className={`flex items-center gap-3 px-4 py-2.5 border-b ${
                    q.question_type === 'choice' ? 'bg-blue-50/60 border-blue-100'
                    : q.question_type === 'fill' ? 'bg-green-50/60 border-green-100'
                    : 'bg-purple-50/60 border-purple-100'
                  }`}>
                    <GripVertical className="w-4 h-4 text-gray-300 cursor-grab flex-shrink-0" />
                    <span className="font-semibold text-sm text-gray-700 min-w-[52px]">第 {idx + 1} 题</span>
                    <select
                      value={q.question_type}
                      onChange={e => changeType(q._key, e.target.value as QForm['question_type'])}
                      className="input text-xs py-1 w-24 flex-shrink-0"
                    >
                      <option value="choice">选择题</option>
                      <option value="fill">填空题</option>
                      <option value="subjective">主观题</option>
                    </select>
                    <span className="flex-1 min-w-0 text-sm text-gray-600 truncate">{q.title || <span className="text-gray-300">（未设标题）</span>}</span>
                    <button onClick={() => removeQuestion(q._key)} className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg flex-shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Card body */}
                  <div className="p-4 space-y-3">

                    {/* Title row (editable) */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 flex-shrink-0">大题标题</span>
                      <input value={q.title}
                        onChange={e => updateQ(q._key, { title: e.target.value })}
                        className="input text-sm py-1 flex-1"
                        placeholder="大题标题（如：诗文默写）" />
                    </div>

                    {/* ── CHOICE ── */}
                    {q.question_type === 'choice' && (
                      <div className="flex items-center gap-6 flex-wrap">
                        <label className="flex items-center gap-2 text-sm text-gray-600">
                          分值
                          <input type="number" min={0} value={q.max_score}
                            onChange={e => updateQ(q._key, { max_score: Number(e.target.value) })}
                            className="input text-sm py-1 w-16 text-center" />
                        </label>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-600">标准答案</span>
                          <div className="flex gap-1.5">
                            {['A', 'B', 'C', 'D'].map(opt => (
                              <button key={opt} onClick={() => updateQ(q._key, { standard_answer: opt })}
                                className={`w-9 h-9 rounded-full text-sm font-bold border-2 transition-all ${
                                  q.standard_answer === opt
                                    ? 'bg-blue-500 border-blue-500 text-white shadow-sm'
                                    : 'border-gray-300 text-gray-500 hover:border-blue-300 hover:text-blue-400'
                                }`}>
                                {opt}
                              </button>
                            ))}
                          </div>
                          {q.standard_answer && (
                            <span className="text-xs text-gray-400 ml-1">已选 {q.standard_answer}</span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* ── FILL ── */}
                    {q.question_type === 'fill' && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500 font-medium">
                            小题列表（合计 {effectiveScore(q)} 分）
                          </span>
                          <button onClick={() => addSubQ(q._key)} className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1">
                            <Plus className="w-3.5 h-3.5" /> 添加小题
                          </button>
                        </div>
                        {q.sub_questions.map((sq, si) => (
                          <div key={si} className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <input value={sq.label}
                                onChange={e => updateSubQ(q._key, si, { label: e.target.value })}
                                className="input text-xs py-1 w-14 text-center font-medium" placeholder="(1)" />
                              <span className="text-xs text-gray-400">分值</span>
                              <input type="number" min={0} value={sq.max_score}
                                onChange={e => updateSubQ(q._key, si, { max_score: Number(e.target.value) })}
                                className="input text-xs py-1 w-14 text-center" />
                              <span className="text-xs text-gray-400 ml-1">空格数</span>
                              <input type="number" min={1} max={8} value={sq.blank_count ?? 1}
                                onChange={e => changeBlankCount(q._key, si, Math.max(1, Number(e.target.value)))}
                                className="input text-xs py-1 w-14 text-center" />
                              <span className="text-xs text-gray-400 ml-1">标准答案</span>
                              {Array.from({ length: sq.blank_count ?? 1 }).map((_, bi) => (
                                <input key={bi} value={sq.blank_answers?.[bi] ?? ''}
                                  onChange={e => {
                                    const ans = [...(sq.blank_answers ?? [])]
                                    ans[bi] = e.target.value
                                    updateSubQ(q._key, si, { blank_answers: ans })
                                  }}
                                  className="input text-xs py-1 w-24"
                                  placeholder={`空${bi + 1}答案`} />
                              ))}
                              <button onClick={() => removeSubQ(q._key, si)}
                                className="ml-auto p-1 text-red-400 hover:text-red-600 flex-shrink-0">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <input value={sq.grading_criteria ?? ''}
                              onChange={e => updateSubQ(q._key, si, { grading_criteria: e.target.value })}
                              className="input text-xs py-1 w-full"
                              placeholder="评分标准（如：答出关键词得满分，部分正确酌情给分）" />
                          </div>
                        ))}
                      </div>
                    )}

                    {/* ── SUBJECTIVE ── */}
                    {q.question_type === 'subjective' && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500 font-medium">
                            小题列表（合计 {effectiveScore(q)} 分）
                          </span>
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-1.5 text-xs text-gray-500">
                              答题行数
                              <input
                                type="number" min={2} max={30}
                                value={q.answer_lines}
                                onChange={e => updateQ(q._key, { answer_lines: Math.min(30, Math.max(2, Number(e.target.value))) })}
                                className="input text-xs py-0.5 w-14 text-center"
                              />
                              行
                            </label>
                            <button onClick={() => addSubQ(q._key)} className="text-xs text-purple-500 hover:text-purple-700 flex items-center gap-1">
                              <Plus className="w-3.5 h-3.5" /> 添加小题
                            </button>
                          </div>
                        </div>
                        {q.sub_questions.map((sq, si) => (
                          <div key={si} className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100 space-y-1.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <input value={sq.label}
                                onChange={e => updateSubQ(q._key, si, { label: e.target.value })}
                                className="input text-xs py-1 w-14 text-center font-medium" placeholder="(1)" />
                              <span className="text-xs text-gray-400">分值</span>
                              <input type="number" min={0} value={sq.max_score}
                                onChange={e => updateSubQ(q._key, si, { max_score: Number(e.target.value) })}
                                className="input text-xs py-1 w-16 text-center" />
                              <button onClick={() => removeSubQ(q._key, si)}
                                className="ml-auto p-1 text-red-400 hover:text-red-600">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <textarea value={sq.standard_answer ?? ''}
                              onChange={e => updateSubQ(q._key, si, { standard_answer: e.target.value })}
                              rows={2}
                              className="input text-xs resize-none w-full"
                              placeholder="参考答案（可多行）" />
                            <textarea value={sq.grading_criteria ?? ''}
                              onChange={e => updateSubQ(q._key, si, { grading_criteria: e.target.value })}
                              rows={2}
                              className="input text-xs resize-none w-full"
                              placeholder="评分标准（AI评分依据，如：第一点2分，第二点3分）" />
                          </div>
                        ))}
                      </div>
                    )}

                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab 2: Answer Sheet ───────────────────────────────────────────── */}
      {tab === 2 && (
        <div className="card space-y-4">
          {/* Mode toggle */}
          <div className="flex gap-2">
            <button onClick={() => setSheetMode('generate')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                sheetMode === 'generate' ? 'bg-blue-500 text-white border-blue-500' : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}>
              <Wand2 className="w-4 h-4" /> 在线自制答题卡
            </button>
            <button onClick={() => setSheetMode('import')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                sheetMode === 'import' ? 'bg-blue-500 text-white border-blue-500' : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}>
              <FileText className="w-4 h-4" /> 导入现有模板
            </button>
          </div>

          {/* ── Generate mode ── */}
          {sheetMode === 'generate' && (
            <AnswerSheetPreview
              questions={questions}
              examName={name}
              subject={subject}
              examId={id ? Number(id) : undefined}
              initialSize={paperSize}
              onSizeChange={setPaperSize}
              onRegionsComputed={handleRegionsComputed}
            />
          )}

          {/* ── Import mode ── */}
          {sheetMode === 'import' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500">上传已有答题卡图片，在图片上手动框选各题答题区域</p>
                <div className="flex items-center gap-2">
                  {uploadingTemplate && <span className="text-xs text-blue-500 animate-pulse">上传中...</span>}
                  <button onClick={() => templateInputRef.current?.click()} disabled={uploadingTemplate} className="btn-secondary text-sm">
                    <ImagePlus className="w-4 h-4" /> {templateUrl ? '更换图片' : '上传答题卡图片'}
                  </button>
                  <input ref={templateInputRef} type="file" accept=".jpg,.jpeg,.png" className="hidden" onChange={handleTemplateSelect} />
                </div>
              </div>
              {!isEdit && templateFile && (
                <div className="bg-blue-50 text-blue-700 text-xs rounded-lg px-3 py-2">
                  图片已就绪，将在保存考试后自动上传。
                </div>
              )}
              {!templateUrl ? (
                <div
                  className="border-2 border-dashed border-gray-200 rounded-xl py-16 flex flex-col items-center gap-3 text-gray-400 cursor-pointer hover:border-blue-300 hover:text-blue-400 transition-colors"
                  onClick={() => templateInputRef.current?.click()}
                >
                  <ImagePlus className="w-10 h-10" />
                  <p className="text-sm">点击上传答题卡模板图片（JPG / PNG）</p>
                </div>
              ) : questions.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">请先在「题目设置」中添加题目，再进行区域划定</p>
              ) : (
                <TemplateRegionMapper templateUrl={templateUrl} items={buildRegionItems()} onRegionChange={handleRegionChange} />
              )}
            </div>
          )}
        </div>
      )}

      {/* Bottom actions */}
      <div className="flex justify-between items-center">
        <div className="flex gap-2">
          {tab > 0 && <button onClick={() => setTab(t => t - 1)} className="btn-secondary text-sm">← 上一步</button>}
          {tab < TABS.length - 1 && <button onClick={() => setTab(t => t + 1)} className="btn-secondary text-sm">下一步 →</button>}
        </div>
        <div className="flex gap-3">
          <button onClick={() => navigate(-1)} className="btn-secondary">取消</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            <Save className="w-4 h-4" />
            {saving ? '保存中...' : (isEdit ? '保存修改' : '创建考试')}
          </button>
        </div>
      </div>
    </div>
  )
}
