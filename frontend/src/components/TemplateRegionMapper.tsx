import { useRef, useState, useCallback } from 'react'
import { MapPin, Trash2 } from 'lucide-react'

export interface Region {
  x: number
  y: number
  width: number
  height: number
}

export interface RegionItem {
  key: string
  label: string
  region?: Region
  color: string
}

interface Props {
  templateUrl: string
  items: RegionItem[]
  onRegionChange: (key: string, region: Region | undefined) => void
}

export default function TemplateRegionMapper({ templateUrl, items, onRegionChange }: Props) {
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [startPt, setStartPt] = useState({ x: 0, y: 0 })
  const [curPt, setCurPt] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  const getCoords = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    if (!containerRef.current) return { x: 0, y: 0 }
    const rect = containerRef.current.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    }
  }, [])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeKey === null) return
    e.preventDefault()
    const pt = getCoords(e)
    setStartPt(pt)
    setCurPt(pt)
    setDrawing(true)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drawing) return
    setCurPt(getCoords(e))
  }

  const handleMouseUp = () => {
    if (!drawing || activeKey === null) return
    setDrawing(false)
    const x = Math.min(startPt.x, curPt.x)
    const y = Math.min(startPt.y, curPt.y)
    const w = Math.abs(curPt.x - startPt.x)
    const h = Math.abs(curPt.y - startPt.y)
    if (w > 0.01 && h > 0.01) {
      onRegionChange(activeKey, { x, y, width: w, height: h })
    }
  }

  const previewStyle = drawing
    ? {
        left: `${Math.min(startPt.x, curPt.x) * 100}%`,
        top: `${Math.min(startPt.y, curPt.y) * 100}%`,
        width: `${Math.abs(curPt.x - startPt.x) * 100}%`,
        height: `${Math.abs(curPt.y - startPt.y) * 100}%`,
      }
    : null

  return (
    <div className="flex gap-4" style={{ minHeight: 400 }}>
      {/* Left: question list */}
      <div className="w-52 flex-shrink-0 space-y-1 overflow-y-auto pr-1">
        <p className="text-xs text-gray-400 mb-2 leading-snug">
          点击左侧题目激活，然后在右侧图片上拖动鼠标框选答题区域
        </p>
        {items.map((item) => {
          const isActive = item.key === activeKey
          return (
            <div
              key={item.key}
              onClick={() => setActiveKey(isActive ? null : item.key)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-all select-none"
              style={{
                border: `2px solid ${isActive ? item.color : 'transparent'}`,
                backgroundColor: isActive ? item.color + '18' : undefined,
              }}
            >
              <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: item.color }} />
              <span className="flex-1 truncate text-gray-700">{item.label}</span>
              {item.region ? (
                <button
                  title="清除区域"
                  onClick={(e) => { e.stopPropagation(); onRegionChange(item.key, undefined) }}
                  className="text-gray-300 hover:text-red-400 flex-shrink-0"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              ) : (
                <MapPin className="w-3 h-3 text-gray-200 flex-shrink-0" />
              )}
            </div>
          )
        })}
      </div>

      {/* Right: image with region overlays */}
      <div className="flex-1 min-w-0">
        {activeKey !== null && (
          <p className="text-xs text-blue-500 mb-1">
            正在为「{items.find(i => i.key === activeKey)?.label}」划定区域，在图上拖动鼠标
          </p>
        )}
        <div
          ref={containerRef}
          className="relative border border-gray-200 rounded-lg overflow-hidden bg-gray-50"
          style={{ cursor: activeKey !== null ? 'crosshair' : 'default' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => setDrawing(false)}
        >
          <img
            src={templateUrl}
            alt="答题卡模板"
            className="w-full h-auto block pointer-events-none"
            draggable={false}
          />

          {/* Existing region overlays */}
          {items.map((item) => {
            if (!item.region) return null
            const { x, y, width, height } = item.region
            return (
              <div
                key={item.key}
                className="absolute border-2 flex items-start justify-between"
                style={{
                  left: `${x * 100}%`,
                  top: `${y * 100}%`,
                  width: `${width * 100}%`,
                  height: `${height * 100}%`,
                  borderColor: item.color,
                  backgroundColor: item.color + '22',
                  pointerEvents: 'none',
                }}
              >
                <span
                  className="text-white text-xs font-bold px-1 leading-tight"
                  style={{ backgroundColor: item.color }}
                >
                  {item.label}
                </span>
              </div>
            )
          })}

          {/* Live drawing preview */}
          {previewStyle && (
            <div
              className="absolute border-2 border-dashed border-blue-500 bg-blue-100/20 pointer-events-none"
              style={previewStyle}
            />
          )}
        </div>
      </div>
    </div>
  )
}
