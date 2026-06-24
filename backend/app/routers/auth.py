import random
import string
import time
from io import BytesIO
from PIL import Image, ImageDraw
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.auth import authenticate_user, create_access_token, get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])

_captcha_store: dict = {}


@router.get("/captcha")
def get_captcha():
    code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
    token = ''.join(random.choices(string.ascii_lowercase + string.digits, k=16))

    _captcha_store[token] = (code.upper(), time.time() + 300)

    expired = [k for k, v in _captcha_store.items() if v[1] < time.time()]
    for k in expired:
        del _captcha_store[k]

    img = Image.new('RGB', (120, 40), color=(245, 245, 245))
    draw = ImageDraw.Draw(img)

    for _ in range(3):
        x1 = random.randint(0, 120)
        y1 = random.randint(0, 40)
        x2 = random.randint(0, 120)
        y2 = random.randint(0, 40)
        draw.line([(x1, y1), (x2, y2)], fill=(180, 180, 180), width=1)

    for i, char in enumerate(code):
        x = 10 + i * 26 + random.randint(-3, 3)
        y = random.randint(5, 12)
        r = random.randint(30, 150)
        g = random.randint(30, 150)
        b = random.randint(30, 150)
        draw.text((x, y), char, fill=(r, g, b))

    for _ in range(30):
        x = random.randint(0, 120)
        y = random.randint(0, 40)
        draw.point((x, y), fill=(random.randint(0, 255), random.randint(0, 255), random.randint(0, 255)))

    buf = BytesIO()
    img.save(buf, format='PNG')
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="image/png",
        headers={"X-Captcha-Token": token}
    )


class LoginRequest(BaseModel):
    username: str
    password: str
    captcha: str
    captcha_token: str


@router.post("/login")
def login(req: LoginRequest):
    entry = _captcha_store.get(req.captcha_token)
    if not entry:
        raise HTTPException(status_code=400, detail="验证码已过期，请刷新")
    code, expire = entry
    if time.time() > expire:
        del _captcha_store[req.captcha_token]
        raise HTTPException(status_code=400, detail="验证码已过期，请刷新")
    if req.captcha.upper().strip() != code:
        raise HTTPException(status_code=400, detail="验证码错误")

    del _captcha_store[req.captcha_token]

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
