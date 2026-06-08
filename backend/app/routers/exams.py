from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session
from typing import List, Optional
import os
from app.database import get_db
from app import models, schemas
from app.auth import get_current_user

TEMPLATES_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "templates"
)
os.makedirs(TEMPLATES_DIR, exist_ok=True)

router = APIRouter(prefix="/api/exams", tags=["exams"], dependencies=[Depends(get_current_user)])


@router.get("/", response_model=List[schemas.ExamSummary])
def list_exams(db: Session = Depends(get_db)):
    exams = db.query(models.Exam).order_by(models.Exam.created_at.desc()).all()
    result = []
    for exam in exams:
        student_count = db.query(models.StudentExam).filter(
            models.StudentExam.exam_id == exam.id
        ).count()
        graded_count = db.query(models.StudentExam).filter(
            models.StudentExam.exam_id == exam.id,
            models.StudentExam.grading_status == models.GradingStatus.COMPLETED
        ).count()
        summary = schemas.ExamSummary(
            id=exam.id,
            name=exam.name,
            subject=exam.subject,
            grade=exam.grade,
            class_name=exam.class_name,
            exam_date=exam.exam_date,
            total_score=exam.total_score,
            status=exam.status,
            created_at=exam.created_at,
            question_count=len(exam.questions),
            student_count=student_count,
            graded_count=graded_count,
        )
        result.append(summary)
    return result


@router.post("/", response_model=schemas.ExamOut, status_code=status.HTTP_201_CREATED)
def create_exam(exam_in: schemas.ExamCreate, db: Session = Depends(get_db)):
    exam = models.Exam(
        name=exam_in.name,
        subject=exam_in.subject,
        grade=exam_in.grade,
        class_name=exam_in.class_name,
        exam_date=exam_in.exam_date,
        total_score=exam_in.total_score,
        description=exam_in.description,
        scan_dir=exam_in.scan_dir,
        template_config=exam_in.template_config,
        status=models.ExamStatus.DRAFT,
    )
    db.add(exam)
    db.flush()
    for q_in in (exam_in.questions or []):
        sub_q_data = None
        if q_in.sub_questions:
            sub_q_data = [sq.model_dump() for sq in q_in.sub_questions]
        q = models.ExamQuestion(
            exam_id=exam.id,
            question_number=q_in.question_number,
            question_type=q_in.question_type,
            max_score=q_in.max_score,
            title=q_in.title,
            standard_answer=q_in.standard_answer,
            answer_options=q_in.answer_options,
            region=q_in.region,
            grading_criteria=q_in.grading_criteria,
            order_index=q_in.order_index,
            sub_questions=sub_q_data,
            answer_lines=q_in.answer_lines,
            page=q_in.page or "A",
        )
        db.add(q)
    db.commit()
    db.refresh(exam)
    return exam


