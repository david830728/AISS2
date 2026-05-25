#!/bin/bash
# AI阅卷系统 - 一键启动脚本

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"

echo "=============================="
echo "  AI阅卷系统 启动中..."
echo "=============================="

# 检查 Python 虚拟环境
if [ ! -d "$BACKEND_DIR/venv" ]; then
  echo "[后端] 创建虚拟环境..."
  python3 -m venv "$BACKEND_DIR/venv"
fi

# 安装后端依赖
echo "[后端] 检查/安装依赖..."
source "$BACKEND_DIR/venv/bin/activate"
pip install -q -r "$BACKEND_DIR/requirements.txt"

# 检查前端依赖
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "[前端] 安装依赖..."
  cd "$FRONTEND_DIR" && npm install
fi

# 启动后端（后台）
echo "[后端] 启动 FastAPI (http://localhost:8001)..."
cd "$BACKEND_DIR"
source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload &
BACKEND_PID=$!
echo "[后端] PID: $BACKEND_PID"

# 等待后端启动
sleep 2

# 启动前端（后台）
echo "[前端] 启动 Vite Dev Server (http://localhost:5173)..."
cd "$FRONTEND_DIR"
npm run dev &
FRONTEND_PID=$!
echo "[前端] PID: $FRONTEND_PID"

echo ""
echo "=============================="
echo "  系统已启动！"
echo "  前端地址: http://localhost:5173"
echo "  API文档:  http://localhost:8000/docs"
echo "=============================="
echo ""
echo "按 Ctrl+C 停止所有服务..."

# 捕获退出信号
trap "echo '正在停止...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM

wait
