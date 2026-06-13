import os
from urllib.parse import quote_plus
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()

DB_HOST     = os.getenv("DB_HOST", "localhost")
DB_PORT     = os.getenv("DB_PORT", "3306")
DB_USER     = os.getenv("DB_USER", "root")
DB_PASSWORD = quote_plus(os.getenv("DB_PASSWORD", "123456"))
DB_NAME     = os.getenv("DB_NAME", "ai_grading")

SQLALCHEMY_DATABASE_URL = (
    f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    f"?charset=utf8mb4"
)

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_recycle=3600,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from app import models  # noqa: F401
    Base.metadata.create_all(bind=engine)


def migrate_db():
    """Add new columns to existing tables without dropping data."""
    from sqlalchemy import text
    migrations = [
        "ALTER TABLE exam_questions ADD COLUMN sub_questions TEXT",
        "ALTER TABLE exam_questions ADD COLUMN title TEXT",
        "ALTER TABLE student_exams ADD COLUMN sheet_id VARCHAR(100)",
        "ALTER TABLE exam_questions ADD COLUMN answer_lines INTEGER DEFAULT 8",
        "ALTER TABLE exam_questions ADD COLUMN page VARCHAR(10) DEFAULT 'A'",
        "ALTER TABLE exams ADD COLUMN answer_sheet_path VARCHAR(1000)",
        "ALTER TABLE students ADD COLUMN exam_id INTEGER REFERENCES exams(id)",
        "ALTER TABLE students ADD COLUMN student_number VARCHAR(50)",
        "ALTER TABLE students ADD COLUMN student_name VARCHAR(100)",
        "ALTER TABLE students ADD COLUMN seat_number INTEGER",
        "ALTER TABLE students ADD COLUMN is_temp BOOLEAN DEFAULT 0",
        "ALTER TABLE scan_files ADD COLUMN detected_page_side VARCHAR(10)",
    ]
    with engine.connect() as conn:
        for stmt in migrations:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass
