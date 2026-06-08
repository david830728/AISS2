import asyncio
import os
import re
from datetime import datetime
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional, Dict
from app.database import get_db
from app import models, schemas
from app.auth import get_current_user

# ── 进程内任务进度表（重启后重置）─────────────────────────────────────────────
_grade_tasks: Dict[str, Dict] = {}


def _effective_standard_answer(q: models.ExamQuestion) -> Optional[str]:
    """若题目 standard_answer 为空（有子题时前端清空了），从 sub_questions 拼接还原。
    填空题答案存在 blank_answers 列表；主观题答案存在 standard_answer 字段。
    """
    if q.standard_answer:
        return q.standard_answer
    sub_qs = q.sub_questions or []
    parts = []
    for sq in sub_qs:
        if not isinstance(sq, dict):
            continue
        # 填空题：blank_answers 优先
        blanks = [str(b) for b in (sq.get("blank_answers") or []) if b]
        if blanks:
            parts.append("; ".join(blanks))
        elif sq.get("standard_answer"):
            parts.append(sq["standard_answer"])
    return " | ".join(parts) if parts else None

router = APIRouter(prefix="/api/results", tags=["results"], dependencies=[Depends(get_current_user)])


@router.get("/exam/{exam_id}", response_model=List[schemas.StudentExamSummary])
def list_student_results(
    exam_id: int,
    class_name: Optional[str] = None,
    db: Session = Depends(get_db)
):
    query = db.query(models.StudentExam).filter(models.StudentExam.exam_id == exam_id)
    if class_name:
        query = query.filter(models.StudentExam.class_name == class_name)
    return query.order_by(models.StudentExam.total_score.desc()).all()


@router.get("/student-exam/{student_exam_id}", response_model=schemas.StudentExamOut)
def get_student_exam_detail(student_exam_id: int, db: Session = Depends(get_db)):
    se = db.query(models.StudentExam).options(
        joinedload(models.StudentExam.answers).joinedload(models.StudentAnswer.question)
    ).filter(models.StudentExam.id == student_exam_id).first()
    if not se:
        raise HTTPException(status_code=404, detail="记录不存在")

    answers_out = []
    for ans in se.answers:
        q = ans.question
        answers_out.append(schemas.StudentAnswerOut(
            id=ans.id,
            question_id=q.id,
            question_number=q.question_number,
            question_type=q.question_type,
            max_score=q.max_score,
            recognized_answer=ans.recognized_answer,
            standard_answer=_effective_standard_answer(q),
            score=ans.score,
            ai_feedback=ans.ai_feedback,
            is_correct=ans.is_correct,
            grading_status=ans.grading_status,
            answer_image_path=ans.answer_image_path,
        ))

    return schemas.StudentExamOut(
        id=se.id,
        exam_id=se.exam_id,
        student_name=se.student_name,
        student_number=se.student_number,
        class_name=se.class_name,
        total_score=se.total_score,
        grading_status=se.grading_status,
        created_at=se.created_at,
        answers=sorted(answers_out, key=lambda a: a.question_number),
    )


@router.put("/answer/{answer_id}", response_model=dict)
def update_answer_score(
    answer_id: int,
    update: schemas.ManualScoreUpdate,
    db: Session = Depends(get_db)
):
    ans = db.query(models.StudentAnswer).filter(models.StudentAnswer.id == answer_id).first()
    if not ans:
        raise HTTPException(status_code=404, detail="答案记录不存在")

    ans.score = update.score
    if update.feedback:
        ans.ai_feedback = update.feedback
    ans.grading_status = models.GradingStatus.MANUAL_GRADED

    se = db.query(models.StudentExam).filter(models.StudentExam.id == ans.student_exam_id).first()
    if se:
        all_answers = db.query(models.StudentAnswer).filter(
            models.StudentAnswer.student_exam_id == se.id
        ).all()
        total = sum(a.score for a in all_answers if a.score is not None)
        se.total_score = total
        all_graded = all(a.grading_status != models.GradingStatus.PENDING for a in all_answers)
        if all_graded:
            se.grading_status = models.GradingStatus.COMPLETED

    db.commit()
    return {"success": True, "new_total": se.total_score if se else None}


