import { useEffect, useState } from 'react'
import { Settings, Save, TestTube2, Eye, EyeOff, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { settingsApi } from '../api'

interface AISettings {
  api_provider: string
  api_base_url: string
  api_key: string
  model_name: string
  vision_model: string
  max_tokens: number
  temperature: number
  enabled: boolean
}

const PROVIDERS = [
  { value: 'siliconflow', label: '硅基流动 (SiliconFlow)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'azure', label: 'Azure OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'zhipu', label: '智谱AI (GLM)' },
  { value: 'custom', label: '自定义' },
]

const PROVIDER_DEFAULTS: Record<string, Partial<AISettings>> = {
  siliconflow: { api_base_url: 'https://api.siliconflow.cn/v1', model_name: 'Qwen/Qwen2.5-VL-72B-Instruct' },
  openai:   { api_base_url: 'https://api.openai.com/v1', model_name: 'gpt-4o-mini' },
  azure:    { api_base_url: 'https://<your-resource>.openai.azure.com', model_name: 'gpt-4o' },
  deepseek: { api_base_url: 'https://api.deepseek.com/v1', model_name: 'deepseek-chat' },
  zhipu:    { api_base_url: 'https://open.bigmodel.cn/api/paas/v4', model_name: 'glm-4-flash' },
  custom:   { api_base_url: '', model_name: '' },
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AISettings>({
    api_provider: 'siliconflow',
    api_base_url: 'https://api.siliconflow.cn/v1',
    api_key: '',
    model_name: 'Qwen/Qwen2.5-VL-72B-Instruct',
    vision_model: '',
    max_tokens: 1000,
    temperature: 0.3,
    enabled: false,
  })
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    settingsApi.getAI().then(data => {
      if (data) setSettings(s => ({ ...s, ...data }))
    }).catch(() => {})
  }, [])

  const update = (field: keyof AISettings, value: unknown) => {
    setSettings(prev => ({ ...prev, [field]: value }))
    setTestResult(null)
  }

  const handleProviderChange = (provider: string) => {
    const defaults = PROVIDER_DEFAULTS[provider] || {}
    setSettings(prev => ({ ...prev, api_provider: provider, ...defaults }))
    setTestResult(null)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await settingsApi.updateAI(settings as unknown as Record<string, unknown>)
      toast.success('设置已保存')
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await settingsApi.testAI()
      setTestResult({ ok: true, message: r.message || '连接成功！' })
      toast.success('AI连接测试通过')
    } catch (err: unknown) {
      const msg = (err as Error).message
      setTestResult({ ok: false, message: msg })
      toast.error(`连接测试失败：${msg}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="w-6 h-6 text-blue-500" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">系统设置</h1>
          <p className="text-sm text-gray-500 mt-0.5">配置AI自动评分相关参数</p>
        </div>
      </div>

      {/* AI Settings */}
      <div className="card space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">AI评分配置</h2>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-sm text-gray-600">启用AI评分</span>
            <div
              onClick={() => update('enabled', !settings.enabled)}
              className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${
                settings.enabled ? 'bg-blue-500' : 'bg-gray-200'
              }`}>
              <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                settings.enabled ? 'translate-x-5' : ''
              }`} />
            </div>
          </label>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">AI服务提供商</label>
            <select className="input" value={settings.api_provider}
              onChange={e => handleProviderChange(e.target.value)}>
              {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>

          <div>
            <label className="label">API 基础地址</label>
            <input className="input" value={settings.api_base_url}
              onChange={e => update('api_base_url', e.target.value)}
              placeholder="https://api.openai.com/v1" />
          </div>

          <div>
            <label className="label">API Key</label>
            <div className="relative">
              <input
                className="input pr-10"
                type={showKey ? 'text' : 'password'}
                value={settings.api_key}
                onChange={e => update('api_key', e.target.value)}
                placeholder="sk-..."
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">API Key 将以加密方式存储，不会明文保存</p>
          </div>

          <div>
            <label className="label">模型名称</label>
            <input className="input" value={settings.model_name}
              onChange={e => update('model_name', e.target.value)}
              placeholder="gpt-4o-mini" />
            <p className="text-xs text-gray-400 mt-1">用于主观题 AI 批改</p>
          </div>

          <div>
            <label className="label">视觉模型（选择题识别）</label>
            <input className="input" value={settings.vision_model}
              onChange={e => update('vision_model', e.target.value)}
              placeholder="留空则复用上方模型" />
            <p className="text-xs text-gray-400 mt-1">
              用于识别选择题手写答案，需要支持图片输入的模型。留空则使用上方配置的模型。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">最大Token数</label>
              <input className="input" type="number" min={100} max={4000}
                value={settings.max_tokens}
                onChange={e => update('max_tokens', Number(e.target.value))} />
              <p className="text-xs text-gray-400 mt-1">控制单次AI回复的最大长度</p>
            </div>
            <div>
              <label className="label">温度 (Temperature)</label>
              <div className="flex items-center gap-3">
                <input className="flex-1" type="range" min={0} max={1} step={0.05}
                  value={settings.temperature}
                  onChange={e => update('temperature', Number(e.target.value))} />
                <span className="w-10 text-sm text-center font-mono text-gray-700">
                  {settings.temperature.toFixed(2)}
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-1">越低越稳定，越高越有创意（推荐0.1-0.5）</p>
            </div>
          </div>
        </div>

        {/* Test Result */}
        {testResult && (
          <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
            testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            {testResult.ok
              ? <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              : <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
            <span>{testResult.message}</span>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button onClick={handleTest} disabled={testing || !settings.api_key}
            className="btn-secondary">
            {testing
              ? <><Loader2 className="w-4 h-4 animate-spin" /> 测试中...</>
              : <><TestTube2 className="w-4 h-4" /> 测试连接</>}
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-primary ml-auto">
            <Save className="w-4 h-4" />
            {saving ? '保存中...' : '保存设置'}
          </button>
        </div>
      </div>

      {/* About */}
      <div className="card space-y-2 text-sm text-gray-500">
        <h2 className="font-semibold text-gray-700 text-base">关于系统</h2>
        <p>AI智能阅卷系统 v1.0.0</p>
        <p>本系统专为中学教师设计，支持选择题、填空题和主观题的自动识别与评分。</p>
        <p className="text-xs text-gray-400">
          后端：FastAPI + SQLAlchemy · 前端：React + Tailwind CSS · OCR：EasyOCR
        </p>
      </div>
    </div>
  )
}