@router.get("/{exam_id}", response_model=schemas.ExamOut)
def get_exam(exam_id: int, db: Session = Depends(get_db)):
    exam = db.query(models.Exam).filter(models.Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")
    return exam


@router.put("/{exam_id}", response_model=schemas.ExamOut)
def update_exam(exam_id: int, exam_in: schemas.ExamUpdate, db: Session = Depends(get_db)):
    exam = db.query(models.Exam).filter(models.Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")
    updates = exam_in.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(exam, field, value)
    # 若更新了班级，回填该考试下 class_name 为空的 StudentExam 记录
    new_class = updates.get('class_name')
    if new_class:
        db.query(models.StudentExam)\
          .filter(models.StudentExam.exam_id == exam_id,
                  models.StudentExam.class_name == None)\
          .update({'class_name': new_class})
    db.commit()
    db.refresh(exam)
    return exam


@router.delete("/{exam_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exam(exam_id: int, db: Session = Depends(get_db)):
    exam = db.query(models.Exam).filter(models.Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")
    # 按 FK 依赖顺序手动删除，避免 MySQL FK 约束冲突
    # 1. 先删 StudentAnswer（依赖 StudentExam 和 ExamQuestion）
    se_ids = [row.id for row in db.query(models.StudentExam.id).filter_by(exam_id=exam_id).all()]
    if se_ids:
        db.query(models.StudentAnswer).filter(
            models.StudentAnswer.student_exam_id.in_(se_ids)
        ).delete(synchronize_session="fetch")
    # 2. 删 StudentExam（依赖 ScanFile 和 Student）
    db.query(models.StudentExam).filter_by(exam_id=exam_id).delete(synchronize_session="fetch")
    # 3. 删 Student
    db.query(models.Student).filter_by(exam_id=exam_id).delete(synchronize_session="fetch")
    # 4. 删 ScanFile
    db.query(models.ScanFile).filter_by(exam_id=exam_id).delete(synchronize_session="fetch")
    # 5. 先删 ExamQuestion 下的 StudentAnswer（question_id FK，防止双重引用残留）
    q_ids = [row.id for row in db.query(models.ExamQuestion.id).filter_by(exam_id=exam_id).all()]
    if q_ids:
        db.query(models.StudentAnswer).filter(
            models.StudentAnswer.question_id.in_(q_ids)
        ).delete(synchronize_session="fetch")
    # 6. 删 ExamQuestion
    db.query(models.ExamQuestion).filter_by(exam_id=exam_id).delete(synchronize_session="fetch")
    # 7. 最后删 Exam 本体
    db.delete(exam)
    db.commit()


# ── Questions ──────────────────────────────────────────────────────────────────

@router.get("/{exam_id}/questions", response_model=List[schemas.ExamQuestionOut])
def list_questions(exam_id: int, db: Session = Depends(get_db)):
    exam = db.query(models.Exam).filter(models.Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")
    return sorted(exam.questions, key=lambda q: q.order_index)


@router.post("/{exam_id}/questions", response_model=schemas.ExamQuestionOut, status_code=status.HTTP_201_CREATED)
def add_question(exam_id: int, q_in: schemas.ExamQuestionCreate, db: Session = Depends(get_db)):
    exam = db.query(models.Exam).filter(models.Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")
    q = models.ExamQuestion(exam_id=exam_id, **q_in.model_dump())
    db.add(q)
    db.commit()
    db.refresh(q)
    return q


@router.put("/{exam_id}/questions/{question_id}", response_model=schemas.ExamQuestionOut)
def update_question(exam_id: int, question_id: int, q_in: schemas.ExamQuestionUpdate, db: Session = Depends(get_db)):
    q = db.query(models.ExamQuestion).filter(
        models.ExamQuestion.id == question_id,
        models.ExamQuestion.exam_id == exam_id
    ).first()
    if not q:
        raise HTTPException(status_code=404, detail="题目不存在")
    for field, value in q_in.model_dump(exclude_unset=True).items():
        setattr(q, field, value)
    db.commit()
    db.refresh(q)
    return q


@router.delete("/{exam_id}/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_question(exam_id: int, question_id: int, db: Session = Depends(get_db)):
    q = db.query(models.ExamQuestion).filter(
        models.ExamQuestion.id == question_id,
        models.ExamQuestion.exam_id == exam_id
    ).first()
    if not q:
        raise HTTPException(status_code=404, detail="题目不存在")
    db.delete(q)
    db.commit()


@router.post("/{exam_id}/questions/batch", response_model=List[schemas.ExamQuestionOut])
def batch_set_questions(exam_id: int, questions: List[schemas.ExamQuestionCreate], db: Session = Depends(get_db)):
    exam = db.query(models.Exam).filter(models.Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")
    db.query(models.ExamQuestion).filter(models.ExamQuestion.exam_id == exam_id).delete()
    new_questions = []
    for q_in in questions:
        q = models.ExamQuestion(exam_id=exam_id, **q_in.model_dump())
        db.add(q)
        new_questions.append(q)
    db.commit()
    for q in new_questions:
        db.refresh(q)
    return new_questions


# ── Template ──────────────────────────────────────────────────────────────

@router.post("/{exam_id}/template", response_model=dict)
async def upload_template(
    exam_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    exam = db.query(models.Exam).filter(models.Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in [".jpg", ".jpeg", ".png"]:
        raise HTTPException(status_code=400, detail="仅支持 JPG/PNG 格式")

    save_name = f"exam_{exam_id}_template{ext}"
    save_path = os.path.join(TEMPLATES_DIR, save_name)
    with open(save_path, "wb") as f:
        f.write(await file.read())

    template_config = dict(exam.template_config or {})
    template_config["template_image"] = f"/templates/{save_name}"
    exam.template_config = template_config
    db.commit()

    return {"template_url": template_config["template_image"]}


# ── Stats ──────────────────────────────────────────────────────────────────────

@router.get("/{exam_id}/stats", response_model=schemas.ExamStats)
def get_exam_stats(exam_id: int, db: Session = Depends(get_db)):
    exam = db.query(models.Exam).filter(models.Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")

    student_exams = db.query(models.StudentExam).filter(
        models.StudentExam.exam_id == exam_id
    ).all()

    scores = [se.total_score for se in student_exams if se.total_score is not None]
    graded = [se for se in student_exams if se.grading_status == models.GradingStatus.COMPLETED]

    pass_threshold = exam.total_score * 0.6
    excellent_threshold = exam.total_score * 0.9

    distribution = []
    if scores:
        ranges = [(0, 60), (60, 70), (70, 80), (80, 90), (90, 101)]
        labels = ["不及格", "及格", "中等", "良好", "优秀"]
        for (low, high), label in zip(ranges, labels):
            count = sum(1 for s in scores if low <= (s / exam.total_score * 100) < high)
            distribution.append({"label": label, "range": f"{low}-{high}", "count": count})

    question_stats = []
    for q in exam.questions:
        answers = db.query(models.StudentAnswer).filter(
            models.StudentAnswer.question_id == q.id,
            models.StudentAnswer.score.isnot(None)
        ).all()
        if answers:
            avg = sum(a.score for a in answers) / len(answers)
            correct = sum(1 for a in answers if a.is_correct)
            question_stats.append({
                "question_number": q.question_number,
                "question_type": q.question_type,
                "max_score": q.max_score,
                "average_score": round(avg, 2),
                "accuracy_rate": round(correct / len(answers) * 100, 1) if q.question_type == "choice" else None,
                "average_rate": round(avg / q.max_score * 100, 1),
                "answer_count": len(answers),
            })

    return schemas.ExamStats(
        exam_id=exam.id,
        exam_name=exam.name,
        total_students=len(student_exams),
        graded_students=len(graded),
        average_score=round(sum(scores) / len(scores), 2) if scores else None,
        max_score=max(scores) if scores else None,
        min_score=min(scores) if scores else None,
        pass_rate=round(sum(1 for s in scores if s >= pass_threshold) / len(scores) * 100, 1) if scores else None,
        excellent_rate=round(sum(1 for s in scores if s >= excellent_threshold) / len(scores) * 100, 1) if scores else None,
        score_distribution=distribution,
        question_stats=question_stats,
    )