@router.post("/ai-grade/{student_exam_id}/{question_id}", response_model=dict)
async def ai_grade_answer(
    student_exam_id: int,
    question_id: int,
    db: Session = Depends(get_db)
):
    from app.services.ai_grader import AIGrader
    ans = db.query(models.StudentAnswer).filter(
        models.StudentAnswer.student_exam_id == student_exam_id,
        models.StudentAnswer.question_id == question_id
    ).first()
    if not ans:
        raise HTTPException(status_code=404, detail="答案记录不存在")

    q = db.query(models.ExamQuestion).filter(models.ExamQuestion.id == question_id).first()
    grader = AIGrader()

    question_text = _effective_standard_answer(q) or ""
    criteria = q.grading_criteria or ""
    if not criteria and q.sub_questions:
        criteria = "\n".join(
            f"{sq.get('label','')} {sq.get('grading_criteria','')}"
            for sq in (q.sub_questions or [])
            if isinstance(sq, dict) and sq.get("grading_criteria")
        )

    if ans.answer_image_path and os.path.exists(ans.answer_image_path):
        result = await grader.grade_with_image(
            question_text=question_text,
            criteria=criteria,
            max_score=q.max_score,
            image_path=ans.answer_image_path,
        )
        if result.get("recognized_text"):
            ans.recognized_answer = result["recognized_text"]
    else:
        result = await grader.grade(
            question_text=question_text,
            student_answer=ans.recognized_answer or "",
            criteria=criteria,
            max_score=q.max_score,
        )

    ans.score = result.get("score", 0)
    ans.ai_feedback = result.get("feedback", "")
    ans.grading_status = models.GradingStatus.AI_GRADED

    se = db.query(models.StudentExam).filter(models.StudentExam.id == student_exam_id).first()
    if se:
        all_answers = db.query(models.StudentAnswer).filter(
            models.StudentAnswer.student_exam_id == se.id
        ).all()
        se.total_score = sum(a.score for a in all_answers if a.score is not None)

    db.commit()
    return {
        "success": True,
        "score": ans.score,
        "feedback": ans.ai_feedback,
        "recognized_text": result.get("recognized_text"),
    }


@router.post("/merge-sheets/{exam_id}", response_model=dict)
def merge_sheets(exam_id: int, db: Session = Depends(get_db)):
    """将同一考试中 sheet_id 相同的重复 StudentExam 合并为一条（正反面合并）。"""
    all_ses = db.query(models.StudentExam).filter(
        models.StudentExam.exam_id == exam_id,
    ).all()

    # 对 sheet_id 为空的记录，尝试从 scan_file 文件名推断
    for se in all_ses:
        if not se.sheet_id and se.scan_file_id:
            sf = db.query(models.ScanFile).filter(models.ScanFile.id == se.scan_file_id).first()
            if sf:
                stem = os.path.splitext(sf.file_name or '')[0]
                m = re.match(r'^(.+)_([12])$', stem)
                if m:
                    se.sheet_id = m.group(1)
    db.flush()

    groups: Dict[str, list] = {}
    for se in all_ses:
        if se.sheet_id:
            groups.setdefault(se.sheet_id, []).append(se)

    def _is_real_name(name: Optional[str]) -> bool:
        if not name:
            return False
        stripped = name.strip()
        return bool(stripped) and not stripped.startswith("未识别") and stripped != ""

    merged_count = 0
    for sid, group in groups.items():
        if len(group) <= 1:
            continue
        # 优先选有真实姓名的记录作为主记录
        primary = sorted(group, key=lambda x: (not _is_real_name(x.student_name), not bool(x.student_number), x.id))[0]
        duplicates = [se for se in group if se.id != primary.id]

        # 从副本中补全主记录的考生信息
        for dup in duplicates:
            if not _is_real_name(primary.student_name) and _is_real_name(dup.student_name):
                primary.student_name = dup.student_name
            if not primary.student_number and dup.student_number:
                primary.student_number = dup.student_number
            if not primary.class_name and dup.class_name:
                primary.class_name = dup.class_name

        existing_qids = {a.question_id for a in primary.answers}
        for dup in duplicates:
            dup_answers = db.query(models.StudentAnswer).filter(
                models.StudentAnswer.student_exam_id == dup.id
            ).all()
            for ans in dup_answers:
                if ans.question_id not in existing_qids:
                    ans.student_exam_id = primary.id
                    existing_qids.add(ans.question_id)
                else:
                    prim_ans = next((a for a in primary.answers if a.question_id == ans.question_id), None)
                    if prim_ans and prim_ans.score is None and ans.score is not None:
                        prim_ans.score = ans.score
                        prim_ans.ai_feedback = ans.ai_feedback
                        prim_ans.grading_status = ans.grading_status
            db.flush()
            db.delete(dup)
            merged_count += 1

        db.flush()
        all_ans = db.query(models.StudentAnswer).filter(
            models.StudentAnswer.student_exam_id == primary.id
        ).all()
        primary.total_score = sum(a.score for a in all_ans if a.score is not None)
        statuses = {a.grading_status for a in all_ans}
        if models.GradingStatus.PENDING in statuses:
            primary.grading_status = models.GradingStatus.PENDING
        else:
            primary.grading_status = models.GradingStatus.COMPLETED

    db.commit()
    return {"merged": merged_count}


