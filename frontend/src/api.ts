import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
      return Promise.reject(err)
    }
    const msg = err.response?.data?.detail || err.message || '请求失败'
    return Promise.reject(new Error(msg))
  }
)

export default api

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SubQuestion {
  label: string
  max_score: number
  blank_count?: number
  blank_answers?: string[]
  standard_answer?: string
  grading_criteria?: string
  region?: { x: number; y: number; width: number; height: number }
}

export interface Question {
  id: number
  exam_id: number
  question_number: number
  question_type: 'choice' | 'fill' | 'subjective'
  max_score: number
  title?: string
  standard_answer?: string
  answer_options?: string[]
  region?: { x: number; y: number; width: number; height: number }
  grading_criteria?: string
  order_index: number
  sub_questions?: SubQuestion[]
  answer_lines?: number
  page?: string
}

export interface Exam {
  id: number
  name: string
  subject: string
  grade?: string
  class_name?: string
  exam_date?: string
  total_score: number
  status: 'draft' | 'active' | 'completed' | 'archived'
  description?: string
  scan_dir?: string
  template_config?: Record<string, unknown>
  created_at: string
  questions: Question[]
}

export interface ExamSummary {
  id: number
  name: string
  subject: string
  grade?: string
  class_name?: string
  exam_date?: string
  total_score: number
  status: string
  created_at: string
  question_count: number
  student_count: number
  graded_count: number
}

export interface ScanFile {
  id: number
  exam_id?: number
  file_path: string
  file_name?: string
  file_size?: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  error_message?: string
  page_count: number
  detected_student_id?: string
  detected_student_name?: string
  detected_page_side?: string
  created_at: string
  processed_at?: string
}

export interface StudentAnswer {
  id: number
  question_id: number
  question_number: number
  question_type: string
  max_score: number
  recognized_answer?: string
  standard_answer?: string
  score?: number
  ai_feedback?: string
  is_correct?: boolean
  grading_status: string
  answer_image_path?: string
  recognized_text?: string
}

export interface StudentExamSummary {
  id: number
  student_name?: string
  student_number?: string
  class_name?: string
  total_score?: number
  grading_status: string
  created_at: string
}

export interface StudentExamDetail extends StudentExamSummary {
  exam_id: number
  answers: StudentAnswer[]
}

export interface ExamStats {
  exam_id: number
  exam_name: string
  total_students: number
  graded_students: number
  average_score?: number
  max_score?: number
  min_score?: number
  pass_rate?: number
  excellent_rate?: number
  score_distribution: { label: string; range: string; count: number }[]
  question_stats: {
    question_number: number
    question_type: string
    max_score: number
    average_score: number
    accuracy_rate?: number
    average_rate: number
    answer_count: number
  }[]
}

export interface DashboardData {
  total_exams: number
  active_exams: number
  total_papers: number
  pending_grading: number
  completed_grading: number
  pending_scans: number
  recent_exams: { id: number; name: string; subject: string; status: string; created_at: string }[]
}

// ── Exam API ──────────────────────────────────────────────────────────────────

export const examApi = {
  list: () => api.get<ExamSummary[]>('/exams/').then((r) => r.data),
  get: (id: number) => api.get<Exam>(`/exams/${id}`).then((r) => r.data),
  create: (data: Omit<Partial<Exam>, 'questions'> & { questions?: Partial<Question>[] }) =>
    api.post<Exam>('/exams/', data).then((r) => r.data),
  update: (id: number, data: Omit<Partial<Exam>, 'questions'>) =>
    api.put<Exam>(`/exams/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/exams/${id}`),
  getStats: (id: number) => api.get<ExamStats>(`/exams/${id}/stats`).then((r) => r.data),
  batchSetQuestions: (examId: number, questions: Partial<Question>[]) =>
    api.post<Question[]>(`/exams/${examId}/questions/batch`, questions).then((r) => r.data),
  addQuestion: (examId: number, q: Partial<Question>) =>
    api.post<Question>(`/exams/${examId}/questions`, q).then((r) => r.data),
  updateQuestion: (examId: number, qId: number, q: Partial<Question>) =>
    api.put<Question>(`/exams/${examId}/questions/${qId}`, q).then((r) => r.data),
  deleteQuestion: (examId: number, qId: number) =>
    api.delete(`/exams/${examId}/questions/${qId}`),
  uploadTemplate: (examId: number, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<{ template_url: string }>(`/exams/${examId}/template`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data)
  },
}

// ── Scan API ──────────────────────────────────────────────────────────────────

