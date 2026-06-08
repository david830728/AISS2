import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ScanLine, Play, Trash2, RefreshCw, FolderOpen, Radio } from 'lucide-react'
import toast from 'react-hot-toast'
import { scanApi, examApi, ScanFile, ExamSummary } from '../api'

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  pending:    { label: '待处理', color: 'bg-yellow-100 text-yellow-700' },
  processing: { label: '处理中', color: 'bg-blue-100 text-blue-700' },
  completed:  { label: '已完成', color: 'bg-green-100 text-green-700' },
  failed:     { label: '失败',   color: 'bg-red-100 text-red-700' },
}

export default function ScanMonitor() {
  const [scans, setScans] = useState<ScanFile[]>([])
  const [exams, setExams] = useState<ExamSummary[]>([])
  const [filterExam, setFilterExam] = useState<number | ''>('')
  const [filterStatus, setFilterStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [monitorStatus, setMonitorStatus] = useState<Record<string, unknown>>({})
  const [monitorDir, setMonitorDir] = useState('')
  const [monitorExamId, setMonitorExamId] = useState<number | ''>('')
  const navigate = useNavigate()

  // ── 文件夹选择器状态 ──────────────────────────────────────────────────────────
  const [pickerOpen,   setPickerOpen]   = useState(false)
  const [pickerPath,   setPickerPath]   = useState('')
  const [pickerDirs,   setPickerDirs]   = useState<{ name: string; path: string }[]>([])
  const [pickerParent, setPickerParent] = useState<string | null>(null)
  const [pickerLoading, setPickerLoading] = useState(false)

  const browseDir = async (path?: string) => {
    setPickerLoading(true)
    try {
      const res = await scanApi.fsList(path)
      setPickerPath(res.current)
      setPickerDirs(res.dirs)
      setPickerParent(res.parent)
    } catch {
      toast.error('无法访问该目录')
    } finally {
      setPickerLoading(false)
    }
  }

  const handleOpenPicker = () => {
    setPickerOpen(true)
    browseDir(monitorDir || undefined)
  }

  const handleConfirmDir = () => {
    setMonitorDir(pickerPath)
    setPickerOpen(false)
  }

  const load = async () => {
    setLoading(true)
    try {
      const [s, e, ms] = await Promise.all([
        scanApi.list(filterExam || undefined),
        examApi.list(),
        scanApi.monitorStatus(),
      ])
      setScans(s)
      setExams(e)
      setMonitorStatus(ms)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [filterExam])

  // Auto-refresh while monitoring or files are in-flight
  useEffect(() => {
    const hasInFlight = scans.some(s => s.status === 'pending' || s.status === 'processing')
    const shouldPoll = (monitorStatus.running as boolean) || hasInFlight
    if (!shouldPoll) return
    const t = setInterval(async () => {
      const [s, ms] = await Promise.all([scanApi.list(filterExam || undefined), scanApi.monitorStatus()])
      setScans(s)
      setMonitorStatus(ms)
    }, 4000)
    return () => clearInterval(t)
  }, [scans, monitorStatus, filterExam])

  const filtered = scans.filter(s => !filterStatus || s.status === filterStatus)

  const handleProcessAll = async () => {
    if (!filterExam) { toast.error('请先选择考试'); return }
    setProcessing(true)
    try {
      const r = await scanApi.processBatch(Number(filterExam))
      toast.success(`处理完成：${r.success} 成功，${r.failed} 失败`)
      load()
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setProcessing(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此扫描文件记录？')) return
    try {
      await scanApi.delete(id)
      toast.success('已删除')
      setScans(prev => prev.filter(s => s.id !== id))
    } catch (err: unknown) {
      toast.error((err as Error).message)
    }
  }

  const handleStartMonitor = async () => {
    if (!monitorDir || !monitorExamId) { toast.error('请填写监控目录和选择考试'); return }
    try {
      await scanApi.startMonitor(monitorDir, Number(monitorExamId))
      toast.success('文件监控已启动')
      load()
    } catch (err: unknown) {
      toast.error((err as Error).message)
    }
  }

  const handleStopMonitor = async () => {
    try {
      await scanApi.stopMonitor()
      toast.success('文件监控已停止')
      load()
    } catch (err: unknown) {
      toast.error((err as Error).message)
    }
  }

  const pendingCount = scans.filter(s => s.status === 'pending').length
  const isMonitoring = monitorStatus.running as boolean

  // ── 文件夹选择器 Modal ────────────────────────────────────────────────────────
  const FolderPickerModal = pickerOpen ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPickerOpen(false)}>
      <div className="bg-white rounded-xl shadow-2xl w-[500px] max-h-[540px] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-yellow-500" /> 选择扫描目录
          </h3>
          <button onClick={() => setPickerOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        {/* 当前路径 */}
        <div className="px-4 py-2 text-xs text-gray-500 font-mono bg-gray-50 border-b truncate">
          {pickerPath || '加载中...'}
        </div>
        {/* 目录列表 */}
        <div className="overflow-y-auto flex-1 divide-y">
          {pickerParent && (
            <button
              className="w-full text-left px-4 py-2.5 hover:bg-blue-50 flex items-center gap-2 text-sm text-blue-600"
              onClick={() => browseDir(pickerParent)}
            >
              <span className="text-base">↑</span> 上级目录
            </button>
          )}
          {pickerLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
            </div>
          )}
          {!pickerLoading && pickerDirs.length === 0 && (
            <div className="px-4 py-8 text-center text-gray-400 text-sm">此目录下无子目录</div>
          )}
          {!pickerLoading && pickerDirs.map(d => (
            <button
              key={d.path}
              className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-2 text-sm"
              onClick={() => browseDir(d.path)}
            >
              <FolderOpen className="w-4 h-4 text-yellow-400 flex-shrink-0" />
              <span className="truncate">{d.name}</span>
            </button>
          ))}
        </div>
        {/* 底部操作 */}
        <div className="px-4 py-3 border-t flex items-center gap-2 justify-end">
          <span className="text-xs text-gray-400 mr-auto truncate max-w-[220px]">{pickerPath}</span>
          <button onClick={() => setPickerOpen(false)} className="btn-secondary text-sm">取消</button>
          <button onClick={handleConfirmDir} className="btn-primary text-sm">
            选择「{pickerPath.split('/').filter(Boolean).pop() || '/'}」
          </button>
        </div>
      </div>
    </div>
  ) : null

  return (
    <div className="p-8 space-y-6">
      {FolderPickerModal}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">扫描文件监控</h1>
          <p className="text-sm text-gray-500 mt-1">管理和处理扫描试卷文件</p>
        </div>
        <button onClick={load} className="btn-secondary">
          <RefreshCw className="w-4 h-4" /> 刷新
        </button>
      </div>

      {/* Auto Monitor */}
      <div className="card space-y-3">
        <div className="flex items-center gap-2">
          <Radio className={`w-4 h-4 ${isMonitoring ? 'text-green-500 animate-pulse' : 'text-gray-400'}`} />
          <h2 className="font-semibold text-gray-900">自动目录监控</h2>
          {isMonitoring && (
            <span className="badge bg-green-100 text-green-700 text-xs">
              监控中：{monitorStatus.directory as string}
            </span>
          )}
        </div>
        {!isMonitoring ? (
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="label text-xs">扫描文件目录</label>
              <div className="relative">
                <FolderOpen className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  className="input pl-9 pr-16 text-sm cursor-pointer"
                  value={monitorDir}
                  onChange={e => setMonitorDir(e.target.value)}
                  placeholder="点击「浏览」选择目录，或直接输入路径"
                />
                <button
                  type="button"
                  onClick={handleOpenPicker}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                >
                  浏览
                </button>
              </div>
            </div>
            <div className="w-48">
              <label className="label text-xs">关联考试</label>
              <select className="input text-sm" value={monitorExamId}
                onChange={e => setMonitorExamId(Number(e.target.value) || '')}>
                <option value="">选择考试</option>
                {exams.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <button onClick={handleStartMonitor} className="btn-primary">
              <Play className="w-4 h-4" /> 开始监控
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-600 space-y-1">
              <p>目录：<span className="font-mono text-gray-800">{monitorStatus.directory as string}</span></p>
                <p>已检测：<span className="font-semibold">{monitorStatus.files_detected as number}</span> 个 &nbsp;|&nbsp; 已处理：<span className="font-semibold text-green-600">{(monitorStatus.files_processed as number) ?? 0}</span> 个</p>
            </div>
            <button onClick={handleStopMonitor} className="btn-danger ml-auto">停止监控</button>
          </div>
        )}
      </div>

      {/* Filters & Actions */}
      <div className="card flex items-center gap-3 py-4">
        <select className="input text-sm w-56" value={filterExam}
          onChange={e => setFilterExam(Number(e.target.value) || '')}>
          <option value="">全部考试</option>
          {exams.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select className="input text-sm w-36" value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}>
          <option value="">全部状态</option>
          {Object.entries(STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <span className="text-sm text-gray-500">{filtered.length} 条</span>
        {pendingCount > 0 && filterExam && (
          <button onClick={handleProcessAll} disabled={processing} className="btn-primary ml-auto">
            <Play className="w-4 h-4" />
            {processing ? '处理中...' : `批量处理 (${pendingCount} 待处理)`}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <ScanLine className="w-10 h-10 mx-auto mb-2 opacity-20" />
            <p>暂无扫描文件</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="table-header">文件名</th>
                <th className="table-header">关联考试</th>
                <th className="table-header">大小</th>
                <th className="table-header">卷面编号</th>
                <th className="table-header text-center">状态</th>
                <th className="table-header">上传时间</th>
                <th className="table-header">错误信息</th>
                <th className="table-header text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(sf => {
                const sc = STATUS_CFG[sf.status] || { label: sf.status, color: 'bg-gray-100 text-gray-600' }
                const examName = exams.find(e => e.id === sf.exam_id)?.name || '未关联'
                return (
                  <tr key={sf.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="table-cell font-mono text-xs max-w-xs truncate">
                      {sf.file_name || sf.file_path.split('/').pop()}
                    </td>
                    <td className="table-cell text-sm text-gray-600">{examName}</td>
                    <td className="table-cell text-xs text-gray-400">
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
                      <span className={`badge ${sc.color}`}>{sc.label}</span>
                    </td>
                    <td className="table-cell text-xs text-gray-400">
                      {new Date(sf.created_at).toLocaleString('zh-CN')}
                    </td>
                    <td className="table-cell text-xs text-red-500 max-w-xs truncate">
                      {sf.error_message || '—'}
                    </td>
                    <td className="table-cell text-center">
                      <div className="flex items-center justify-center gap-1">
                        {sf.exam_id && sf.status === 'completed' && (
                          <button onClick={() => navigate(`/results/${sf.exam_id}`)}
                            className="text-xs text-blue-500 hover:underline">查看成绩</button>
                        )}
                        {sf.status === 'failed' && sf.exam_id && (
                          <button
                            className="text-xs text-orange-500 hover:underline"
                            onClick={async () => {
                              try {
                                await scanApi.processBatch(sf.exam_id!, [sf.id])
                                toast.success('已重新提交处理')
                                load()
                              } catch { toast.error('重试失败') }
                            }}>重试</button>
                        )}
                        <button onClick={() => handleDelete(sf.id)}
                          className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg">
                          <Trash2 className="w-3.5 h-3.5" />
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
