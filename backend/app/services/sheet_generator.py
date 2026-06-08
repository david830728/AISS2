"""
答题卡 PDF 批量生成服务（HTML → weasyprint → 叠加 QR）

流程：
  1. generate_exam_html(exam)  → 与前端 AnswerSheetPreview.tsx 一致的基础 HTML（不含 QR/考生值）
  2. html_to_base_pdf(html)    → weasyprint 转 PDF（2 页：A面 + B面）
  3. _make_qr_overlay_page(…)  → reportlab 生成单页叠加层（QR + 考生信息文字）
  4. generate_answer_sheets(…) → pypdf 逐考生合并，写入最终 PDF 文件
"""
import io
import math
import os
import qrcode
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

# ── 布局常量（与前端 AnswerSheetPreview.tsx 保持一致）─────────────────────────

PAGE_W, PAGE_H = A4        # 595.28 × 841.89 pt

INFO_X = 0.05              # 考生信息区左边距比例
INFO_Y = 0.04              # 考生信息区顶边距比例
INFO_H = 0.08              # 考生信息区高度比例
QR_SIZE = 50               # pt

# QR 叠加坐标（reportlab 坐标系，原点左下角）
# 与前端 info-area 中 margin-left:auto 的 QR placeholder 位置一致
_QR_X = PAGE_W * (1 - INFO_X) - QR_SIZE         # ≈ 515.5 pt
_QR_Y = PAGE_H - PAGE_H * INFO_Y - QR_SIZE      # ≈ 758.2 pt（从底部）
# 考生信息文字基线 Y（info 区中线）
_INFO_MID_Y = PAGE_H - PAGE_H * (INFO_Y + INFO_H / 2)  # ≈ 774.5 pt

ANSWER_SHEETS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "answer_sheets"
)

# CJK 字体注册（用于 reportlab 叠加层中文文字）
try:
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    _CJK_FONT = "STSong-Light"
except Exception:
    _CJK_FONT = "Helvetica"


# ── 工具函数 ────────────────────────────────────────────────────────────────

def _qr_png(content: str) -> io.BytesIO:
    """生成 QR 码 PNG 字节流。"""
    qr = qrcode.QRCode(
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=4, border=1,
    )
    qr.add_data(content)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


# ── 叠加层生成（reportlab）────────────────────────────────────────────────────

def _make_qr_overlay_page(exam_id: int, student, page_label: str) -> bytes:
    """
    生成单页叠加 PDF：包含 QR 码（两页均有）和考生信息文字（仅 A 面）。
    reportlab 坐标系原点在左下角。
    """
    buf = io.BytesIO()
    c = Canvas(buf, pagesize=A4)

    # QR 码（右侧考生信息栏内，与前端 placeholder 位置一致）
    qr_content = f"{exam_id}_{student.student_number}_{page_label}"
    c.drawImage(ImageReader(_qr_png(qr_content)),
                _QR_X, _QR_Y, width=QR_SIZE, height=QR_SIZE)

    # 考生信息文字（仅 A 面）
    if page_label == "A":
        c.setFont(_CJK_FONT, 9)
        c.setFillColorRGB(0.1, 0.1, 0.1)
        left = PAGE_W * INFO_X + 12          # info 区左内边距后起始
        # 学号 underline 宽 90pt，gap 24pt，label 约 30pt；以下偏移匹配前端 flex 布局
        c.drawString(left + 30,  _INFO_MID_Y - 4, student.student_number or "")
        c.drawString(left + 30 + 90 + 24 + 30, _INFO_MID_Y - 4, student.student_name or "")
        c.drawString(left + 30 + 90 + 24 + 30 + 70 + 24 + 30, _INFO_MID_Y - 4, student.class_name or "")

    c.save()
    buf.seek(0)
    return buf.getvalue()


# ── 布局算法常量（与 AnswerSheetPreview.tsx 保持一致）──────────────────────────
# A4 页高（pt），正反面内容区起始比例
_A4_H_PT       = 29.7 * (72 / 2.54)   # ≈ 841.89 pt
_FRONT_COL_H   = _A4_H_PT * (0.97 - 0.13)  # ≈ 707 pt
_BACK_COL_H    = _A4_H_PT * (0.97 - 0.07)  # ≈ 758 pt
_CHOICE_PER_ROW = 5
_CHOICE_NUM_H   = 24   # pt，题号行高
_CHOICE_ANS_H   = 32   # pt，答题行高


