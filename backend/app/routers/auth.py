from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from app.auth import authenticate_user, create_access_token, get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(req: LoginRequest):
    user = authenticate_user(req.username, req.password)
    if not user:
        raise HTTPException(
            status_code=401,
            detail="用户名或密码错误，或账号暂无访问权限"
        )
    token = create_access_token({"sub": user["email"]})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "name": user["name"],
            "username": user["email"],
            "role": user["role"]
        }
    }


@router.post("/logout")
def logout():
    return {"message": "已退出登录"}


@router.get("/me")
def get_me(current_user: dict = Depends(get_current_user)):
    return {
        "name": current_user["name"],
        "username": current_user["email"],
        "role": current_user["role"]
    }
