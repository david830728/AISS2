import asyncio
import os
import queue
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


class FileProcessQueue:
    """全局串行处理队列，确保同一时间只有一个文件在处理"""

    def __init__(self):
        self._queue = queue.Queue()
        self._worker_thread = None
        self._running = False

    def start(self):
        self._running = True
        self._worker_thread = threading.Thread(
            target=self._worker, daemon=True
        )
        self._worker_thread.start()
        print("[FileProcessQueue] 串行处理队列已启动")

    def stop(self):
        self._running = False

    def add(self, task_fn, *args, **kwargs):
        """添加处理任务到队列"""
        self._queue.put((task_fn, args, kwargs))
        print(f"[FileProcessQueue] 任务入队，当前队列长度={self._queue.qsize()}")

    def _worker(self):
        while self._running:
            try:
                task_fn, args, kwargs = self._queue.get(timeout=1)
                print(f"[FileProcessQueue] 开始处理任务，剩余={self._queue.qsize()}")
                try:
                    task_fn(*args, **kwargs)
                except Exception as e:
                    print(f"[FileProcessQueue] 任务处理失败: {e}")
                finally:
                    self._queue.task_done()
                    # 每个文件处理完后等待1秒再处理下一个
                    time.sleep(1)
            except queue.Empty:
                continue


# 全局单例队列
_process_queue = FileProcessQueue()


def get_process_queue() -> FileProcessQueue:
    return _process_queue


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
                # Auto-process all newly registered startup files via queue
                pending = db.query(models.ScanFile).filter(
                    models.ScanFile.exam_id == exam_id,
                    models.ScanFile.status == models.ScanStatus.PENDING,
                ).all()
                for sf in pending:
                    get_process_queue().add(_auto_process, sf.id, exam_id)
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
                            # Auto-process immediately via queue
                            get_process_queue().add(_auto_process, sf.id, exam_id)
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