def _est_choices_h(questions) -> float:
    """估算选择题区域总高度（pt），与前端 estChoicesH 一致。"""
    return 48 + math.ceil(len(questions) / _CHOICE_PER_ROW) * (_CHOICE_NUM_H + _CHOICE_ANS_H) + 16


def _est_fills_h(questions) -> float:
    """估算填空题区域总高度（pt），与前端 estFillsH 一致。"""
    h = 60.0
    for q in questions:
        h += 20
        subs = q.sub_questions or []
        if subs:
            n = sum(sq.get('blank_count', 1) if isinstance(sq, dict) else 1 for sq in subs)
        else:
            n = 1
        h += n * 26
    return h + 20


def _est_subj_h(q) -> float:
    """估算单道主观题区域总高度（pt），与前端 estSubjH 一致。"""
    lines = q.answer_lines or 8
    box_h = lines * 24 + 16
    h = 60.0
    subs = q.sub_questions or []
    if subs:
        h += len(subs) * (20 + box_h)
    else:
        h += box_h
    return h + 20


def compute_page_split(questions):
    """
    使用与前端 buildBlocks + distributeBlocks 相同的高度溢出算法，
    将题目分配到 A/B 面，并同步更新每道题的 page 属性。
    返回 (qs_a, qs_b)。
    """
    all_qs  = sorted(questions, key=lambda q: q.order_index)
    choices = [q for q in all_qs if q.question_type == "choice"]
    fills   = [q for q in all_qs if q.question_type == "fill"]
    subjs   = [q for q in all_qs if q.question_type == "subjective"]

    blocks = []
    if choices:
        blocks.append({'qs': choices, 'estH': _est_choices_h(choices)})
    if fills:
        blocks.append({'qs': fills,   'estH': _est_fills_h(fills)})
    for q in subjs:
        blocks.append({'qs': [q],     'estH': _est_subj_h(q)})

    col_heights = [_FRONT_COL_H, _BACK_COL_H]
    cols: list[list] = [[] for _ in col_heights]
    ci, used = 0, 0.0
    for b in blocks:
        while ci < len(col_heights) - 1 and used + b['estH'] > col_heights[ci]:
            ci += 1
            used = 0.0
        cols[ci].append(b)
        used += b['estH']

    qs_a = [q for b in cols[0] for q in b['qs']]
    qs_b = [q for b in (cols[1] if len(cols) > 1 else []) for q in b['qs']]

    for q in qs_a:
        q.page = "A"
    for q in qs_b:
        q.page = "B"

    return qs_a, qs_b


# ── HTML 生成 ────────────────────────────────────────────────────────────────

def generate_exam_html(exam) -> tuple[str, str]:
    """
    生成答题卡基础 HTML（不含 QR 码和考生信息值）。
    返回 (A面HTML, B面HTML) 元组。
    使用与前端预览相同的高度溢出算法分面，确保 PDF 与预览始终一致。
    同时将分面结果回写到每道题的 page 属性（供扫描识别使用）。
    """
    qs_a, qs_b = compute_page_split(exam.questions or [])

    exam_name = exam.name or exam.subject or "答题卡"
    front = _page_html(exam_name, qs_a, is_front=True)
    back  = _page_html(exam_name, qs_b, is_front=False)
    css = _css()
    html_a = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8">
<style>{css}</style>
</head>
<body>{front}</body>
</html>"""
    html_b = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8">
<style>{css}</style>
</head>
<body>{back}</body>
</html>"""
    return html_a, html_b


