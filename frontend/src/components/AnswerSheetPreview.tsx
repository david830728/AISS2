import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Printer } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import type { SubQuestion } from '../api'

export interface SheetQuestion {
  _key: number
  question_number: number
  question_type: 'choice' | 'fill' | 'subjective'
  title: string
  max_score: number
  standard_answer: string
  sub_questions: SubQuestion[]
  answer_lines?: number
}

export type RegionMap = Record<string, {
  x: number; y: number; width: number; height: number
  page?: string
  region_type?: string
  question_numbers?: number[]
}>

export interface OverlayBox {
  key:    string
  label:  string
  type:   string
  region: { x: number; y: number; width: number; height: number }
  page:   'front' | 'back'
}

export const OVERLAY_COLORS: Record<string, string> = {
  choice:     '#2563EB',
  fill:       '#16A34A',
  subjective: '#DC2626',
  info:       '#D97706',
  marker:     '#7C3AED',
  unknown:    '#6B7280',
}

type PaperSize = 'A4' | 'A3' | 'B3'

// ── 模块级常量 ────────────────────────────────────────────────────────────────

const SCALE = 0.42

// 四角定位黑块（pt）
const MARKER_W   = 24   // 宽
const MARKER_H   = 16   // 高（矩形，横向更易识别）
const MARKER_OFF = 14   // 距纸张边缘

// 页面内边距（pt）
const PAD_TB = 50       // 上下
const PAD_LR = 40       // 左右

// 单位换算
const PT_PER_CM = 28.346   // 72pt/inch ÷ 2.54cm/inch
const PX_PER_CM = 96 / 2.54

// 填空题区域上下各扩展量（相对页高），防止学生书写位置偏高/偏低时漏切
const FILL_EXPAND_Y = 0.025   // ≈ A4下约 26pt（约 9mm）
// 相邻区域之间保留的最小间隙（相对页高），防止裁剪框重叠
const REGION_GAP = 0.006      // ≈ A4下约 6pt（约 2mm）

// A面考生信息区固定相对坐标（与后端识别常量保持一致）
const INFO_X  = 0.05
const INFO_Y  = 0.04
const INFO_H  = 0.08
// 正面内容区（题目）起始 y 比例（信息区下方 + 间距）
const FRONT_CONTENT_Y = 0.13
// 反面内容区起始 y 比例（仅标题占用）
const BACK_CONTENT_Y  = 0.07

const PAPERS: Record<PaperSize, { wCm: number; hCm: number }> = {
  A4: { wCm: 21.0, hCm: 29.7 },
  A3: { wCm: 42.0, hCm: 29.7 },
  B3: { wCm: 51.5, hCm: 36.4 },
}

// ── Block 类型（内容分发单元）────────────────────────────────────────────────

type BlockData =
  | { kind: 'choices'; questions: SheetQuestion[] }
  | { kind: 'fills';   questions: SheetQuestion[] }
  | { kind: 'subj';    q: SheetQuestion }

interface Block { id: string; data: BlockData; estH: number }

type RrFn = (key: string, el: HTMLElement | null) => void

// ── 高度估算函数 ──────────────────────────────────────────────────────────────

const CHOICE_PER_ROW = 5
const CHOICE_NUM_H  = 24   // pt 题号行高
const CHOICE_ANS_H  = 32   // pt 答题行高

function estChoicesH(qs: SheetQuestion[]): number {
  return 48 + Math.ceil(qs.length / CHOICE_PER_ROW) * (CHOICE_NUM_H + CHOICE_ANS_H) + 16
}

function estFillsH(qs: SheetQuestion[]): number {
  let h = 60
  for (const q of qs) {
    h += 20
    const n = q.sub_questions.length > 0
      ? q.sub_questions.reduce((s, sq) => s + (sq.blank_count ?? 1), 0)
      : 1
    h += n * 26
  }
  return h + 20
}

function estSubjH(q: SheetQuestion): number {
  const lines = q.answer_lines || 8
  const boxH = lines * 24 + 16
  let h = 60
  if (q.sub_questions.length > 0) {
    h += q.sub_questions.length * (20 + boxH)
  } else {
    h += boxH
  }
  return h + 20
}

// ── 内容块构建与分发 ──────────────────────────────────────────────────────────

