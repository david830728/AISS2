import { Plus, Trash2 } from 'lucide-react'
import { SubQuestion } from '../api'

interface Props {
  subQuestions: SubQuestion[]
  questionType: 'fill' | 'subjective'
  onChange: (subs: SubQuestion[]) => void
}

export default function SubQuestionEditor({ subQuestions, questionType, onChange }: Props) {
  const add = () => {
    const n = subQuestions.length + 1
    onChange([
      ...subQuestions,
      { label: `(${n})`, max_score: 1, standard_answer: '', grading_criteria: '' },
    ])
  }

  const remove = (idx: number) => {
    onChange(subQuestions.filter((_, i) => i !== idx))
  }

  const update = (idx: number, field: keyof SubQuestion, value: unknown) => {
    onChange(subQuestions.map((sq, i) => (i === idx ? { ...sq, [field]: value } : sq)))
  }

  return (
    <div className="space-y-2 pl-4 border-l-2 border-blue-200">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-blue-600">
          小题列表（共 {subQuestions.length} 小题，合计{' '}
          {subQuestions.reduce((s, q) => s + (Number(q.max_score) || 0), 0)} 分）
        </span>
      </div>

      {subQuestions.map((sq, idx) => (
        <div key={idx} className="grid grid-cols-12 gap-2 items-start bg-white border border-gray-200 rounded-lg p-2">
          {/* Label */}
          <div className="col-span-2">
            <label className="label text-xs">标号</label>
            <input
              className="input text-xs py-1"
              value={sq.label}
              onChange={(e) => update(idx, 'label', e.target.value)}
              placeholder="(1)"
            />
          </div>
          {/* Max score */}
          <div className="col-span-2">
            <label className="label text-xs">分值</label>
            <input
              className="input text-xs py-1"
              type="number"
              min={0}
              step={0.5}
              value={sq.max_score}
              onChange={(e) => update(idx, 'max_score', Number(e.target.value))}
            />
          </div>
          {/* Answer */}
          <div className="col-span-7">
            <label className="label text-xs">
              {questionType === 'subjective' ? '答案要点' : '标准答案'}
            </label>
            <input
              className="input text-xs py-1"
              value={sq.standard_answer || ''}
              onChange={(e) => update(idx, 'standard_answer', e.target.value)}
              placeholder={questionType === 'subjective' ? '填写评分要点' : '填写标准答案'}
            />
          </div>
          {/* Delete */}
          <div className="col-span-1 flex items-end pb-1">
            <button
              onClick={() => remove(idx)}
              className="p-1.5 text-red-400 hover:bg-red-50 rounded w-full flex justify-center"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          {/* Grading criteria for subjective */}
          {questionType === 'subjective' && (
            <div className="col-span-12">
              <label className="label text-xs">评分细则（AI评分时使用）</label>
              <input
                className="input text-xs py-1"
                value={sq.grading_criteria || ''}
                onChange={(e) => update(idx, 'grading_criteria', e.target.value)}
                placeholder="如：答出关键词得1分，逻辑完整再得1分..."
              />
            </div>
          )}
        </div>
      ))}

      <button onClick={add} className="btn-secondary text-xs py-1.5 w-full">
        <Plus className="w-3.5 h-3.5" /> 添加小题
      </button>
    </div>
  )
}
