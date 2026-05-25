from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from sqlalchemy.orm import Session
from typing import List, Optional
import os, shutil, uuid
from datetime import datetime
from app.database import get_db
from app import models, schemas

router = APIRouter(prefix="/api/scans", tags=["scans"])

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "scans")
os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.get("/", response_model=List[schemas.ScanFileOut])
def list_scan_files(
    exam_id: Optional[int] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db)
):
    query = db.query(models.ScanFile)
    if exam_id:
        query = query.filter(models.ScanFile.exam_id == exam_id)
    if status:
        query = query.filter(models.ScanFile.status == status)
    return query.order_by(models.ScanFile.created_at.desc()).all()


@router.post("/upload", response_model=List[schemas.ScanFileOut])
async def upload_scan_files(
    exam_id: int = Form(...),
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db)
):
    exam = db.query(models.Exam).filter(models.Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")

    exam_scan_dir = os.path.join(UPLOAD_DIR, f"exam_{exam_id}")
    os.makedirs(exam_scan_dir, exist_ok=True)

    created = []
    for file in files:
        ext = os.path.splitext(file.filename)[1].lower()
        if ext not in [".jpg", ".jpeg", ".png", ".tiff", ".tif", ".pdf", ".bmp"]:
            continue

        unique_name = f"{uuid.uuid4().hex}{ext}"
        file_path = os.path.join(exam_scan_dir, unique_name)

        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)

        existing = db.query(models.ScanFile).filter(models.ScanFile.file_path == file_path).first()
        if existing:
            created.append(existing)
            continue

        scan_file = models.ScanFile(
            exam_id=exam_id,
            file_path=file_path,
            file_name=file.filename,
            file_size=os.path.getsize(file_path),
            status=models.ScanStatus.PENDING,
        )
        db.add(scan_file)
        db.flush()
        created.append(scan_file)

    db.commit()
    for sf in created:
        db.refresh(sf)
    return created


@router.post("/process/{scan_file_id}", response_model=dict)
async def process_scan_file(scan_file_id: int, exam_id: int, db: Session = Depends(get_db)):
    from app.services.processor import ExamProcessor
    scan_file = db.query(models.ScanFile).filter(models.ScanFile.id == scan_file_id).first()
    if not scan_file:
        raise HTTPException(status_code=404, detail="扫描文件不存在")

    exam = db.query(models.Exam).filter(models.Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")

    scan_file.status = models.ScanStatus.PROCESSING
    db.commit()

    try:
        processor = ExamProcessor(db)
        result = await processor.process_scan(scan_file, exam)
        return {"success": True, "student_exam_id": result.get("student_exam_id")}
    except Exception as e:
        scan_file.status = models.ScanStatus.FAILED
        scan_file.error_message = str(e)
        db.commit()
        raise HTTPException(status_code=500, detail=f"处理失败: {str(e)}")


@router.post("/process-batch", response_model=dict)
async def process_batch(req: schemas.ProcessRequest, db: Session = Depends(get_db)):
    from app.services.processor import ExamProcessor
    exam = db.query(models.Exam).filter(models.Exam.id == req.exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")

    if req.scan_file_ids:
        scan_files = db.query(models.ScanFile).filter(
            models.ScanFile.id.in_(req.scan_file_ids),
            models.ScanFile.exam_id == req.exam_id
        ).all()
    else:
        scan_files = db.query(models.ScanFile).filter(
            models.ScanFile.exam_id == req.exam_id,
            models.ScanFile.status == models.ScanStatus.PENDING
        ).all()

    processor = ExamProcessor(db)
    success_count = 0
    fail_count = 0
    for sf in scan_files:
        try:
            sf.status = models.ScanStatus.PROCESSING
            db.commit()
            await processor.process_scan(sf, exam)
            success_count += 1
        except Exception as e:
            sf.status = models.ScanStatus.FAILED
            sf.error_message = str(e)
            db.commit()
            fail_count += 1

    return {"success": success_count, "failed": fail_count, "total": len(scan_files)}


@router.delete("/{scan_file_id}", status_code=204)
def delete_scan_file(scan_file_id: int, db: Session = Depends(get_db)):
    sf = db.query(models.ScanFile).filter(models.ScanFile.id == scan_file_id).first()
    if not sf:
        raise HTTPException(status_code=404, detail="扫描文件不存在")
    if os.path.exists(sf.file_path):
        os.remove(sf.file_path)
    db.delete(sf)
    db.commit()


@router.get("/fs/list")
def list_filesystem(path: Optional[str] = Query(default=None)):
    """列出指定路径下的子目录，供前端目录选择器可视化浏览使用。"""
    resolved = os.path.abspath(os.path.expanduser(path or "~"))
    if not os.path.isdir(resolved):
        raise HTTPException(status_code=400, detail=f"路径不存在: {resolved}")
    dirs = []
    try:
        for name in sorted(os.listdir(resolved)):
            if name.startswith('.'):
                continue
            full = os.path.join(resolved, name)
            if os.path.isdir(full):
                dirs.append({"name": name, "path": full})
    except PermissionError:
        pass
    parent = os.path.dirname(resolved)
    return {
        "current": resolved,
        "parent": parent if parent != resolved else None,
        "dirs": dirs,
    }


@router.get("/monitor/status", response_model=dict)
def get_monitor_status():
    from app.services.file_watcher import get_watcher_status
    return get_watcher_status()


@router.post("/monitor/start", response_model=dict)
def start_monitor(scan_dir: str, exam_id: int, db: Session = Depends(get_db)):
    from app.services.file_watcher import start_watcher
    start_watcher(scan_dir, exam_id, db)
    return {"status": "started", "directory": scan_dir}


@router.post("/monitor/stop", response_model=dict)
def stop_monitor():
    from app.services.file_watcher import stop_watcher
    stop_watcher()
    return {"status": "stopped"}
