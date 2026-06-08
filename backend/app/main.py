from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from fastapi import Depends
from app.database import init_db, migrate_db
from app.routers import exams, scans, results, reports, settings, students, auth
from app.auth import get_current_user

app = FastAPI(
    title="乐清市白石中学 AI阅卷系统",
    description="AI-powered exam grading system",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(exams.router)
app.include_router(scans.router)
app.include_router(results.router)
app.include_router(reports.router)
app.include_router(settings.router)
app.include_router(students.router)

ANSWER_IMAGES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "answer_images")
os.makedirs(ANSWER_IMAGES_DIR, exist_ok=True)
app.mount("/answer_images", StaticFiles(directory=ANSWER_IMAGES_DIR), name="answer_images")

SCANS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "scans")
os.makedirs(SCANS_DIR, exist_ok=True)

ANSWER_SHEETS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "answer_sheets")
os.makedirs(ANSWER_SHEETS_DIR, exist_ok=True)

TEMPLATES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "templates")
os.makedirs(TEMPLATES_DIR, exist_ok=True)
app.mount("/templates", StaticFiles(directory=TEMPLATES_DIR), name="templates")


@app.on_event("startup")
def startup():
    init_db()
    migrate_db()
    from app.services.file_watcher import get_process_queue
    get_process_queue().start()
    print("[startup] 串行处理队列已启动")


@app.get("/api/health")
def health():
    return {"status": "ok", "system": "乐清市白石中学AI阅卷系统"}


@app.get("/api/dashboard")
def dashboard(db=None, _user: dict = Depends(get_current_user)):
    from app.database import SessionLocal
    from app import models
    db = SessionLocal()
    try:
        total_exams = db.query(models.Exam).count()
        active_exams = db.query(models.Exam).filter(models.Exam.status == models.ExamStatus.ACTIVE).count()
        total_papers = db.query(models.StudentExam).count()
        pending_grading = db.query(models.StudentExam).filter(
            models.StudentExam.grading_status.in_([
                models.GradingStatus.PENDING,
                models.GradingStatus.AUTO_GRADED,
            ])
        ).count()
        completed_grading = db.query(models.StudentExam).filter(
            models.StudentExam.grading_status == models.GradingStatus.COMPLETED
        ).count()
        pending_scans = db.query(models.ScanFile).filter(
            models.ScanFile.status == models.ScanStatus.PENDING
        ).count()

        recent_exams = db.query(models.Exam).order_by(
            models.Exam.created_at.desc()
        ).limit(5).all()

        return {
            "total_exams": total_exams,
            "active_exams": active_exams,
            "total_papers": total_papers,
            "pending_grading": pending_grading,
            "completed_grading": completed_grading,
            "pending_scans": pending_scans,
            "recent_exams": [
                {
                    "id": e.id,
                    "name": e.name,
                    "subject": e.subject,
                    "status": e.status,
                    "created_at": e.created_at.isoformat() if e.created_at else None,
                }
                for e in recent_exams
            ],
        }
    finally:
        db.close()
