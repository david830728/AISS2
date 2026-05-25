import os
import re
import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
from sqlalchemy.orm import Session

from app import models
from app.services.image_processor import ImageProcessor
from app.services.ocr_engine import OCREngine
from app.services.vision_grader import VisionGrader, compute_choices_bbox

def _norm(answer: str) -> str:
    """规范化选择题答案：大写字母按字母序排列，忽略空格。例如 'ba' -> 'AB'。"""
    return "".join(sorted(c for c in answer.upper() if c.isalpha()))


IMAGE_CACHE_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "answer_images"
)
os.makedirs(IMAGE_CACHE_DIR, exist_ok=True)

# 考生信息区固定识别坐标（与前端 AnswerSheetPreview.tsx 中 INFO_* 常量保持一致）
# 坐标格式：相对于页面宽/高 0~1
STUDENT_INFO_REGION: dict = {
    "number": {"x": 0.05, "y": 0.04, "width": 0.20, "height": 0.08},
    "name":   {"x": 0.25, "y": 0.04, "width": 0.20, "height": 0.08},
    "class":  {"x": 0.50, "y": 0.04, "width": 0.20, "height": 0.08},
}


class ExamProcessor:
    def __init__(self, db: Session):
        self.db = db
        self.img_proc = ImageProcessor()
        self.ocr = OCREngine()
        self.vision = VisionGrader()

    @staticmethod
    def _parse_sheet_filename(file_name: str) -> Tuple[Optional[str], Optional[str]]:
        """
        解析文件名获取表单编号和正反面。
        规则：{sheet_id}_{side}.ext，1=正面(A)，2=反面(B)
        示例： 001_1.jpg → ('001', 'A')   001_2.png → ('001', 'B')
        不匹配时返回 (None, None)，回退到 QR 码识别。
        """
        stem = os.path.splitext(file_name or '')[0]
        m = re.match(r'^(.+)_([12])$', stem)
        if m:
            side = 'A' if m.group(2) == '1' else 'B'
            return m.group(1), side
        return None, None

    async def process_scan(self, scan_file: models.ScanFile, exam: models.Exam) -> Dict[str, Any]:
        """
        处理一个扫描文件。
        核心原则：
        - StudentExam 按考号唯一（同一考试同一考号只有一条记录）
        - 正面和反面都往同一条 StudentExam 写答案
        - 每次处理某一面之前，只删除该面题目的旧答案
        - 不管正反面哪个先处理，结果相同
        """
        ext = os.path.splitext(scan_file.file_path)[1].lower()
        if ext == ".pdf":
            raw_pages = self.img_proc.pdf_to_pages(scan_file.file_path)
        else:
            raw = self.img_proc.load_image(scan_file.file_path)
            if raw is None:
                raise ValueError(f"无法读取图像文件: {scan_file.file_path}")
            raw_pages = [raw]

        # 从文件名解析：id_prefix=试卷编号（用作考号匹配键），file_side=A/B
        id_prefix, file_side = self._parse_sheet_filename(scan_file.file_name or '')
        print(f"[process_scan] 文件={scan_file.file_name}  面序={file_side}  考号前缀={id_prefix}")

        tc = exam.template_config or {}
        exam_paper_size: Optional[str] = tc.get("paper_size") if isinstance(tc, dict) else None

        student_exam: Optional[models.StudentExam] = None
        all_graded = True

        for raw_img in raw_pages:
            # ── 图像对齐 ────────────────────────────────────────────────────
            img = self.img_proc.align_by_markers(raw_img, paper_size=exam_paper_size)
            if img.shape[1] not in {2480, 3508, 4961}:
                img = self.img_proc.normalize(img)

            page_label = file_side if file_side is not None else self.img_proc.detect_page_label(img)

            # ── 临时调试：保存带区域标注框的对齐图 ──────────────────────────
            try:
                import cv2 as _cv2, copy as _copy
                _dbg = _copy.deepcopy(img)
                _ih, _iw = _dbg.shape[:2]
                for _cx, _cy in [(108,92), (_iw-108,92), (108,_ih-92), (_iw-108,_ih-92)]:
                    _cv2.drawMarker(_dbg, (_cx,_cy), (255,0,0), _cv2.MARKER_CROSS, 40, 3)
                for _q in exam.questions:
                    def _draw_region(_r, _lbl, _pg=page_label.upper()):
                        if not _r: return
                        if (_r.get('page') or '').upper() not in ('', _pg): return
                        _rx=int(_r.get('x',0)*_iw); _ry=int(_r.get('y',0)*_ih)
                        _rw=int(_r.get('width',1)*_iw); _rh=int(_r.get('height',1)*_ih)
                        _cv2.rectangle(_dbg,(_rx,_ry),(_rx+_rw,_ry+_rh),(0,180,0),3)
                        _cv2.putText(_dbg,str(_lbl),(_rx+5,_ry+40),_cv2.FONT_HERSHEY_SIMPLEX,1.2,(0,180,0),3)
                    _draw_region(_q.region, f"Q{_q.question_number}")
                    for _si,_sq in enumerate(_q.sub_questions or []):
                        if isinstance(_sq,dict): _draw_region(_sq.get('region'), f"Q{_q.question_number}s{_si+1}")
                _dbg_path = f"/tmp/debug_aligned_{scan_file.id}.jpg"
                _cv2.imwrite(_dbg_path, _dbg)
                print(f"[DEBUG] 标注图已保存: {_dbg_path}  尺寸={_iw}×{_ih}")
            except Exception as _e:
                print(f"[DEBUG] 标注图保存失败: {_e}")
            # ── 调试结束 ─────────────────────────────────────────────────────

            # ── 查找或创建 StudentExam（按考号唯一） ─────────────────────────
            if student_exam is None and id_prefix:
                student_exam = (
                    self.db.query(models.StudentExam)
                    .filter_by(exam_id=exam.id, student_number=id_prefix)
                    .first()
                )

            if page_label == "A":
                # A面：识别考生信息
                student_name, student_number, class_name = self._detect_student_info(img)
                scan_file.detected_student_name = student_name
                scan_file.detected_student_id   = student_number
                # 文件名前缀优先于 OCR 考号（保证正反面匹配一致）
                if id_prefix:
                    student_number = id_prefix
                if student_exam is None:
                    student_exam = models.StudentExam(
                        exam_id=exam.id,
                        scan_file_id=scan_file.id,
                        student_name=student_name or f"未识别_{id_prefix}",
                        student_number=student_number,
                        class_name=class_name or exam.class_name,
                        grading_status=models.GradingStatus.PENDING,
                    )
                    self.db.add(student_exam)
                    self.db.flush()
                    self.db.commit()
                    print(f"[process_scan] 新建 SE id={student_exam.id}  考号={student_number}")
                else:
                    # 反面已先处理，用正面信息补全
                    student_exam.student_name = student_name or student_exam.student_name
                    student_exam.class_name   = class_name   or student_exam.class_name or exam.class_name
                    student_exam.scan_file_id = scan_file.id
                    self.db.flush()
                    print(f"[process_scan] 复用 SE id={student_exam.id}，补全考生信息")
            else:
                # B面：不识别考生信息，找已有 SE 或创建占位
                if student_exam is None:
                    student_exam = models.StudentExam(
                        exam_id=exam.id,
                        scan_file_id=scan_file.id,
                        student_name=f"待补全_{id_prefix}",
                        student_number=id_prefix,
                        class_name=exam.class_name,
                        grading_status=models.GradingStatus.PENDING,
                    )
                    self.db.add(student_exam)
                    self.db.flush()
                    self.db.commit()
                    print(f"[process_scan] B面先到，新建占位 SE id={student_exam.id}")
                else:
                    print(f"[process_scan] B面找到已有 SE id={student_exam.id}")

            # ── 获取本面题目 ──────────────────────────────────────────────────
            questions = sorted(exam.questions, key=lambda q: q.order_index)
            # q.page 字段决定题目属于哪一面；未设置则默认 A 面
            page_questions = [
                q for q in questions
                if (q.page or "A").upper() == page_label.upper()
            ]
            if not page_questions:
                if page_label == "A":
                    page_questions = questions  # 兜底：A面处理全部（旧数据无 page 字段）
                else:
                    print(f"[process_scan] {page_label}面无对应题目，跳过")
                    continue

            # ── 只删除本面题目的旧答案，不影响其他面 ─────────────────────────
            q_ids = [q.id for q in page_questions]
            deleted = (
                self.db.query(models.StudentAnswer)
                .filter(
                    models.StudentAnswer.student_exam_id == student_exam.id,
                    models.StudentAnswer.question_id.in_(q_ids),
                )
                .delete(synchronize_session="fetch")
            )
            self.db.flush()
            print(f"[process_scan] 清除 {page_label}面旧答案 {deleted} 条，本面题目数={len(page_questions)}")

            # ── 选择题视觉整体识别 ────────────────────────────────────────────
            choice_qs = [q for q in page_questions if q.question_type == models.QuestionType.CHOICE]
            vision_answers: Dict[int, str] = {}
            if choice_qs and self.vision.is_available():
                vision_answers = await self._process_choices_vision(img, choice_qs) or {}
                print(f"[vision] AI识别结果: {vision_answers}")

            # 选择题整体图截一次，所有选择题共享该路径
            choice_table_image_path: Optional[str] = None
            if choice_qs:
                _ct_region = next(
                    (q.region for q in choice_qs if q.region and q.region.get("region_type") == "choice_table"),
                    choice_qs[0].region if choice_qs else None,
                )
                if _ct_region:
                    _ct_img = self.img_proc.extract_region(img, _ct_region)
                    if _ct_img is not None and _ct_img.size > 0:
                        _ct_dir = os.path.join(IMAGE_CACHE_DIR, f"exam_{exam.id}", f"se_{student_exam.id}")
                        os.makedirs(_ct_dir, exist_ok=True)
                        choice_table_image_path = os.path.join(_ct_dir, "q_choices.jpg")
                        self.img_proc.save_region_image(_ct_img, choice_table_image_path)

            # ── 逐题处理并写入（新建，旧答案已在前面删除） ───────────────────
            for question in page_questions:
                if question.question_type == models.QuestionType.CHOICE:
                    # 选择题只使用整体识别结果，不做逐题 OCR
                    answer   = vision_answers.get(question.question_number)
                    score    = 0.0
                    feedback = None
                    if answer and question.standard_answer:
                        score = question.max_score if (
                            _norm(answer) == _norm(question.standard_answer)
                        ) else 0.0
                    image_path = choice_table_image_path
                else:
                    answer, score, image_path, feedback = await self._process_question(
                        img, question, student_exam.id
                    )

                is_correct = None
                if question.question_type == models.QuestionType.CHOICE and question.standard_answer:
                    is_correct = _norm(answer or "") == _norm(question.standard_answer)

                grading_status = models.GradingStatus.AUTO_GRADED
                if question.question_type in (
                    models.QuestionType.SUBJECTIVE,
                    models.QuestionType.FILL,
                ) and score is None:
                    grading_status = models.GradingStatus.PENDING
                    all_graded = False

                self.db.add(models.StudentAnswer(
                    student_exam_id=student_exam.id,
                    question_id    =question.id,
                    recognized_answer=answer,
                    score          =score,
                    is_correct     =is_correct,
                    ai_feedback    =feedback,
                    grading_status =grading_status,
                    answer_image_path=image_path,
                ))

        if student_exam is None:
            raise ValueError("未能从扫描文件中创建任何 StudentExam")

        # ── 重算总分（含其他面已有答案） ─────────────────────────────────────
        self.db.flush()
        all_ans = self.db.query(models.StudentAnswer).filter_by(
            student_exam_id=student_exam.id
        ).all()
        student_exam.total_score    = sum(a.score or 0.0 for a in all_ans)
        student_exam.grading_status = (
            models.GradingStatus.PENDING if not all_graded
            else models.GradingStatus.COMPLETED
        )

        scan_file.status       = models.ScanStatus.COMPLETED
        scan_file.processed_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(student_exam)

        return {"student_exam_id": student_exam.id, "total_score": student_exam.total_score}

    async def _process_choices_vision(
        self, img, choice_qs
    ) -> Optional[Dict[int, str]]:
        """截取选择题整体表格区域，调用视觉模型一次性识别。"""
        print(f"[vision] is_available={self.vision.is_available()} settings={list(self.vision.settings.keys())}")
        first = choice_qs[0] if choice_qs else None
        if first and first.region and first.region.get("region_type") == "choice_table":
            table_region = first.region
            q_numbers = table_region.get("question_numbers") or [q.question_number for q in choice_qs]
        else:
            table_region = compute_choices_bbox(choice_qs, img.shape)
            q_numbers = [q.question_number for q in choice_qs]
        if table_region is None:
            print(f"[vision] 无法确定选择题表格区域，跳过视觉识别")
            return None
        region_img = self.img_proc.extract_region(img, table_region)
        print(f"[vision] 选择题整体截图尺寸: {region_img.shape}  题号={q_numbers}")
        return await self.vision.recognize_choices_by_vision(region_img, q_numbers)

    def _detect_student_info(self, img):
        """A面专用：从硬编码地址 STUDENT_INFO_REGION 识别考号/姓名/班级。"""
        student_name = None
        student_number = None
        class_name = None

        number_img = self.img_proc.extract_region(img, STUDENT_INFO_REGION["number"])
        name_img   = self.img_proc.extract_region(img, STUDENT_INFO_REGION["name"])
        class_img  = self.img_proc.extract_region(img, STUDENT_INFO_REGION["class"])

        student_number = self.ocr.recognize_student_id(number_img)
        student_name   = self.ocr.recognize_student_name(name_img)
        class_name     = self.ocr.recognize_text(class_img)

        # QR码优先于 OCR 识别的考号
        barcode = self.img_proc.detect_barcode_or_qr(img)
        if barcode:
            student_number = barcode

        return student_name, student_number, class_name

    async def _process_question(self, img, question: models.ExamQuestion, student_exam_id: int):
        sub_qs = question.sub_questions or []

        # 有效区域：主 region 优先；否则从 sub_questions 计算包围盒
        effective_region = question.region
        if effective_region is None and sub_qs:
            sq_regions = [
                sq.get('region') for sq in sub_qs
                if isinstance(sq, dict) and sq.get('region')
            ]
            if sq_regions:
                min_x = min(r['x'] for r in sq_regions)
                min_y = min(r['y'] for r in sq_regions)
                max_x = max(r['x'] + r['width']  for r in sq_regions)
                max_y = max(r['y'] + r['height'] for r in sq_regions)
                effective_region = {'x': min_x, 'y': min_y,
                                    'width': max_x - min_x, 'height': max_y - min_y}

        region_img = None
        if effective_region:
            region_img = self.img_proc.extract_region(img, effective_region)
            h, w = img.shape[:2]
            x  = int(effective_region.get('x', 0)     * w)
            y  = int(effective_region.get('y', 0)     * h)
            rw = int(effective_region.get('width', 1)  * w)
            rh = int(effective_region.get('height', 1) * h)
            print(f"[DEBUG] 题{question.question_number} region={effective_region} "
                  f"→ 实际像素 x={x} y={y} w={rw} h={rh} "
                  f"图片尺寸={w}×{h}")

        answer = None
        score = None
        feedback = None
        image_path = None

        if region_img is not None and region_img.size > 0:
            save_dir = os.path.join(IMAGE_CACHE_DIR, f"exam_{question.exam_id}", f"se_{student_exam_id}")
            os.makedirs(save_dir, exist_ok=True)
            image_path = os.path.join(save_dir, f"q_{question.question_number}.jpg")
            self.img_proc.save_region_image(region_img, image_path)

        if question.question_type == models.QuestionType.CHOICE:
            options = question.answer_options or ["A", "B", "C", "D"]
            if region_img is not None:
                answer = self.ocr.recognize_choice_answer(region_img, options)
            if answer and question.standard_answer:
                is_right = answer.upper().strip() == question.standard_answer.upper().strip()
                score = question.max_score if is_right else 0.0

        elif question.question_type == models.QuestionType.FILL:
            # 与主观题相同策略：OCR 存文字供参考，score=None 留给 AI/手工批改
            if region_img is not None:
                answer = self.ocr.recognize_fill_answer(region_img)
            score = None

        elif question.question_type == models.QuestionType.SUBJECTIVE:
            if region_img is not None:
                answer = self.ocr.recognize_subjective_answer(region_img)
            score = None

        return answer, score, image_path, feedback

    def _score_fill_answer(self, student_answer: str, standard_answer: str, max_score: float) -> float:
        s = student_answer.strip().lower().replace(" ", "")
        std = standard_answer.strip().lower().replace(" ", "")
        if s == std:
            return max_score
        if std in s or s in std:
            return max_score * 0.5
        return 0.0