def _css() -> str:
    return """
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Noto Sans CJK SC','Microsoft YaHei',SimSun,serif; }
.page {
  width: 595.28pt; height: 841.89pt;
  position: relative; overflow: hidden;
  background: #fff;
}
.mk { position: absolute; width: 24pt; height: 16pt; background: #000; }
.mk-tl { top: 14pt; left: 14pt; }
.mk-tr { top: 14pt; right: 14pt; }
.mk-bl { bottom: 14pt; left: 14pt; }
.mk-br { bottom: 14pt; right: 14pt; }
.info-area {
  position: absolute; left: 5%; top: 4%; width: 90%; height: 8%;
  border: 1pt solid #000;
  display: flex; align-items: center; padding: 0 12pt; gap: 24pt;
  font-size: 10pt;
}
.info-field { display: inline-flex; align-items: flex-end; gap: 3pt; white-space: nowrap; }
.uline { display: inline-block; border-bottom: 1pt solid #000; }
.qr-ph { width: 50pt; height: 50pt; margin-left: auto; flex-shrink: 0; }
.title-bar {
  position: absolute; left: 5%; width: 90%;
  text-align: center; font-weight: bold;
}
.content { position: absolute; left: 5%; right: 5%; overflow: visible; }
.sbox {
  border: 1pt solid #000; border-radius: 2pt;
  padding: 8pt 10pt; margin-bottom: 10pt;
  break-inside: avoid;
}
.stitle {
  font-weight: bold; font-size: 13pt;
  margin-bottom: 6pt; border-bottom: 1pt solid #000; padding-bottom: 5pt;
}
.chtable { width: 100%; border: 1pt solid #000; border-bottom: none; }
.ch-num-row, .ch-ans-row { display: grid; }
.ch-num-cell {
  text-align: center; font-size: 9pt;
  height: 24pt; line-height: 24pt;
  background: #f0f0f0; border-right: 0.5pt solid #bbb;
}
.ch-ans-cell { height: 32pt; border-right: 0.5pt solid #bbb; }
.ch-num-row { border-bottom: 0.5pt solid #bbb; }
.ch-ans-row { border-bottom: 1pt solid #000; }
.fill-blank { display: inline-block; border-bottom: 1pt solid #000; width: 90pt; margin-right: 6pt; }
.subj-lined {
  border: 1pt solid #000; width: 100%;
  background: repeating-linear-gradient(to bottom,#fff,#fff 23pt,#ccc 23pt,#ccc 24pt);
}
.subj-title { font-weight: bold; margin-bottom: 5pt; border-bottom: 1pt solid #ddd; padding-bottom: 4pt; font-size: 12pt; }
"""


def _page_html(exam_name: str, questions, is_front: bool) -> str:
    content_top = "13%" if is_front else "7%"
    title_top   = "1%"
    title_size  = "15pt" if is_front else "13pt"
    title_text  = f"{exam_name} 答题卡" if is_front else f"{exam_name} 答题卡（反面）"

    choice_qs = [q for q in questions if q.question_type == "choice"]
    fill_qs   = [q for q in questions if q.question_type == "fill"]
    subj_qs   = [q for q in questions if q.question_type == "subjective"]

    body = ""
    if choice_qs: body += _html_choices(choice_qs)
    if fill_qs:   body += _html_fills(fill_qs)
    for q in subj_qs: body += _html_subj(q)
    if not body and not is_front:
        body = '<div class="subj-lined" style="height:700pt;display:flex;align-items:center;' \
               'justify-content:center;color:#bbb;font-size:14pt;">草稿区 / 附加答题区</div>'

    if is_front:
        info_html = """
  <div class="info-area">
    <span class="info-field">学号：<span class="uline" style="min-width:90pt;"></span></span>
    <span class="info-field">姓名：<span class="uline" style="min-width:70pt;"></span></span>
    <span class="info-field">班级：<span class="uline" style="min-width:70pt;"></span></span>
    <div class="qr-ph"></div>
  </div>"""
    else:
        info_html = '\n  <div style="position:absolute;top:4%;right:5%;width:50pt;height:50pt;" class="qr-ph"></div>'

    return f"""
<div class="page">
  <div class="mk mk-tl"></div><div class="mk mk-tr"></div>
  <div class="mk mk-bl"></div><div class="mk mk-br"></div>
{info_html}
  <div class="title-bar" style="top:{title_top};font-size:{title_size};">{title_text}</div>
  <div class="content" style="top:{content_top};bottom:2%;">
{body}
  </div>
</div>"""


def _html_choices(questions) -> str:
    cols = 5
    rows = [questions[i:i+cols] for i in range(0, len(questions), cols)]
    total = sum(q.max_score for q in questions)
    per   = questions[0].max_score if questions else 0
    rows_html = ""
    for row in rows:
        n = len(row)
        gc = f"repeat({n},1fr)"
        nums = "".join(f'<div class="ch-num-cell" style="grid-column:{i+1}">{q.question_number}</div>'
                       for i, q in enumerate(row))
        ans  = "".join(f'<div class="ch-ans-cell" style="grid-column:{i+1}"></div>'
                       for i, q in enumerate(row))
        rows_html += f'<div class="ch-num-row" style="grid-template-columns:{gc}">{nums}</div>' \
                     f'<div class="ch-ans-row" style="grid-template-columns:{gc}">{ans}</div>'
    return f'<div class="sbox"><div class="stitle">一、选择题（每题 {per} 分，共 {total} 分）</div>' \
           f'<div class="chtable">{rows_html}</div></div>'