export const scanApi = {
  list: (examId?: number) =>
    api.get<ScanFile[]>('/scans/', { params: examId ? { exam_id: examId } : {} }).then((r) => r.data),
  upload: (examId: number, files: File[]) => {
    const form = new FormData()
    form.append('exam_id', String(examId))
    files.forEach((f) => form.append('files', f))
    return api.post<ScanFile[]>('/scans/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data)
  },
  processBatch: (examId: number, scanFileIds?: number[]) =>
    api.post<{ success: number; failed: number; total: number }>('/scans/process-batch', {
      exam_id: examId,
      scan_file_ids: scanFileIds,
    }).then((r) => r.data),
  delete: (id: number) => api.delete(`/scans/${id}`),
  monitorStatus: () => api.get<Record<string, unknown>>('/scans/monitor/status').then((r) => r.data),
  startMonitor: (scanDir: string, examId: number) =>
    api.post('/scans/monitor/start', null, { params: { scan_dir: scanDir, exam_id: examId } }),
  stopMonitor: () => api.post('/scans/monitor/stop'),
  fsList: (path?: string) =>
    api.get<{ current: string; parent: string | null; dirs: { name: string; path: string }[] }>(
      '/scans/fs/list', { params: path ? { path } : {} }
    ).then(r => r.data),
}

// ── Results API ───────────────────────────────────────────────────────────────

export const resultsApi = {
  listByExam: (examId: number) =>
    api.get<StudentExamSummary[]>(`/results/exam/${examId}`).then((r) => r.data),
  getDetail: (id: number) =>
    api.get<StudentExamDetail>(`/results/student-exam/${id}`).then((r) => r.data),
  updateScore: (answerId: number, score: number, feedback?: string) =>
    api.put(`/results/answer/${answerId}`, { score, feedback }).then((r) => r.data),
  aiGrade: (studentExamId: number, questionId: number) =>
    api.post(`/results/ai-grade/${studentExamId}/${questionId}`).then((r) => r.data),
  delete: (examId: number, studentExamId: number) =>
    api.delete(`/results/exam/${examId}/student/${studentExamId}`),
  mergeSheets: (examId: number) =>
    api.post<{ merged: number }>(`/results/merge-sheets/${examId}`).then((r) => r.data),
  aiGradeAll: (studentExamId: number) =>
    api.post<{ graded: number; total_score: number }>(`/results/ai-grade-all/${studentExamId}`).then((r) => r.data),
  updateStudentInfo: (studentExamId: number, data: { student_name?: string; student_number?: string; class_name?: string }) =>
    api.patch(`/results/student-exam/${studentExamId}/info`, data).then((r) => r.data),
  aiGradeAllExam: (examId: number) =>
    api.post<{ task_id: string; status: string }>(`/results/exam/${examId}/ai-grade-all`).then((r) => r.data),
  aiGradeAllExamStatus: (examId: number) =>
    api.get<{ status: string; graded: number; total: number; failed: number }>(`/results/exam/${examId}/ai-grade-all/status`).then((r) => r.data),
}

// ── Reports API ───────────────────────────────────────────────────────────────

export const reportsApi = {
  getSummary: (examId: number) =>
    api.get(`/reports/exam/${examId}/summary`).then((r) => r.data),
  getClassAnalysis: (examId: number) =>
    api.get(`/reports/exam/${examId}/class-analysis`).then((r) => r.data),
  downloadExcel: (examId: number) => {
    window.open(`/api/reports/exam/${examId}/excel`, '_blank')
  },
}

// ── Settings API ──────────────────────────────────────────────────────────────

export const settingsApi = {
  getAI: () => api.get('/settings/ai').then((r) => r.data),
  updateAI: (data: Record<string, unknown>) =>
    api.put('/settings/ai', data).then((r) => r.data),
  testAI: () => api.post('/settings/ai/test').then((r) => r.data),
}

export const dashboardApi = {
  get: () => api.get<DashboardData>('/dashboard').then((r) => r.data),
}

// ── Students API ───────────────────────────────────────────────────────────────

export interface Student {
  id: number
  exam_id: number
  student_number: string
  student_name?: string
  class_name?: string
  seat_number?: number
  is_temp: boolean
  created_at: string
}

export interface StudentImportResult {
  imported: number
  failed: number
  errors: string[]
}

export interface AnswerSheetStatus {
  student_count: number
  has_pdf: boolean
  pdf_path?: string
}

export const studentsApi = {
  list: (examId: number) =>
    api.get<Student[]>(`/exams/${examId}/students`).then((r) => r.data),

  generateTemp: (examId: number, count: number) =>
    api.post<Student[]>(`/exams/${examId}/students/generate-temp`, { count }).then((r) => r.data),

  import: (examId: number, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<StudentImportResult>(`/exams/${examId}/students/import`, fd).then((r) => r.data)
  },

  delete: (examId: number) =>
    api.delete(`/exams/${examId}/students`).then((r) => r.data),

  generatePdf: (examId: number, layout = 'by_student') =>
    api.post<{ status: string; student_count: number }>(
      `/exams/${examId}/students/generate-pdf`, null, { params: { layout } }
    ).then((r) => r.data),

  sheetStatus: (examId: number) =>
    api.get<AnswerSheetStatus>(`/exams/${examId}/answer-sheet/status`).then((r) => r.data),

  downloadUrl: (examId: number) => `/api/exams/${examId}/answer-sheet/download`,
}
