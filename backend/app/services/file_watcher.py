import asyncio
import os
import threading
import time
from typing import Optional, Dict, Any
from datetime import datetime

_watcher_thread: Optional[threading.Thread] = None
_watcher_running = False
_watcher_status: Dict[str, Any] = {
    "running": False,
    "directory": None,
    "exam_id": None,
    "files_detected": 0,
    "files_processed": 0,
    "last_check": None,
}
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".pdf"}


def _auto_process(sf_id: int, exam_id: int) -> None:
    """Run ExamProcessor on a single ScanFile in a dedicated thread."""
    from app.database import SessionLocal
    from app import models
    from app.services.processor import ExamProcessor

    db = SessionLocal()
    try:
        sf = db.query(models.ScanFile).filter(models.ScanFile.id == sf_id).first()
        exam = db.query(models.Exam).filter(models.Exam.id == exam_id).first()
        if not sf or not exam:
            return
        sf.status = models.ScanStatus.PROCESSING
        db.commit()
        processor = ExamProcessor(db)
        asyncio.run(processor.process_scan(sf, exam))
        _watcher_status["files_processed"] = _watcher_status.get("files_processed", 0) + 1
    except Exception as e:
        try:
            db.rollback()
            sf2 = db.query(models.ScanFile).filter(models.ScanFile.id == sf_id).first()
            if sf2:
                sf2.status = models.ScanStatus.FAILED
                sf2.error_message = str(e)
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


def get_watcher_status() -> Dict[str, Any]:
    return dict(_watcher_status)


def start_watcher(scan_dir: str, exam_id: int, db_factory=None):
    global _watcher_thread, _watcher_running, _watcher_status

    if _watcher_running:
        stop_watcher()

    _watcher_running = True
    _watcher_status.update({
        "running": True,
        "directory": scan_dir,
        "exam_id": exam_id,
        "files_detected": 0,
        "last_check": datetime.utcnow().isoformat(),
    })

    def _watch():
        from app.database import SessionLocal
        from app import models
        known_files = set()

        # On startup: register any pre-existing files not yet in the DB,
        # instead of silently skipping them as "already known".
        if os.path.exists(scan_dir):
            db = SessionLocal()
            try:
                for f in os.listdir(scan_dir):
                    fp = os.path.join(scan_dir, f)
                    if not os.path.isfile(fp):
                        continue
                    known_files.add(fp)
                    ext = os.path.splitext(f)[1].lower()
                    if ext not in SUPPORTED_EXTENSIONS:
                        continue
                    existing = db.query(models.ScanFile).filter(
                        models.ScanFile.file_path == fp
                    ).first()
                    if not existing:
                        sf = models.ScanFile(
                            exam_id=exam_id,
                            file_path=fp,
                            file_name=os.path.basename(fp),
                            file_size=os.path.getsize(fp),
                            status=models.ScanStatus.PENDING,
                        )
                        db.add(sf)
                        _watcher_status["files_detected"] += 1
                db.commit()
                # Auto-process all newly registered startup files
                pending = db.query(models.ScanFile).filter(
                    models.ScanFile.exam_id == exam_id,
                    models.ScanFile.status == models.ScanStatus.PENDING,
                ).all()
                for sf in pending:
                    threading.Thread(
                        target=_auto_process, args=(sf.id, exam_id), daemon=True
                    ).start()
            except Exception:
                pass
            finally:
                db.close()

        while _watcher_running:
            try:
                if not os.path.exists(scan_dir):
                    time.sleep(3)
                    continue

                current_files = set()
                for f in os.listdir(scan_dir):
                    fp = os.path.join(scan_dir, f)
                    if os.path.isfile(fp):
                        ext = os.path.splitext(f)[1].lower()
                        if ext in SUPPORTED_EXTENSIONS:
                            current_files.add(fp)

                new_files = current_files - known_files
                for fp in new_files:
                    try:
                        time.sleep(0.5)
                        db = SessionLocal()
                        existing = db.query(models.ScanFile).filter(
                            models.ScanFile.file_path == fp
                        ).first()
                        if not existing:
                            sf = models.ScanFile(
                                exam_id=exam_id,
                                file_path=fp,
                                file_name=os.path.basename(fp),
                                file_size=os.path.getsize(fp),
                                status=models.ScanStatus.PENDING,
                            )
                            db.add(sf)
                            db.commit()
                            _watcher_status["files_detected"] += 1
                            # Auto-process immediately
                            threading.Thread(
                                target=_auto_process, args=(sf.id, exam_id), daemon=True
                            ).start()
                        db.close()
                    except Exception:
                        pass

                known_files = current_files | known_files
                _watcher_status["last_check"] = datetime.utcnow().isoformat()
                time.sleep(2)
            except Exception:
                time.sleep(5)

    _watcher_thread = threading.Thread(target=_watch, daemon=True)
    _watcher_thread.start()


def stop_watcher():
    global _watcher_running, _watcher_status
    _watcher_running = False
    _watcher_status["running"] = False
    _watcher_status["directory"] = None
    _watcher_status["exam_id"] = None
