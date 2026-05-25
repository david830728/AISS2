import { useState } from 'react'
import { X, ZoomIn, ZoomOut } from 'lucide-react'
import AnswerSheetPreview, { OVERLAY_COLORS, OverlayBox, SheetQuestion } from './AnswerSheetPreview'

const TYPE_LABEL: Record<string, string> = {
  choice:     '选择题',
  fill:       '填空题',
  subjective: '主观题',
  info:       '考生信息区',
  unknown:    '未知',
}

interface Props {
  questions: SheetQuestion[]
  examName:  string
  subject:   string
  examId?:   number
  onClose:   () => void
}

export default function AnswerSheetDebugView({
  questions, examName, subject, examId, onClose,
}: Props) {
  const [zoom, setZoom] = useState(0.55)
  const [allBoxes, setAllBoxes] = useState<OverlayBox[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const handleOverlaysReady = (boxes: OverlayBox[]) => {
    setAllBoxes(boxes)
  }

  const handleSelect = (key: string) => {
    const next = selectedKey === key ? null : key
    setSelectedKey(next)
    if (next) {
      // 滚动到对应元素
      setTimeout(() => {
        const el = document.querySelector(`[data-debug-key="${next}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 50)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-gray-900"
      style={{ fontFamily: 'system-ui, sans-serif' }}
    >
      {/* ── 顶部工具栏 ── */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <span className="text-white font-semibold text-sm">答题卡区域调试视图</span>

        {/* 图例 */}
        <div className="flex items-center gap-3 ml-4">
          {Object.entries(TYPE_LABEL).map(([type, lbl]) => (
            <span key={type} className="flex items-center gap-1 text-xs text-gray-300">
              <span style={{
                display: 'inline-block', width: 10, height: 10,
                border: `2px solid ${OVERLAY_COLORS[type] ?? '#888'}`, borderRadius: 1,
              }} />
              {lbl}
            </span>
          ))}
        </div>

        {/* 缩放 */}
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => setZoom(z => Math.max(0.2, +(z - 0.05).toFixed(2)))}
            className="p-1 text-gray-300 hover:text-white">
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-gray-300 text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(2, +(z + 0.05).toFixed(2)))}
            className="p-1 text-gray-300 hover:text-white">
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>

        <button onClick={onClose}
          className="p-1.5 text-gray-300 hover:text-white hover:bg-gray-700 rounded ml-2">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* ── 主体 ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* 左侧 ~70%：答题卡实时渲染 + 叠加框 */}
        <div className="flex-[7] overflow-auto bg-gray-950 p-4">
          {/* zoom 包装层：用 CSS zoom 控制整体缩放比例 */}
          <div style={{ zoom, transformOrigin: 'top left', display: 'inline-block' }}>
            <AnswerSheetPreview
              questions={questions}
              examName={examName}
              subject={subject}
              examId={examId}
              noZoom
              debugOverlay
              highlightKey={selectedKey ?? undefined}
              onOverlaysReady={handleOverlaysReady}
            />
          </div>
        </div>

        {/* 右侧 ~30%：叠加框列表 */}
        <div className="flex-[3] bg-gray-800 border-l border-gray-700 overflow-y-auto flex flex-col min-w-[200px]">
          <div className="px-3 py-2 text-xs font-semibold text-gray-400 border-b border-gray-700 sticky top-0 bg-gray-800">
            切割区域列表 · {allBoxes.length} 个
          </div>

          {allBoxes.length === 0 && (
            <p className="px-3 py-4 text-xs text-gray-500">正在计算区域…</p>
          )}

          {allBoxes.map(box => {
            const color = OVERLAY_COLORS[box.type] ?? OVERLAY_COLORS.unknown
            const isActive = selectedKey === box.key
            const r = box.region
            return (
              <button
                key={box.key}
                onClick={() => handleSelect(box.key)}
                className={`w-full text-left px-3 py-2 border-b border-gray-700/40 flex items-start gap-2 text-xs transition-colors ${
                  isActive ? 'bg-gray-600' : 'hover:bg-gray-700'
                }`}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: 1, flexShrink: 0, marginTop: 2,
                  backgroundColor: color,
                }} />
                <div className="flex-1 min-w-0">
                  <div className="text-gray-200 truncate">{box.label}</div>
                  <div className="text-gray-500 mt-0.5">
                    {box.page === 'front' ? '正面' : '反面'} · {TYPE_LABEL[box.type] ?? box.type}
                  </div>
                  <div className="text-gray-600 font-mono mt-0.5" style={{ fontSize: 9 }}>
                    x:{r.x.toFixed(3)} y:{r.y.toFixed(3)} w:{r.width.toFixed(3)} h:{r.height.toFixed(3)}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
