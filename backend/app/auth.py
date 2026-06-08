import os
from datetime import datetime, timedelta
from typing import Optional
import bcrypt as _bcrypt
from jose import JWTError, jwt
from sqlalchemy import create_engine, text
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv

load_dotenv()

SECRET_KEY = os.getenv("JWT_SECRET", "aiss2-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

SHARED_DB_URL = (
    f"mysql+pymysql://{os.getenv('DB_USER','root')}:{os.getenv('DB_PASSWORD','')}@"
    f"{os.getenv('DB_HOST','localhost')}:{os.getenv('DB_PORT','3306')}"
    f"/junior_resource_share?charset=utf8mb4"
)
shared_engine = create_engine(SHARED_DB_URL, pool_pre_ping=True)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return _bcrypt.checkpw(plain_password.encode(), hashed_password.encode())


def create_access_token(data: dict) -> str:
    expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    return jwt.encode({**data, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def get_user_by_username(username: str) -> Optional[dict]:
    try:
        with shared_engine.connect() as conn:
            result = conn.execute(
                text("SELECT id, name, email, password_hash, role FROM users WHERE email = :username"),
                {"username": username}
            ).fetchone()
        if result:
            return dict(result._mapping)
    except Exception as e:
        print(f"[auth] 查询用户失败: {e}")
    return None


def authenticate_user(username: str, password: str) -> Optional[dict]:
    user = get_user_by_username(username)
    if not user:
        return None
    if not verify_password(password, user["password_hash"]):
        return None
    if user["role"] not in ("admin", "teacher"):
        return None
    return user


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="请先登录",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="登录已过期")
    except JWTError:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")

    user = get_user_by_username(username)
    if user is None:
        raise HTTPException(status_code=401, detail="用户不存在")
    return user


async def get_admin_user(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user["role"] != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限"
        )
    return current_user
