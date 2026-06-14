import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { GraduationCap, Eye, EyeOff } from "lucide-react"
import api from "../api"

export default function Login() {
  const navigate = useNavigate()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPwd, setShowPwd] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    if (!username || !password) {
      setError("请输入用户名和密码")
      return
    }
    setLoading(true)
    setError("")
    try {
      const res = await api.post("/auth/login", { username, password })
      localStorage.setItem("token", res.data.access_token)
      localStorage.setItem("user", JSON.stringify(res.data.user))
      navigate("/")
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message || "登录失败，请检查用户名和密码")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 to-blue-700 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <GraduationCap className="w-9 h-9 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">AI 智能阅卷系统</h1>
          <p className="text-gray-500 mt-1 text-sm">乐清市白石中学</p>
        </div>

        <div className="space-y-4">
          {/* Username */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              placeholder="请输入用户名"
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
            <div className="relative">
              <input
                type={showPwd ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                placeholder="请输入密码"
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium py-2.5 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed text-sm mt-2"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
                登录中...
              </span>
            ) : "登录"}
          </button>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">如需账号请联系管理员</p>
        <div className="text-center mt-3">
          <a href="/portal.html" className="text-xs text-gray-400 hover:text-gray-600">
            ← 返回导航首页
          </a>
        </div>
      </div>
    </div>
  )
}