function buildBlocks(
  choices: SheetQuestion[], fills: SheetQuestion[], subjs: SheetQuestion[],
): Block[] {
  const bs: Block[] = []
  if (choices.length > 0)
    bs.push({ id: 'choices', data: { kind: 'choices', questions: choices }, estH: estChoicesH(choices) })
  if (fills.length > 0)
    bs.push({ id: 'fills', data: { kind: 'fills', questions: fills }, estH: estFillsH(fills) })
  for (const q of subjs)
    bs.push({ id: `subj_${q._key}`, data: { kind: 'subj', q }, estH: estSubjH(q) })
  return bs
}

// 将 blocks 按顺序分配到 numCols 列，每列限高 colHeights[i]
function distributeBlocks(blocks: Block[], colHeights: number[]): Block[][] {
  const cols: Block[][] = colHeights.map(() => [])
  let ci = 0, used = 0
  for (const b of blocks) {
    // 若当前列放不下（且不是最后一列），挪到下一列
    while (ci < colHeights.length - 1 && used + b.estH > colHeights[ci]) {
      ci++; used = 0
    }
    cols[ci].push(b)
    used += b.estH
  }
  return cols
}

// ── Block 渲染函数 ─────────────────────────────────────────────────────────────

function renderBlock(block: Block, rr: RrFn, _unused: number, sn: (t: string) => string): ReactNode {
  const { data } = block

  if (data.kind === 'choices') {
    const qs = data.questions
    const nGroups = Math.ceil(qs.length / CHOICE_PER_ROW)
    return (
      <SectionBox key="choices">
        <SectionTitle>
          {sn('选择题')}、选择题（每题 {qs[0]?.max_score} 分，共 {qs.reduce((s, q) => s + q.max_score, 0)} 分）
        </SectionTitle>
        <div ref={el => rr('choice_table', el)}
          style={{ width: '100%', border: '1pt solid #000', borderBottom: 'none' }}>
          {Array.from({ length: nGroups }, (_, g) => {
            const rowQs = qs.slice(g * CHOICE_PER_ROW, (g + 1) * CHOICE_PER_ROW)
            return (
              <div key={g}>
                {/* 题号行 */}
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${CHOICE_PER_ROW}, 1fr)`, borderBottom: '0.5pt solid #bbb' }}>
                  {rowQs.map(q => (
                    <div key={q._key} style={{
                      textAlign: 'center', fontSize: '9pt',
                      height: `${CHOICE_NUM_H}pt`, lineHeight: `${CHOICE_NUM_H}pt`,
                      background: '#f0f0f0',
                      borderRight: '0.5pt solid #bbb', boxSizing: 'border-box',
                    }}>{q.question_number}</div>
                  ))}
                </div>
                {/* 答题行 */}
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${CHOICE_PER_ROW}, 1fr)`, borderBottom: '1pt solid #000' }}>
                  {rowQs.map(q => (
                    <div key={q._key} style={{
                      height: `${CHOICE_ANS_H}pt`,
                      borderRight: '0.5pt solid #bbb', boxSizing: 'border-box',
                    }} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </SectionBox>
    )
  }

  if (data.kind === 'fills') {
    const qs = data.questions
    return (
      <SectionBox key="fills">
        <SectionTitle>
          {sn('填空题')}、填空题（共 {qs.reduce((s, q) => s + q.max_score, 0)} 分）
        </SectionTitle>
        {qs.map(q => (
          <div key={q._key} style={{ marginBottom: '8pt' }}>
            <div style={{ marginBottom: '4pt', fontSize: '11pt' }}>
              {q.question_number}. {q.title || `第${q.question_number}题`}
            </div>
            {q.sub_questions.length > 0
              ? q.sub_questions.map((sq, si) => (
                <div key={si} ref={el => rr(`sq_${q._key}_${si}`, el)}
                  style={{ display: 'flex', alignItems: 'flex-end', gap: '6pt', marginBottom: '6pt', paddingLeft: '18pt', flexWrap: 'wrap' }}>
                  <span style={{ minWidth: '24pt', flexShrink: 0, fontSize: '10pt' }}>{sq.label}</span>
                  {Array.from({ length: sq.blank_count ?? 1 }).map((_, bi) => (
                    <span key={bi} style={{ display: 'inline-block', borderBottom: '1pt solid #000', width: '90pt', marginRight: '6pt', flexShrink: 0 }} />
                  ))}
                </div>
              ))
              : (
                <div ref={el => rr(`q_${q._key}`, el)} style={{ paddingLeft: '18pt' }}>
                  <span style={{ display: 'inline-block', borderBottom: '1pt solid #000', width: '200pt' }} />
                </div>
              )
            }
          </div>
        ))}
      </SectionBox>
    )
  }

  // subj
  const { q } = data
  return (
    <SectionBox key={block.id} style={{ marginBottom: '10pt' }}>
      <div style={{ fontWeight: 'bold', marginBottom: '5pt', borderBottom: '1pt solid #ddd', paddingBottom: '4pt', fontSize: '12pt' }}>
        {q.question_number}. {q.title || `第${q.question_number}题`}（共 {q.max_score} 分）
      </div>
      {q.sub_questions.length > 0
        ? q.sub_questions.map((sq, si) => {
            const lines = q.answer_lines || 8
            const boxH  = lines * 24 + 16
            return (
              <div key={si} ref={el => rr(`sq_${q._key}_${si}`, el)} style={{ marginBottom: '8pt' }}>
                <div style={{ marginBottom: '4pt', color: '#333', fontSize: '11pt' }}>
                  {sq.label}（{sq.max_score} 分）
                </div>
                <div style={{
                  border: '1pt solid #000', width: '100%',
                  height: `${boxH}pt`,
                  background: 'repeating-linear-gradient(to bottom, white, white 23pt, #ccc 23pt, #ccc 24pt)',
                }} />
              </div>
            )
          })
        : (() => {
            const lines = q.answer_lines || 8
            const boxH  = lines * 24 + 16
            return (
              <div ref={el => rr(`q_${q._key}`, el)} style={{
                border: '1pt solid #000', width: '100%',
                height: `${boxH}pt`,
                background: 'repeating-linear-gradient(to bottom, white, white 23pt, #ccc 23pt, #ccc 24pt)',
              }} />
            )
          })()
      }
    </SectionBox>
  )
}

// ── 辅助 UI 组件 ──────────────────────────────────────────────────────────────

function CornerMarker({ top, left }: { top: boolean; left: boolean }) {
  return (
    <div style={{
      position: 'absolute',
      [top ? 'top' : 'bottom']: `${MARKER_OFF}pt`,
      [left ? 'left' : 'right']: `${MARKER_OFF}pt`,
      width: `${MARKER_W}pt`, height: `${MARKER_H}pt`,
      backgroundColor: '#000000', pointerEvents: 'none',
    }} />
  )
}

function SectionBox({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      border: '1pt solid #000', borderRadius: '2pt',
      padding: '8pt 10pt', marginBottom: '10pt',
      breakInside: 'avoid', pageBreakInside: 'avoid',
      ...style,
    }}>
      {children}
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontWeight: 'bold', fontSize: '13pt',
      marginBottom: '6pt', borderBottom: '1pt solid #000', paddingBottom: '5pt',
    }}>
      {children}
    </div>
  )
}

