# AI 智能阅卷系统

> 乐清市白石中学 · 本地部署的 AI 辅助试卷批改系统

## 功能特性

| 模块 | 说明 |
|------|------|
| **考试管理** | 创建考试、批量添加题目（选择 / 填空 / 主观）、设置标准答案与评分标准 |
| **答题卡生成** | 在线自制答题卡（A4/A3/B3，真实 cm 单位，打印不变形）；或导入已有模板并手动框定答题区域 |
| **扫描处理** | 支持 JPG / PNG / TIFF / PDF 格式；目录自动监控，检测到文件后立即处理；手动批量处理 |
| **OCR 识别** | EasyOCR 识别学生姓名、学号、班级；选择题泡框识别；填空题 / 主观题文字提取 |
| **自动评分** | 选择题自动判对错；填空题模糊匹配；主观题调用 AI 大模型评分 |
| **AI 评分** | 兼容 OpenAI / DeepSeek / 智谱 AI / 硅基流动等任意 OpenAI 兼容接口 |
| **成绩管理** | 逐题查看识别结果与答题图片，支持人工改分 |
| **分析报告** | 班级总分分布、各题得分率、分数段统计，一键导出 Excel |

## 技术栈

| 层次 | 技术 |
|------|------|
| 后端框架 | Python 3.10+, FastAPI, Uvicorn |
| 数据库 | SQLAlchemy 2.x, SQLite |
| 图像处理 | OpenCV, Pillow, PyMuPDF（PDF转图） |
| OCR | EasyOCR, pyzbar（条形码/二维码） |
| AI 评分 | OpenAI-compatible REST API |
| 报表导出 | openpyxl |
| 前端框架 | React 18, TypeScript, Vite |
| 样式 | Tailwind CSS |
| 图表 | Recharts |

## 快速启动

### 方式一：一键启动（推荐）

```bash
chmod +x start.sh
./start.sh
```

脚本自动创建后端虚拟环境、安装依赖，并同时启动前后端。

### 方式二：分别启动

**后端**
```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

**前端**
```bash
cd frontend
npm install
npm run dev
```

### 访问地址

| 服务 | 地址 |
|------|------|
| 前端界面 | http://localhost:5173 |
| 后端 API 文档 | http://localhost:8001/docs |
| 后端健康检查 | http://localhost:8001/health |

## 目录结构

```
AISS2/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI 入口，路由注册
│   │   ├── models.py                # SQLAlchemy 数据模型
│   │   ├── schemas.py               # Pydantic 请求/响应模型
│   │   ├── database.py              # 数据库连接与会话
│   │   ├── routers/
│   │   │   ├── exams.py             # 考试与题目 CRUD
│   │   │   ├── scans.py             # 扫描上传、处理、目录监控
│   │   │   ├── results.py           # 学生成绩与答案管理
│   │   │   ├── reports.py           # 统计报告与 Excel 导出
│   │   │   └── settings.py          # AI 接口配置
│   │   └── services/
│   │       ├── image_processor.py   # 图像加载、去偏斜、区域裁剪、PDF转图
│   │       ├── ocr_engine.py        # EasyOCR 文字/选项识别
│   │       ├── processor.py         # 扫描处理主流程（编排上述服务）
│   │       ├── ai_grader.py         # 调用大模型对主观题评分
│   │       ├── file_watcher.py      # 目录监控 + 自动触发处理
│   │       └── reporter.py          # 统计计算与报告生成
│   ├── requirements.txt
│   ├── exam_grading.db              # SQLite 数据库（自动创建）
│   ├── answer_images/               # 答题区域裁剪图缓存
│   └── ai_settings.json             # AI 接口配置（自动创建）
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx        # 数据总览首页
│   │   │   ├── ExamList.tsx         # 考试列表
│   │   │   ├── ExamCreate.tsx       # 新建/编辑考试（含答题卡设置）
│   │   │   ├── ExamDetail.tsx       # 考试详情与扫描上传
│   │   │   ├── ScanMonitor.tsx      # 扫描文件监控与批量处理
│   │   │   ├── Results.tsx          # 成绩列表
│   │   │   ├── ResultDetail.tsx     # 学生逐题详情与改分
│   │   │   ├── Reports.tsx          # 分析报告与导出
│   │   │   └── Settings.tsx         # AI 接口配置
│   │   ├── components/
│   │   │   ├── AnswerSheetPreview.tsx    # 答题卡在线生成与打印
│   │   │   ├── TemplateRegionMapper.tsx  # 模板图片答题区域框定
│   │   │   └── SubQuestionEditor.tsx     # 小题编辑器
│   │   ├── api.ts                   # Axios API 客户端
│   │   ├── App.tsx                  # 路由与侧边栏布局
│   │   └── main.tsx                 # React 入口
│   └── package.json
├── start.sh                         # 一键启动脚本
└── README.md
```

## 使用流程

### 1. 新建考试

进入「考试管理」→「新建考试」，填写基本信息后在「题目设置」中批量添加题目：
- **选择题**：设置题号、分值、选项与标准答案
- **填空题**：设置小题数、空格数与标准答案
- **主观题**：设置小题数、分值与 AI 评分标准

### 2. 配置答题卡

在「答题卡」标签页选择：
- **在线自制**：自动排版生成答题卡，选择纸张规格（A4/A3/B3）后点击「打印 / 导出 PDF」
- **导入模板**：上传已有答题卡图片，在图片上手动框选各题答题区域

> 答题区域坐标在保存考试时自动绑定到题目，供后续 OCR 精确裁剪使用。

### 3. 上传 / 监控扫描文件

**手动上传**：在考试详情页直接上传扫描图片（JPG / PNG / PDF）

**目录自动监控**：进入「扫描监控」页面，填写本地目录路径并关联考试，启动后检测到新文件即自动处理

### 4. 查看成绩与 AI 评分

- 「成绩列表」查看每位学生的总分和各题得分
- 点击学生记录查看答题图片与 OCR 识别结果
- 主观题支持点击「AI 评分」或手动输入分数

### 5. 导出报告

进入「分析报告」查看班级总分分布、各题得分率、分数段统计，点击「导出 Excel」获取完整数据表格。

## AI 接口配置

进入「系统设置」页配置 AI 评分接口，支持任意 OpenAI 兼容格式：

| 提供商 | Base URL 示例 |
|--------|--------------|
| OpenAI | `https://api.openai.com/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| 智谱 AI | `https://open.bigmodel.cn/api/paas/v4` |
| 硅基流动 | `https://api.siliconflow.cn/v1` |
| Azure OpenAI | `https://<resource>.openai.azure.com/openai` |

配置项：API Key、Base URL、模型名称。可点击「测试连通性」验证后再保存。

## 数据存储

| 路径 | 内容 |
|------|------|
| `backend/exam_grading.db` | SQLite 主数据库（自动创建） |
| `backend/answer_images/` | 答题区域裁剪图片缓存 |
| `backend/ai_settings.json` | AI 接口配置（自动创建） |

## 环境要求

- **Python** 3.10 或以上
- **Node.js** 18 或以上
- 首次运行时 EasyOCR 会自动下载语言模型（约 500 MB，需要网络）
