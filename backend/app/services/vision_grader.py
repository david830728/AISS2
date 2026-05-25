import base64
import json
import cv2
import numpy as np
import httpx
from typing import Dict, List, Optional

from app.services.ai_grader import load_ai_settings


class VisionGrader:
    """
    使用视觉大模型整体识别答题卡选择题区域。
    依赖 ai_settings.json 中的 API 配置；未启用或无视觉模型时返回 None 触发回退。
    """

    def __init__(self):
        self.settings = load_ai_settings()

    def is_available(self) -> bool:
        """是否已配置且启用了支持视觉的 API。"""
        return bool(
            self.settings.get("enabled")
            and self.settings.get("api_key")
            and (self.settings.get("vision_model") or self.settings.get("model_name") or self.settings.get("model"))
        )

    async def recognize_choices_by_vision(
        self,
        region_img: np.ndarray,
        question_numbers: List[int],
        options: List[str] = None,
        standard_answers: Optional[Dict[int, str]] = None,
    ) -> Optional[Dict[int, str]]:
        """
        对整个选择题大区域截图进行视觉识别。

        Args:
            region_img:       选择题区域的 BGR ndarray（已裁剪到题目区域）
            question_numbers: 该区域包含的题号列表，如 [1, 2, 3, 4, 5]
            options:          选项列表，默认 ["A","B","C","D"]

        Returns:
            {题号: 选项字符串} 字典，识别失败时返回 None（调用方应回退到逐题 OCR）
        """
        if options is None:
            options = ["A", "B", "C", "D"]

        if not self.is_available():
            return None

        try:
            img_b64 = self._img_to_base64(region_img)
            result = await self._call_vision_api(img_b64, question_numbers, options, standard_answers)
            return result
        except Exception as e:
            print(f"[VisionGrader] recognize_choices_by_vision 失败: {e}，选择题将记 0 分")
            return None

    # ── 内部方法 ────────────────────────────────────────────────────────────────

    @staticmethod
    def _img_to_base64(img: np.ndarray) -> str:
        _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
        return base64.b64encode(buf.tobytes()).decode("utf-8")

    async def _call_vision_api(
        self,
        img_b64: str,
        question_numbers: List[int],
        options: List[str],
        standard_answers: Optional[Dict[int, str]] = None,
    ) -> Dict[int, str]:
        api_url = self.settings.get(
            "api_base_url", "https://api.openai.com/v1"
        ).rstrip("/")
        api_key  = self.settings["api_key"]
        model    = (
            self.settings.get("vision_model")
            or self.settings.get("model_name")
            or self.settings.get("model", "gpt-4o")
        )

        example_json = "{" + ", ".join(f'"{n}": "A"' for n in question_numbers) + "}"

        prompt_text = (
            f"这是答题卡手写选择题区域截图。\n"
            f"表格格式：第一行是题号（深色背景），第二行是学生用钢笔/铅笔手写的答案字母。\n"
            f"多道选择题从左到右排列，每题占一格。\n\n"
            f"请识别每格内学生手写的答案字母（A/B/C/D，多选题如 AB）。\n"
            f"题号列表：{question_numbers}\n\n"
            f"要求：\n"
            f"- 只读答题格（浅色背景），不读题号标题行\n"
            f"- 输出大写字母，多选按字母顺序排列（如 AB，不要写 BA）\n"
            f"- 空白格或无法识别输出 null\n"
            f"- 只输出 JSON，不要任何解释文字\n\n"
            f"输出格式：\n{example_json}"
        )

        payload = {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"},
                        },
                        {"type": "text", "text": prompt_text},
                    ],
                }
            ],
            "temperature": 0.0,
            "max_tokens": 512,
        }

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{api_url}/chat/completions", headers=headers, json=payload
            )
            resp.raise_for_status()
            data = resp.json()

        raw = data["choices"][0]["message"]["content"].strip()
        raw = raw.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(raw)

        valid_set = set(options)
        result: Dict[int, str] = {}
        for qn in question_numbers:
            val = parsed.get(str(qn))
            if not isinstance(val, str) or val.strip().lower() in ("", "null", "none"):
                continue
            letters = "".join(c for c in val.upper() if c in valid_set)
            if letters:
                result[qn] = "".join(sorted(letters))
        return result


def compute_choices_bbox(
    questions,
    img_shape: tuple,
) -> Optional[Dict[str, float]]:
    """
    从选择题列表的 region 字段自动计算包围盒（0~1 相对坐标）。
    返回 {"x": ..., "y": ..., "width": ..., "height": ...} 或 None。
    """
    xs, ys, x2s, y2s = [], [], [], []
    for q in questions:
        r = q.region
        if not r:
            continue
        xs.append(r.get("x", 0))
        ys.append(r.get("y", 0))
        x2s.append(r.get("x", 0) + r.get("width", 0))
        y2s.append(r.get("y", 0) + r.get("height", 0))

    if not xs:
        return None

    return {
        "x": min(xs),
        "y": min(ys),
        "width": max(x2s) - min(xs),
        "height": max(y2s) - min(ys),
    }