// ── 双栏页面内容渲染器 ─────────────────────────────────────────────────────────

function TwoColContent({ left, right, rr, sn }: {
  left: Block[]; right: Block[]
  rr: RrFn; sn: (t: string) => string
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 28pt', alignItems: 'start' }}>
      <div style={{ paddingRight: '14pt', borderRight: '1pt solid #bbb' }}>
        {left.map(b => renderBlock(b, rr, 0, sn))}
      </div>
      <div>
        {right.map(b => renderBlock(b, rr, 0, sn))}
      </div>
    </div>
  )
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

interface Props {
  questions:         SheetQuestion[]
  examName:          string
  subject:           string
  examId?:           number
  debugOverlay?:     boolean                                         // 启用调试覆盖层
  noZoom?:           boolean                                         // 禁用缩放（调试模式）
  highlightKey?:     string                                          // 高亮某个 key
  initialSize?:      string                                          // 初始纸张规格
  onOverlaysReady?:  (boxes: OverlayBox[]) => void                   // 所有页叠加框
  onRegionsComputed?: (regions: RegionMap) => void
  onSizeChange?:     (size: string) => void                          // 纸张规格变化回调
}

// ── 页面二维码助手组件 ───────────────────────────────────────────────────────────
function PageQR({ value, top, left, right, center }: {
  value: string; top: string; left?: string; right?: string; center?: boolean
}) {
  return (
    <div style={{
      position: 'absolute', top, left, right,
      transform: center ? 'translateX(-50%)' : undefined,
      width: '50pt', height: '50pt', pointerEvents: 'none',
    }}>
      <QRCodeSVG value={value} style={{ width: '50pt', height: '50pt', display: 'block' }} />
    </div>
  )
}

export default function AnswerSheetPreview({
  questions, examName, subject, examId,
  debugOverlay, noZoom, highlightKey, initialSize,
  onOverlaysReady, onRegionsComputed, onSizeChange,
}: Props) {
  const [size, setSize] = useState<PaperSize>(
    (initialSize as PaperSize | undefined) ?? 'A4'
  )

  const frontRef = useRef<HTMLDivElement>(null)
  const backRef  = useRef<HTMLDivElement>(null)
  const wrapRef  = useRef<HTMLDivElement>(null)

  const rRefs1 = useRef<Map<string, HTMLElement>>(new Map())
  const rRefs2 = useRef<Map<string, HTMLElement>>(new Map())

  const [overlayBoxes, setOverlayBoxes] = useState<OverlayBox[]>([])

  // 用于从 key 推导题型和标签
  const keyInfoMap = useCallback((key: string): { type: string; label: string } => {
    if (key === '__info__') return { type: 'info', label: '考生信息区' }
    if (key === 'choice_table') return { type: 'choice', label: '选择题整体区域' }
    const qKeyMatch = key.match(/^q_(\d+)$/)
    const sqMatch   = key.match(/^sq_(\d+)_(\d+)$/)
    const rawKey    = qKeyMatch ? Number(qKeyMatch[1]) : sqMatch ? Number(sqMatch[1]) : -1
    const q = questions.find(q => q._key === rawKey)
    if (!q) return { type: 'unknown', label: key }
    const typeName = q.question_type === 'choice' ? '选择' : q.question_type === 'fill' ? '填空' : '主观'
    if (sqMatch) {
      const sq = q.sub_questions?.[Number(sqMatch[2])]
      return { type: q.question_type, label: `第${q.question_number}题-${sq?.label ?? sqMatch[2]}（${typeName}）` }
    }
    return { type: q.question_type, label: `第${q.question_number}题（${typeName}）` }
  }, [questions])

  const choices = questions.filter(q => q.question_type === 'choice')
  const fills   = questions.filter(q => q.question_type === 'fill')
  const subjs   = questions.filter(q => q.question_type === 'subjective')

  const SECTIONS = ([
    choices.length > 0 && '选择题',
    fills.length   > 0 && '填空题',
    subjs.length   > 0 && '主观题',
  ] as (string | false)[]).filter(Boolean) as string[]
  const CN = ['一', '二', '三', '四']
  const sn = (t: string) => CN[SECTIONS.indexOf(t)] ?? ''

  const { wCm, hCm } = PAPERS[size]
  // 内容区宽度（pt），减去左右内边距
  const contentWPt  = wCm * PT_PER_CM - PAD_LR * 2
  const isTwoCol    = size !== 'A4'
  void contentWPt

  // ── 内容分发 ──────────────────────────────────────────────────────────────
  // A4: 2列（正面、反面各1列）  A3/B3: 4列（正面左右、反面左右）
  const colsPerPage = isTwoCol ? 2 : 1
  const hPt         = hCm * PT_PER_CM
  // 可用高度 = 页面高度 × (底部留白前的高度比例 - 内容起始比例)
  const frontColH   = hPt * (0.97 - FRONT_CONTENT_Y)
  const backColH    = hPt * (0.97 - BACK_CONTENT_Y)
  const colHeights    = [
    ...Array<number>(colsPerPage).fill(frontColH),
    ...Array<number>(colsPerPage).fill(backColH),
  ]

  const allBlocks  = buildBlocks(choices, fills, subjs)
  const distributed = distributeBlocks(allBlocks, colHeights)
  // A4: distributed[0]=front, distributed[1]=back
  // A3/B3: distributed[0]=frontL, [1]=frontR, [2]=backL, [3]=backR
  const frontBlocks = isTwoCol ? null : distributed[0]
  const backBlocks  = isTwoCol ? null : distributed[1] ?? []
  const frontL = isTwoCol ? distributed[0] : []
  const frontR = isTwoCol ? distributed[1] : []
  const backL  = isTwoCol ? distributed[2] ?? [] : []
  const backR  = isTwoCol ? distributed[3] ?? [] : []

  const rr1 = (key: string, el: HTMLElement | null) => {
    if (el) rRefs1.current.set(key, el); else rRefs1.current.delete(key)
  }
  const rr2 = (key: string, el: HTMLElement | null) => {
    if (el) rRefs2.current.set(key, el); else rRefs2.current.delete(key)
  }

  // ── 区域坐标测量 ──────────────────────────────────────────────────────────
  const measureRegions = useCallback(() => {
    if (!onRegionsComputed && !debugOverlay) return
    const regions: RegionMap = {}
    const newBoxes: OverlayBox[] = []

    // 测量前临时将所有页面 zoom 重置为 1，消除缩放引入的亚像素舍入误差
    const pageRefs = [frontRef.current, backRef.current].filter(Boolean) as HTMLDivElement[]
    if (!noZoom) pageRefs.forEach(el => { el.style.zoom = '1' })

    const pages: [HTMLDivElement | null, Map<string, HTMLElement>, 'front' | 'back'][] = [
      [frontRef.current, rRefs1.current, 'front'],
      [backRef.current,  rRefs2.current, 'back'],
    ]
    for (const [pageEl, rmap, page] of pages) {
      if (!pageEl) continue
      const sr = pageEl.getBoundingClientRect()
      if (sr.width <= 0 || sr.height <= 0) continue

      // 第一步：计算原始区域，填空题加上扩展量
      type Item = { key: string; type: string; label: string; region: { x: number; y: number; width: number; height: number } }
      const items: Item[] = []
      rmap.forEach((el, key) => {
        const r  = el.getBoundingClientRect()
        const info = keyInfoMap(key)
        let rx = (r.left - sr.left) / sr.width
        let ry = (r.top  - sr.top)  / sr.height
        let rw = r.width  / sr.width
        let rh = r.height / sr.height
        if (info.type === 'fill') {
          ry = Math.max(0, ry - FILL_EXPAND_Y)
          rh = rh + FILL_EXPAND_Y * 2        // 下方扩展将在第二步裁剪
        }
        items.push({ key, type: info.type, label: info.label, region: { x: rx, y: ry, width: rw, height: rh } })
      })

      // 第二步：按 y 排序，裁剪每个填空题的上下边界防止重叠
      items.sort((a, b) => a.region.y - b.region.y)
      for (let i = 0; i < items.length; i++) {
        const cur = items[i]
        if (cur.type !== 'fill') continue
        // ── 上边界：不得高过上一个区域的底部（加间距）
        if (i > 0) {
          const prev = items[i - 1]
          const minY = prev.region.y + prev.region.height + REGION_GAP
          if (cur.region.y < minY) {
            const bottom = cur.region.y + cur.region.height
            cur.region.y = minY
            cur.region.height = Math.max(0, bottom - minY)
          }
        }
        // ── 下边界：不得低于下一个区域的顶部（减间距）
        if (i < items.length - 1) {
          const next = items[i + 1]
          const maxBottom = next.region.y - REGION_GAP
          if (cur.region.y + cur.region.height > maxBottom) {
            cur.region.height = Math.max(0, maxBottom - cur.region.y)
          }
        }
      }

      // 第三步：提交到结果集（含页面标识 A/B，供后端按页过滤）
      const pageSide = page === 'front' ? 'A' : 'B'
      const choiceNums = questions
        .filter(q => q.question_type === 'choice')
        .map(q => q.question_number)
      for (const item of items) {
        if (item.key === 'choice_table') {
          regions[item.key] = {
            ...item.region, page: pageSide,
            region_type: 'choice_table',
            question_numbers: choiceNums,
          }
        } else {
          regions[item.key] = { ...item.region, page: pageSide }
        }
        if (debugOverlay) {
          newBoxes.push({ key: item.key, label: item.label, type: item.type, region: item.region, page })
        }
      }
    }
    // 恢复 zoom
    if (!noZoom) pageRefs.forEach(el => { el.style.zoom = `${SCALE}` })

    if (debugOverlay) {
      setOverlayBoxes(newBoxes)
      onOverlaysReady?.(newBoxes)
    }
    if (onRegionsComputed) onRegionsComputed(regions)

    // 输出定位方块在 300DPI 下的像素坐标，便于调试
    const ppc = 300 / 2.54
    const pW  = Math.round(wCm * ppc), pH = Math.round(hCm * ppc)
    // 定位块尺寸从 pt 换算为 300DPI 像素：1pt = 300/72 px
    const ptToPx300 = 300 / 72
    const mOff = Math.round(MARKER_OFF * ptToPx300)
    const mW   = Math.round(MARKER_W   * ptToPx300)
    const mH   = Math.round(MARKER_H   * ptToPx300)
    console.log(
      `[答题卡定位方块 @300DPI] ${size}  ${pW}×${pH}px  块尺寸=${mW}×${mH}px\n` +
      `  左上  x=[${mOff},${mOff+mW}]  y=[${mOff},${mOff+mH}]\n` +
      `  右上  x=[${pW-mOff-mW},${pW-mOff}]  y=[${mOff},${mOff+mH}]\n` +
      `  左下  x=[${mOff},${mOff+mW}]  y=[${pH-mOff-mH},${pH-mOff}]\n` +
      `  右下  x=[${pW-mOff-mW},${pW-mOff}]  y=[${pH-mOff-mH},${pH-mOff}]`
    )
  }, [onRegionsComputed, debugOverlay, keyInfoMap, onOverlaysReady, size, wCm, hCm, noZoom])

  const handlePrint = useCallback(() => {
    measureRegions()
    const wrapEl = wrapRef.current
    if (!wrapEl) return
    const style = document.createElement('style')
    style.textContent = `
      @page { size: ${wCm}cm ${hCm}cm; margin: 0; }
      @media print {
        body * { visibility: hidden !important; }
        .aiss-print-wrapper, .aiss-print-wrapper * { visibility: visible !important; }
        .aiss-print-wrapper { position: absolute !important; top: 0; left: 0; margin: 0 !important; }
        .aiss-print-page {
          zoom: 1 !important; box-shadow: none !important;
          break-after: page; page-break-after: always;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .aiss-print-page:last-of-type { break-after: auto !important; page-break-after: auto !important; }
        .aiss-no-print { display: none !important; }
      }`
    document.head.appendChild(style)
    wrapEl.classList.add('aiss-print-wrapper')
    setTimeout(() => {
      window.print()
      setTimeout(() => { style.remove(); wrapEl.classList.remove('aiss-print-wrapper') }, 1000)
    }, 80)
  }, [measureRegions, wCm, hCm])

  useEffect(() => {
    const t = setTimeout(measureRegions, 150)
    return () => clearTimeout(t)
  }, [questions, size, measureRegions])

  const wPx = Math.round(wCm * PX_PER_CM)
  const hPx = Math.round(hCm * PX_PER_CM)

  // 绝对定位像素值（由 hPx/wPx 推导，供 position:absolute 子元素使用）
  const infoTopPx     = Math.round(hPx * INFO_Y)
  const infoLeftPx    = Math.round(wPx * INFO_X)
  const infoWidthPx   = Math.round(wPx * (1 - INFO_X * 2))
  const infoHeightPx  = Math.round(hPx * INFO_H)
  const frontContentTopPx = Math.round(hPx * FRONT_CONTENT_Y)
  const backContentTopPx  = Math.round(hPx * BACK_CONTENT_Y)
  const sideMarginPx      = Math.round(wPx * INFO_X)

  const pageStyle: CSSProperties = {
    position: 'relative',
    width:  `${wPx}px`,
    height: `${hPx}px`,
    fontFamily: 'SimSun, serif',
    fontSize: '11pt', lineHeight: 1.6, color: '#111',
    boxSizing: 'border-box',
    ...(noZoom ? {} : { zoom: SCALE }),
    display: 'block', margin: '0 auto', background: '#fff',
    overflow: 'visible',
  }

  const hasBackContent = isTwoCol ? (backL.length > 0 || backR.length > 0) : (backBlocks?.length ?? 0) > 0

  // 调试覆盖层渲染助手
  const renderOverlays = (page: 'front' | 'back') =>
    debugOverlay
      ? overlayBoxes
          .filter(b => b.page === page)
          .map(b => {
            const isHL = highlightKey === b.key
            const color = OVERLAY_COLORS[b.type] ?? OVERLAY_COLORS.unknown
            return (
              <div
                key={b.key}
                data-debug-key={b.key}
                style={{
                  position: 'absolute',
                  left:   `${b.region.x * 100}%`,
                  top:    `${b.region.y * 100}%`,
                  width:  `${b.region.width * 100}%`,
                  height: `${b.region.height * 100}%`,
                  border: `${isHL ? 3 : 2}px ${isHL ? 'dashed' : 'solid'} ${color}`,
                  backgroundColor: isHL ? `${color}33` : `${color}14`,
                  boxSizing: 'border-box',
                  zIndex: isHL ? 200 : 100,
                  pointerEvents: 'none',
                  transform: isHL ? 'scale(1.01)' : 'none',
                  transformOrigin: 'top left',
                  transition: 'all 0.15s',
                }}
              />
            )
          })
      : null

  return (
    <div className="space-y-3">
      {/* 控件栏 — 调试模式时隐藏 */}
      {!noZoom && <div className="flex items-center gap-2 flex-wrap aiss-no-print">
        <span className="text-sm font-medium text-gray-600">纸张规格：</span>
        {(Object.keys(PAPERS) as PaperSize[]).map(k => (
          <button key={k} onClick={() => { setSize(k); onSizeChange?.(k) }}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              size === k ? 'border-blue-500 bg-blue-50 text-blue-600 font-medium' : 'border-gray-200 text-gray-500 hover:border-gray-300'
            }`}>
            {k}（双面）
          </button>
        ))}
        <button onClick={handlePrint} className="btn-primary ml-auto text-sm">
          <Printer className="w-4 h-4" /> 打印 / 导出 PDF
        </button>
      </div>}

      <div className="bg-gray-100 rounded-lg p-4 overflow-auto">
        <div ref={wrapRef}>

          {/* ══ 正面 ══════════════════════════════════════════════════════════ */}
          <div className="aiss-no-print text-center text-xs text-gray-400 mb-2 select-none">── 正面 ──</div>
          <div ref={frontRef} className="bg-white shadow-md aiss-print-page" style={pageStyle}>
            <CornerMarker top={true}  left={true}  />
            <CornerMarker top={true}  left={false} />
            <CornerMarker top={false} left={true}  />
            <CornerMarker top={false} left={false} />
            {renderOverlays('front')}
            {/* 正面 QR码：两栏模式顶部居中，单栏模式移入考生信息栏（见下方） */}
            {examId != null && examId > 0 && isTwoCol && (
              <>
                <PageQR value={`${examId}_A`} top={`${MARKER_OFF}pt`} left="25%" center />
                <PageQR value={`${examId}_B`} top={`${MARKER_OFF}pt`} left="75%" center />
              </>
            )}

            {/* 标题：位于信息区正上方居中 */}
            <div style={{
              position: 'absolute',
              top: `${Math.round(hPx * 0.01)}px`, left: `${infoLeftPx}px`, width: `${infoWidthPx}px`,
              textAlign: 'center', fontSize: '15pt', fontWeight: 'bold',
            }}>
              {examName || subject} 答题卡
            </div>

            {/* A面考生信息区：固定坐标 x:0.05 y:0.04 w:0.90 h:0.08 */}
            <div ref={el => rr1('__info__', el)} style={{
              position: 'absolute',
              top: `${infoTopPx}px`, left: `${infoLeftPx}px`,
              width: `${infoWidthPx}px`, height: `${infoHeightPx}px`,
              border: '1pt solid #000', boxSizing: 'border-box',
              display: 'flex', alignItems: 'center',
              padding: '0 12pt', gap: '24pt', fontSize: '10pt',
            }}>
              {([
                { label: '学号', key: 'exam_number',   w: '90pt' },
                { label: '姓名', key: 'student_name',  w: '70pt' },
                { label: '班级', key: 'student_class', w: '70pt' },
              ] as const).map(({ label, key, w }) => (
                <span key={key} style={{ display: 'inline-flex', alignItems: 'flex-end', gap: '3pt', whiteSpace: 'nowrap' }}>
                  {label}：
                  <span ref={el => rr1(key, el)}
                    style={{ display: 'inline-block', borderBottom: '1pt solid #000', minWidth: w }} />
                </span>
              ))}
              {/* QR码置于班级字段右侧空白处（单栏模式） */}
              {!isTwoCol && examId != null && examId > 0 && (
                <div style={{ marginLeft: 'auto', flexShrink: 0, lineHeight: 0 }}>
                  <QRCodeSVG value={`${examId}_A`} style={{ width: '50pt', height: '50pt', display: 'block' }} />
                </div>
              )}
            </div>

            {/* 正面题目内容区（信息区下方 13% 开始） */}
            <div style={{
              position: 'absolute',
              top: `${frontContentTopPx}px`,
              left: `${sideMarginPx}px`, right: `${sideMarginPx}px`,
              bottom: `${Math.round(hPx * 0.02)}px`,
              overflow: 'visible',
            }}>
              {questions.length === 0 ? (
                <div style={{ textAlign: 'center', paddingTop: '40pt', color: '#999', fontSize: '12pt' }}>
                  请先在「题目设置」中添加题目
                </div>
              ) : isTwoCol ? (
                <TwoColContent left={frontL} right={frontR} rr={rr1} sn={sn} />
              ) : (
                frontBlocks!.map(b => renderBlock(b, rr1, 0, sn))
              )}
            </div>
          </div>

          {/* 翻面提示 */}
          <div className="aiss-no-print h-6 flex items-center justify-center">
            <span className="text-xs text-gray-400 select-none">── 翻面 ──</span>
          </div>

          {/* ══ 反面 ══════════════════════════════════════════════════════════ */}
          <div ref={backRef} className="bg-white shadow-md aiss-print-page" style={pageStyle}>
            <CornerMarker top={true}  left={true}  />
            <CornerMarker top={true}  left={false} />
            <CornerMarker top={false} left={true}  />
            <CornerMarker top={false} left={false} />
            {renderOverlays('back')}
            {/* 反面 QR码：两栏模式顶部居中，单栏模式与正面信息栏等高右端 */}
            {examId != null && examId > 0 && (
              isTwoCol ? (
                <>
                  <PageQR value={`${examId}_C`} top={`${MARKER_OFF}pt`} left="25%" center />
                  <PageQR value={`${examId}_D`} top={`${MARKER_OFF}pt`} left="75%" center />
                </>
              ) : (
                <div style={{
                  position: 'absolute',
                  top: `${infoTopPx}px`,
                  right: `${infoLeftPx}px`,
                  width: '50pt', height: '50pt',
                  lineHeight: 0,
                }}>
                  <QRCodeSVG value={`${examId}_B`} style={{ width: '50pt', height: '50pt', display: 'block' }} />
                </div>
              )
            )}

            {/* 反面标题 */}
            <div style={{
              position: 'absolute',
              top: `${Math.round(hPx * 0.01)}px`, left: `${infoLeftPx}px`, width: `${infoWidthPx}px`,
              textAlign: 'center', fontSize: '13pt', fontWeight: 'bold', color: '#333',
            }}>
              {examName || subject} 答题卡（反面）
            </div>

            {/* 反面题目内容区（无信息栏，从 7% 开始） */}
            <div style={{
              position: 'absolute',
              top: `${backContentTopPx}px`,
              left: `${sideMarginPx}px`, right: `${sideMarginPx}px`,
              bottom: `${Math.round(hPx * 0.02)}px`,
              overflow: 'visible',
            }}>
              {hasBackContent ? (
                isTwoCol ? (
                  <TwoColContent left={backL} right={backR} rr={rr2} sn={sn} />
                ) : (
                  backBlocks!.map(b => renderBlock(b, rr2, 0, sn))
                )
              ) : (
                <div style={{
                  border: '1pt solid #000', borderRadius: '2pt',
                  height: `${Math.round(hPx * 0.88)}px`,
                  background: 'repeating-linear-gradient(to bottom, white, white 23pt, #ccc 23pt, #ccc 24pt)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#bbb', fontSize: '14pt',
                }}>
                  草稿区 / 附加答题区
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      <p className="text-xs text-gray-400 text-center aiss-no-print">
        打印时请选「无页边距」、缩放「实际大小」，启用双面打印。四角实心黑块为透视校正定位标记。
      </p>
    </div>
  )
}
