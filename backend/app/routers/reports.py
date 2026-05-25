from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from typing import Optional
import io
from app.database import get_db
from app import models

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/exam/{exam_id}/excel")
def export_excel(exam_id: int, db: Session = Depends(get_db)):
    from app.services.reporter import ReportGenerator
    exam = db.query(models.Exam).filter(models.Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")

    reporter = ReportGenerator(db)
    buf = reporter.generate_excel(exam)
    filename = f"{exam.name}_成绩报告.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"}
    )


@router.get("/exam/{exam_id}/summary")
def get_summary_report(exam_id: int, db: Session = Depends(get_db)):
    from app.services.reporter import ReportGenerator
    exam = db.query(models.Exam).filter(models.Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")

    reporter = ReportGenerator(db)
    return reporter.generate_summary(exam)


@router.get("/exam/{exam_id}/class-analysis")
def get_class_analysis(exam_id: int, db: Session = Depends(get_db)):
    from app.services.reporter import ReportGenerator
    exam = db.query(models.Exam).filter(models.Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")

    reporter = ReportGenerator(db)
    return reporter.generate_class_analysis(exam)