@router.post("/ai-grade-all/{student_exam_id}", response_model=dict)
async def ai_grade_all(student_exam_id: int, db: Session = Depends(get_db)):
    """一键批改所有题目：选择题用AI视觉识别选项，其他题用多模态识图打分。"""
    from app.services.ai_grader import AIGrader
    se = db.query(models.StudentExam).filter(models.StudentExam.id == student_exam_id).first()
    if not se:
        raise HTTPException(status_code=404, detail="记录不存在")

    all_answers = db.query(models.StudentAnswer).join(
        models.ExamQuestion,
        models.StudentAnswer.question_id == models.ExamQuestion.id,
    ).filter(models.StudentAnswer.student_exam_id == student_exam_id).all()

    grader = AIGrader()
    graded_count = 0

    for ans in all_answers:
        q = ans.question
        if not q:
            continue
        if q.question_type == models.QuestionType.CHOICE:
            continue
        try:
            question_text = _effective_standard_answer(q) or ""
            criteria = q.grading_criteria or ""
            if not criteria and q.sub_questions:
                criteria = "\n".join(
                    f"{sq.get('label','')} {sq.get('grading_criteria','')}"
                    for sq in (q.sub_questions or [])
                    if isinstance(sq, dict) and sq.get("grading_criteria")
                )
            if ans.answer_image_path and os.path.exists(ans.answer_image_path):
                result = await grader.grade_with_image(
                    question_text=question_text,
                    criteria=criteria,
                    max_score=q.max_score,
                    image_path=ans.answer_image_path,
                )
                if result.get("recognized_text"):
                    ans.recognized_answer = result["recognized_text"]
            else:
                result = await grader.grade(
                    question_text=question_text,
                    student_answer=ans.recognized_answer or "",
                    criteria=criteria,
                    max_score=q.max_score,
                )
            ans.score = result.get("score", 0)
            ans.ai_feedback = result.get("feedback", "")
            ans.grading_status = models.GradingStatus.AI_GRADED
            graded_count += 1
        except Exception as e:
            print(f"[ai_grade_all] 题目 {q.question_number} 批改失败: {e}")

    db.flush()
    all_ans = db.query(models.StudentAnswer).filter(
        models.StudentAnswer.student_exam_id == se.id
    ).all()
    se.total_score = sum(a.score for a in all_ans if a.score is not None)
    if all(a.grading_status != models.GradingStatus.PENDING for a in all_ans):
        se.grading_status = models.GradingStatus.COMPLETED
    db.commit()
    return {"graded": graded_count, "total_score": se.total_score}


# ── 全考试一键AI批改 ──────────────────────────────────────────────────────────

