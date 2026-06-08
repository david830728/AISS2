from pydantic import BaseModel, Field
from typing import Optional, List, Any, Dict
from datetime import datetime
from enum import Enum


class QuestionType(str, Enum):
    CHOICE = "choice"
    FILL = "fill"
    SUBJECTIVE = "subjective"


class ExamStatus(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class ScanStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class GradingStatus(str, Enum):
    PENDING = "pending"
    AUTO_GRADED = "auto_graded"
    AI_GRADED = "ai_graded"
    MANUAL_GRADED = "manual_graded"
    COMPLETED = "completed"


# ── SubQuestion ───────────────────────────────────────────────────────────────

class SubQuestion(BaseModel):
    label: str = ""
    max_score: float = 1.0
    blank_count: Optional[int] = None
    blank_answers: Optional[List[str]] = None
    standard_answer: Optional[str] = None
    grading_criteria: Optional[str] = None
    region: Optional[Dict[str, Any]] = None


# ── ExamQuestion ──────────────────────────────────────────────────────────────

class ExamQuestionBase(BaseModel):
    question_number: int
    question_type: QuestionType
    max_score: float
    title: Optional[str] = None
    standard_answer: Optional[str] = None
    answer_options: Optional[List[str]] = None
    region: Optional[Dict[str, Any]] = None
    grading_criteria: Optional[str] = None
    order_index: int = 0
    sub_questions: Optional[List[SubQuestion]] = None
    answer_lines: Optional[int] = 8
    page: Optional[str] = "A"


class ExamQuestionCreate(ExamQuestionBase):
    pass


class ExamQuestionUpdate(BaseModel):
    question_number: Optional[int] = None
    question_type: Optional[QuestionType] = None
    max_score: Optional[float] = None
    title: Optional[str] = None
    standard_answer: Optional[str] = None
    answer_options: Optional[List[str]] = None
    region: Optional[Dict[str, Any]] = None
    grading_criteria: Optional[str] = None
    order_index: Optional[int] = None
    sub_questions: Optional[List[SubQuestion]] = None
    answer_lines: Optional[int] = None
    page: Optional[str] = None


class ExamQuestionOut(ExamQuestionBase):
    id: int
    exam_id: int

    class Config:
        from_attributes = True


# ── Exam ──────────────────────────────────────────────────────────────────────

class ExamBase(BaseModel):
    name: str
    subject: str
    grade: Optional[str] = None
    class_name: Optional[str] = None
    exam_date: Optional[datetime] = None
    total_score: float = 100.0
    description: Optional[str] = None
    scan_dir: Optional[str] = None
    template_config: Optional[Dict[str, Any]] = None


class ExamCreate(ExamBase):
    questions: Optional[List[ExamQuestionCreate]] = []


class ExamUpdate(BaseModel):
    name: Optional[str] = None
    subject: Optional[str] = None
    grade: Optional[str] = None
    class_name: Optional[str] = None
    exam_date: Optional[datetime] = None
    total_score: Optional[float] = None
    description: Optional[str] = None
    scan_dir: Optional[str] = None
    status: Optional[ExamStatus] = None
    template_config: Optional[Dict[str, Any]] = None


class ExamOut(ExamBase):
    id: int
    status: str
    created_at: datetime
    updated_at: Optional[datetime] = None
    questions: List[ExamQuestionOut] = []

    class Config:
        from_attributes = True


class ExamSummary(BaseModel):
    id: int
    name: str
    subject: str
    grade: Optional[str]
    class_name: Optional[str]
    exam_date: Optional[datetime]
    total_score: float
    status: str
    created_at: datetime
    question_count: int = 0
    student_count: int = 0
    graded_count: int = 0

    class Config:
        from_attributes = True


# ── ScanFile ──────────────────────────────────────────────────────────────────

class ScanFileOut(BaseModel):
    id: int
    exam_id: Optional[int]
    file_path: str
    file_name: Optional[str]
    file_size: Optional[int]
    status: str
    error_message: Optional[str]
    page_count: int
    detected_student_id: Optional[str]
    detected_student_name: Optional[str]
    detected_page_side: Optional[str]
    created_at: datetime
    processed_at: Optional[datetime]

    class Config:
        from_attributes = True


# ── Student (per-exam roster) ─────────────────────────────────────────────────

class StudentOut(BaseModel):
    id: int
    exam_id: int
    student_number: str
    student_name: Optional[str] = None
    class_name: Optional[str] = None
    seat_number: Optional[int] = None
    is_temp: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


class StudentImportResult(BaseModel):
    imported: int
    failed: int
    errors: List[str] = []


class GenerateTempRequest(BaseModel):
    count: int


# ── StudentAnswer ─────────────────────────────────────────────────────────────

class StudentAnswerOut(BaseModel):
    id: int
    question_id: int
    question_number: int
    question_type: str
    max_score: float
    recognized_answer: Optional[str]
    standard_answer: Optional[str]
    score: Optional[float]
    ai_feedback: Optional[str]
    is_correct: Optional[bool]
    grading_status: str
    answer_image_path: Optional[str]

    class Config:
        from_attributes = True


class StudentAnswerUpdate(BaseModel):
    score: Optional[float] = None
    recognized_answer: Optional[str] = None
    ai_feedback: Optional[str] = None
    grading_status: Optional[str] = None


# ── StudentExam ───────────────────────────────────────────────────────────────

class StudentExamOut(BaseModel):
    id: int
    exam_id: int
    student_name: Optional[str]
    student_number: Optional[str]
    class_name: Optional[str]
    total_score: Optional[float]
    grading_status: str
    created_at: datetime
    answers: List[StudentAnswerOut] = []

    class Config:
        from_attributes = True


class StudentExamSummary(BaseModel):
    id: int
    student_name: Optional[str]
    student_number: Optional[str]
    class_name: Optional[str]
    total_score: Optional[float]
    grading_status: str
    created_at: datetime

    class Config:
        from_attributes = True


# ── Processing ────────────────────────────────────────────────────────────────

class ProcessRequest(BaseModel):
    exam_id: int
    scan_file_ids: Optional[List[int]] = None


class AIGradeRequest(BaseModel):
    student_exam_id: int
    question_id: int


class ManualScoreUpdate(BaseModel):
    score: float
    feedback: Optional[str] = None


# ── Stats ─────────────────────────────────────────────────────────────────────

class ExamStats(BaseModel):
    exam_id: int
    exam_name: str
    total_students: int
    graded_students: int
    average_score: Optional[float]
    max_score: Optional[float]
    min_score: Optional[float]
    pass_rate: Optional[float]
    excellent_rate: Optional[float]
    score_distribution: List[Dict[str, Any]] = []
    question_stats: List[Dict[str, Any]] = []


# ── Settings ──────────────────────────────────────────────────────────────────

class AISettings(BaseModel):
    api_url: str = "https://api.openai.com/v1"
    api_key: str = ""
    model: str = "gpt-4o"
    enabled: bool = False


class SystemSettings(BaseModel):
    scan_dir: str = "./scans"
    auto_process: bool = True
    ai_settings: AISettings = AISettings()
