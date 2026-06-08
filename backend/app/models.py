from sqlalchemy import Column, Integer, String, Float, Text, DateTime, ForeignKey, JSON, Boolean, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
import enum
from app.database import Base


class QuestionType(str, enum.Enum):
    CHOICE = "choice"
    FILL = "fill"
    SUBJECTIVE = "subjective"


class ExamStatus(str, enum.Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class ScanStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class GradingStatus(str, enum.Enum):
    PENDING = "pending"
    AUTO_GRADED = "auto_graded"
    AI_GRADED = "ai_graded"
    MANUAL_GRADED = "manual_graded"
    COMPLETED = "completed"


class Exam(Base):
    __tablename__ = "exams"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    subject = Column(String(100), nullable=False)
    grade = Column(String(50))
    class_name = Column(String(100))
    exam_date = Column(DateTime)
    total_score = Column(Float, default=100.0)
    status = Column(String(20), default=ExamStatus.DRAFT)
    template_config = Column(JSON)
    description = Column(Text)
    scan_dir = Column(String(500))
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    answer_sheet_path = Column(String(1000))  # 生成的答题卡PDF路径

    questions = relationship("ExamQuestion", back_populates="exam", cascade="all, delete-orphan")
    scan_files = relationship("ScanFile", back_populates="exam", cascade="all, delete-orphan")
    student_exams = relationship("StudentExam", back_populates="exam", cascade="all, delete-orphan")
    students = relationship("Student", back_populates="exam", cascade="all, delete-orphan")


class ExamQuestion(Base):
    __tablename__ = "exam_questions"

    id = Column(Integer, primary_key=True, index=True)
    exam_id = Column(Integer, ForeignKey("exams.id"), nullable=False)
    question_number = Column(Integer, nullable=False)
    question_type = Column(String(20), nullable=False)
    max_score = Column(Float, nullable=False)
    standard_answer = Column(Text)
    answer_options = Column(JSON)
    region = Column(JSON)
    title = Column(Text)
    grading_criteria = Column(Text)
    order_index = Column(Integer, default=0)
    sub_questions = Column(JSON)
    answer_lines = Column(Integer, default=8)
    page = Column(String(10), nullable=True, default=None)

    exam = relationship("Exam", back_populates="questions")
    student_answers = relationship("StudentAnswer", back_populates="question", cascade="all, delete-orphan")


class ScanFile(Base):
    __tablename__ = "scan_files"

    id = Column(Integer, primary_key=True, index=True)
    exam_id = Column(Integer, ForeignKey("exams.id"), nullable=True)
    file_path = Column(String(500), nullable=False, unique=True)
    file_name = Column(String(500))
    file_size = Column(Integer)
    status = Column(String(20), default=ScanStatus.PENDING)
    error_message = Column(Text)
    page_count = Column(Integer, default=0)
    detected_student_id = Column(String(100))
    detected_student_name = Column(String(100))
    detected_page_side = Column(String(10))
    created_at = Column(DateTime, server_default=func.now())
    processed_at = Column(DateTime)

    exam = relationship("Exam", back_populates="scan_files")


class Student(Base):
    """按考试的考生名单（用于生成答题卡和快速识别身份）。"""
    __tablename__ = "students"

    id             = Column(Integer, primary_key=True, index=True)
    exam_id        = Column(Integer, ForeignKey("exams.id"), nullable=False)
    student_number = Column(String(50), nullable=False)   # 学号
    student_name   = Column(String(100))                  # 姓名（临时学号时可为空）
    class_name     = Column(String(100))                  # 班级
    seat_number    = Column(Integer)                      # 座号
    is_temp        = Column(Boolean, default=False)       # 是否临时学号
    created_at     = Column(DateTime, default=datetime.utcnow)

    exam = relationship("Exam", back_populates="students")
    student_exams = relationship("StudentExam", back_populates="student")


class StudentExam(Base):
    __tablename__ = "student_exams"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=True)
    exam_id = Column(Integer, ForeignKey("exams.id"), nullable=False)
    scan_file_id = Column(Integer, ForeignKey("scan_files.id"), nullable=True)
    student_name = Column(String(100))
    student_number = Column(String(50))
    class_name = Column(String(100))
    sheet_id = Column(String(100))      # 答题卡编号，如 "001"，用于关联正反面
    total_score = Column(Float)
    grading_status = Column(String(30), default=GradingStatus.PENDING)
    answer_sheet_image = Column(String(1000))
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    student = relationship("Student", back_populates="student_exams")
    exam = relationship("Exam", back_populates="student_exams")
    answers = relationship("StudentAnswer", back_populates="student_exam", cascade="all, delete-orphan")


class StudentAnswer(Base):
    __tablename__ = "student_answers"

    id = Column(Integer, primary_key=True, index=True)
    student_exam_id = Column(Integer, ForeignKey("student_exams.id"), nullable=False)
    question_id = Column(Integer, ForeignKey("exam_questions.id"), nullable=False)
    raw_answer = Column(Text)
    recognized_answer = Column(Text)
    score = Column(Float)
    ai_feedback = Column(Text)
    is_correct = Column(Boolean)
    grading_status = Column(String(30), default=GradingStatus.PENDING)
    answer_image_path = Column(String(1000))
    created_at = Column(DateTime, server_default=func.now())

    student_exam = relationship("StudentExam", back_populates="answers")
    question = relationship("ExamQuestion", back_populates="student_answers")