async def _run_grade_all_exam(exam_id: int, task_id: str):
    """后台任务：批改指定考试所有学生的填空/主观题待评答案。"""
    from app.database import SessionLocal
    from app.services.ai_grader import AIGrader

    db = SessionLocal()
    try:
        pending = (
            db.query(models.StudentAnswer)
            .join(models.ExamQuestion, models.StudentAnswer.question_id == models.ExamQuestion.id)
            .filter(
                models.ExamQuestion.exam_id == exam_id,
                models.ExamQuestion.question_type.in_([
                    models.QuestionType.SUBJECTIVE,
                    models.QuestionType.FILL,
                ]),
                models.StudentAnswer.grading_status == models.GradingStatus.PENDING,
            )
            .all()
        )
        _grade_tasks[task_id]["total"] = len(pending)
        grader = AIGrader()
        graded = 0
        failed = 0
        sem = asyncio.Semaphore(5)  # 最多 5 个并发请求，可按硅基流动限额调整

        # 预先读取所有题目数据，避免并发时 lazy-load 问题
        ans_params = []
        for ans in pending:
            q = ans.question
            if not q:
                continue
            question_text = _effective_standard_answer(q) or ""
            criteria = q.grading_criteria or ""
            if not criteria and q.sub_questions:
                criteria = "\n".join(
                    f"{sq.get('label','')} {sq.get('grading_criteria','')}"
                    for sq in (q.sub_questions or [])
                    if isinstance(sq, dict) and sq.get("grading_criteria")
                )
            ans_params.append((ans, q.max_score, question_text, criteria))

        async def _grade_one(ans, max_score, question_text, criteria):
            nonlocal graded, failed
            async with sem:
                try:
                    if ans.answer_image_path and os.path.exists(ans.answer_image_path):
                        result = await grader.grade_with_image(
                            question_text=question_text,
                            criteria=criteria,
                            max_score=max_score,
                            image_path=ans.answer_image_path,
                        )
                        if result.get("recognized_text"):
                            ans.recognized_answer = result["recognized_text"]
                    else:
                        result = await grader.grade(
                            question_text=question_text,
                            student_answer=ans.recognized_answer or "",
                            criteria=criteria,
                            max_score=max_score,
                        )
                    ans.score = result.get("score", 0)
                    ans.ai_feedback = result.get("feedback", "")
                    ans.grading_status = models.GradingStatus.AI_GRADED
                    graded += 1
                    _grade_tasks[task_id]["graded"] = graded
                except Exception as e:
                    failed += 1
                    _grade_tasks[task_id]["failed"] = failed
                    print(f"[ai_grade_all_exam] ans={ans.id} 失败: {e}")

        await asyncio.gather(*[_grade_one(ans, ms, qt, cr) for ans, ms, qt, cr in ans_params])
        db.flush()

        # 重算每个受影响学生的总分和状态
        affected_se_ids = {a.student_exam_id for a in pending}
        for se_id in affected_se_ids:
            se = db.query(models.StudentExam).filter(models.StudentExam.id == se_id).first()
            if not se:
                continue
            all_ans = db.query(models.StudentAnswer).filter(
                models.StudentAnswer.student_exam_id == se_id
            ).all()
            se.total_score = sum(a.score for a in all_ans if a.score is not None)
            if all(a.grading_status != models.GradingStatus.PENDING for a in all_ans):
                se.grading_status = models.GradingStatus.COMPLETED

        db.commit()
        _grade_tasks[task_id].update({"status": "completed", "graded": graded, "failed": failed})
    except Exception as e:
        _grade_tasks[task_id].update({"status": "failed", "error": str(e)})
        db.rollback()
    finally:
        db.close()


@router.post("/exam/{exam_id}/ai-grade-all", response_model=dict)
async def ai_grade_all_exam_start(
    exam_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """启动后台任务批改该考试所有学生的填空/主观题，立即返回 task_id。"""
    if not db.query(models.Exam).filter(models.Exam.id == exam_id).first():
        raise HTTPException(status_code=404, detail="考试不存在")
    task_id = f"grade_exam_{exam_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    _grade_tasks[task_id] = {"status": "running", "graded": 0, "total": 0, "failed": 0, "exam_id": exam_id}
    background_tasks.add_task(_run_grade_all_exam, exam_id, task_id)
    return {"task_id": task_id, "status": "started"}


@router.get("/exam/{exam_id}/ai-grade-all/status", response_model=dict)
def ai_grade_all_exam_status(exam_id: int):
    """查询该考试最新批改任务进度。"""
    matching = [(k, v) for k, v in _grade_tasks.items() if v.get("exam_id") == exam_id]
    if not matching:
        return {"status": "not_found", "graded": 0, "total": 0, "failed": 0}
    _, state = sorted(matching, key=lambda x: x[0])[-1]
    return state


@router.patch("/student-exam/{student_exam_id}/info", response_model=dict)
def update_student_info(
    student_exam_id: int,
    data: dict,
    db: Session = Depends(get_db),
):
    """修改学生姓名/学号/班级（合并后手动更正用）。"""
    se = db.query(models.StudentExam).filter(models.StudentExam.id == student_exam_id).first()
    if not se:
        raise HTTPException(status_code=404, detail="记录不存在")
    if "student_name" in data:
        se.student_name = data["student_name"]
    if "student_number" in data:
        se.student_number = data["student_number"]
    if "class_name" in data:
        se.class_name = data["class_name"]
    db.commit()
    return {"success": True}


@router.delete("/exam/{exam_id}/student/{student_exam_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_student_result(exam_id: int, student_exam_id: int, db: Session = Depends(get_db)):
    se = db.query(models.StudentExam).filter(
        models.StudentExam.id == student_exam_id,
        models.StudentExam.exam_id == exam_id
    ).first()
    if not se:
        raise HTTPException(status_code=404, detail="记录不存在")
    db.delete(se)
    db.commit()
