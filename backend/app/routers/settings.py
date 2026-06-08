from fastapi import APIRouter, Depends
from app import schemas
from app.services.ai_grader import load_ai_settings, save_ai_settings
from app.auth import get_current_user, get_admin_user

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/ai", response_model=dict)
def get_ai_settings(_user: dict = Depends(get_current_user)):
    s = load_ai_settings()
    s_masked = dict(s)
    if s_masked.get("api_key"):
        key = s_masked["api_key"]
        s_masked["api_key"] = key[:8] + "****" + key[-4:] if len(key) > 12 else "****"
    return s_masked


@router.put("/ai", response_model=dict)
def update_ai_settings(data: dict, _user: dict = Depends(get_admin_user)):
    current = load_ai_settings()
    if data.get("api_key") and "****" in data["api_key"]:
        data["api_key"] = current.get("api_key", "")
    current.update(data)
    save_ai_settings(current)
    return {"success": True}


@router.post("/ai/test", response_model=dict)
async def test_ai_connection(_user: dict = Depends(get_current_user)):
    import httpx
    settings = load_ai_settings()
    if not settings.get("api_key"):
        return {"success": False, "message": "未配置API Key"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            base_url = settings.get("api_base_url", settings.get("api_url", "")).rstrip("/")
            resp = await client.get(
                f"{base_url}/models",
                headers={"Authorization": f"Bearer {settings['api_key']}"},
            )
            if resp.status_code == 200:
                return {"success": True, "message": "连接成功"}
            else:
                return {"success": False, "message": f"响应码: {resp.status_code}"}
    except Exception as e:
        return {"success": False, "message": str(e)}