def _html_fills(questions) -> str:
    total = sum(q.max_score for q in questions)
    items = ""
    for q in questions:
        subs = q.sub_questions or []
        if subs:
            blanks = ""
            for sq in subs:
                lbl = sq.get("label","") if isinstance(sq,dict) else ""
                cnt = sq.get("blank_count",1) if isinstance(sq,dict) else 1
                line = '<span class="fill-blank"></span>' * cnt
                blanks += f'<div style="display:flex;align-items:flex-end;gap:6pt;margin-bottom:6pt;padding-left:18pt;">' \
                           f'<span style="min-width:24pt;font-size:10pt;">{lbl}</span>{line}</div>'
        else:
            blanks = '<div style="padding-left:18pt;"><span class="fill-blank" style="width:200pt;"></span></div>'
        items += f'<div style="margin-bottom:8pt;"><div style="margin-bottom:4pt;font-size:11pt;">' \
                 f'{q.question_number}. {q.title or f"第{q.question_number}题"}</div>{blanks}</div>'
    return f'<div class="sbox"><div class="stitle">二、填空题（共 {total} 分）</div>{items}</div>'


def _html_subj(q) -> str:
    subs   = q.sub_questions or []
    lines  = q.answer_lines or 8
    box_h  = lines * 24 + 16
    content = ""
    if subs:
        for sq in subs:
            lbl   = sq.get("label","") if isinstance(sq,dict) else ""
            score = sq.get("max_score",0) if isinstance(sq,dict) else 0
            content += f'<div style="margin-bottom:8pt;"><div style="margin-bottom:4pt;color:#333;font-size:11pt;">' \
                       f'{lbl}（{score} 分）</div>' \
                       f'<div class="subj-lined" style="height:{box_h}pt;"></div></div>'
    else:
        content = f'<div class="subj-lined" style="height:{box_h}pt;"></div>'
    return f'<div class="sbox" style="margin-bottom:10pt;">' \
           f'<div class="subj-title">{q.question_number}. {q.title or f"第{q.question_number}题"}（共 {q.max_score} 分）</div>' \
           f'{content}</div>'


# ── weasyprint 转换 ──────────────────────────────────────────────────────────

def html_to_base_pdf(html_content: str) -> bytes:
    """weasyprint HTML → PDF 字节流（包含 A面 + B面 共 2 页）。"""
    from weasyprint import HTML
    return HTML(string=html_content).write_pdf()


def html_to_page_pdf(html_content: str) -> bytes:
    """weasyprint HTML → 单页 PDF 字节流。"""
    from weasyprint import HTML
    return HTML(string=html_content).write_pdf()


# ── 主入口 ───────────────────────────────────────────────────────────────────

def generate_answer_sheets(
    exam,
    students: list,
    layout: str = "by_student",
    paper_size: str = "A4",
) -> str:
    """
    批量生成所有考生的答题卡 PDF。
    layout: 'by_student'（默认，A+B 成对）或 'by_side'（所有A面后接所有B面）
    返回保存路径。
    """
    from pypdf import PdfReader, PdfWriter

    os.makedirs(os.path.join(ANSWER_SHEETS_DIR, f"exam_{exam.id}"), exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = os.path.join(ANSWER_SHEETS_DIR, f"exam_{exam.id}",
                            f"answer_sheet_{exam.id}_{ts}.pdf")

    # 1. 生成基础 PDF（A面和B面分别生成，避免WeasyPrint分页问题）
    html_a, html_b = generate_exam_html(exam)
    base_bytes_a = html_to_page_pdf(html_a)
    base_bytes_b = html_to_page_pdf(html_b)

    # 2. 逐考生叠加专属 QR + 信息
    writer = PdfWriter()

    def _add(student, label: str):
        base_bytes = base_bytes_a if label == "A" else base_bytes_b
        reader = PdfReader(io.BytesIO(base_bytes))
        pg = reader.pages[0]
        overlay = PdfReader(io.BytesIO(_make_qr_overlay_page(exam.id, student, label))).pages[0]
        pg.merge_page(overlay)
        writer.add_page(pg)

    if layout == "by_side":
        for s in students: _add(s, "A")
        for s in students: _add(s, "B")
    else:
        for s in students:
            _add(s, "A")
            _add(s, "B")

    with open(out_path, "wb") as f:
        writer.write(f)

    return out_path
