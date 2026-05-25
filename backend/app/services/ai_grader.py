import os
import json
import base64
import httpx
from typing import Dict, Any, Optional

SETTINGS_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "ai_settings.json"
)


def load_ai_settings() -> Dict[str, Any]:
    if os.path.exists(SETTINGS_FILE):
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {
        "api_base_url": os.getenv("AI_API_URL", "https://api.openai.com/v1"),
        "api_key": os.getenv("AI_API_KEY", ""),
        "model_name": os.getenv("AI_MODEL", "gpt-4o-mini"),
        "api_provider": "openai",
        "max_tokens": 1000,
        "temperature": 0.3,
        "enabled": False,
    }


def save_ai_settings(settings: Dict[str, Any]):
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)


class AIGrader:
    def __init__(self):
        self.settings = load_ai_settings()

    async def grade(
        self,
        question_text: str,
        student_answer: str,
        criteria: str,
        max_score: float,
    ) -> Dict[str, Any]:
        if not self.settings.get("enabled") or not self.settings.get("api_key"):
            return {"score": 0.0, "feedback": "AI评分未启用，请在设置中配置API Key"}

        prompt = self._build_prompt(question_text, student_answer, criteria, max_score)
        try:
            result = await self._call_api(prompt)
            return result
        except Exception as e:
            return {"score": 0.0, "feedback": f"AI评分失败: {str(e)}"}

    def _build_prompt(
        self,
        question_text: str,
        student_answer: str,
        criteria: str,
        max_score: float,
    ) -> str:
        return f"""你是一位专业的中学阅卷老师，请根据以下信息对学生的答案进行评分。

【参考答案/题目要求】
{question_text}

【评分标准】
{criteria if criteria else "按照参考答案的完整性和准确性评分"}

【满分】{max_score}分

【学生答案】
{student_answer if student_answer else "（未作答）"}

请严格按照以下JSON格式返回评分结果（不要输出其他内容）：
{{
  "score": <0到{max_score}之间的数字，保留1位小数>,
  "feedback": "<简明扼要的评语，指出得分原因和扣分点，中文，不超过200字>"
}}"""

    async def _call_api(self, prompt: str) -> Dict[str, Any]:
        api_url = self.settings.get("api_base_url", self.settings.get("api_url", "https://api.openai.com/v1")).rstrip("/")
        api_key = self.settings["api_key"]
        model = self.settings.get("model_name", self.settings.get("model", "gpt-4o-mini"))

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": float(self.settings.get("temperature", 0.3)),
            "max_tokens": int(self.settings.get("max_tokens", 1000)),
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{api_url}/chat/completions",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

        content = data["choices"][0]["message"]["content"].strip()
        content = content.replace("```json", "").replace("```", "").strip()
        result = json.loads(content)
        score = float(result.get("score", 0))
        feedback = str(result.get("feedback", ""))
        return {"score": score, "feedback": feedback}

    async def grade_with_image(
        self,
        question_text: str,
        criteria: str,
        max_score: float,
        image_path: str,
    ) -> Dict[str, Any]:
        """用多模态模型直接识别答题区域截图，输出识别文字 + 得分 + 评语。"""
        if not self.settings.get("enabled") or not self.settings.get("api_key"):
            return {"score": 0.0, "recognized_text": "", "feedback": "AI评分未启用，请在设置中配置API Key"}
        try:
            with open(image_path, "rb") as f:
                image_data = base64.b64encode(f.read()).decode("utf-8")
        except Exception as e:
            return {"score": 0.0, "recognized_text": "", "feedback": f"图像读取失败: {e}"}
        ext = os.path.splitext(image_path)[1].lower().lstrip(".")
        mime = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext or 'png'}"
        prompt = (
            f"请仔细观察这张学生答题区域的图像，完成两项任务：\n\n"
            f"【参考答案/题目要求】\n{question_text or '（无参考答案，按内容合理评分）'}\n\n"
            f"【评分标准】\n{criteria or '按照参考答案的完整性和准确性评分'}\n\n"
            f"【满分】{max_score}分\n\n"
            f"任务：①识别图中学生的手写答案；②根据参考答案和评分标准给分。\n"
            f"请严格按以下JSON格式返回（不输出其他内容）：\n"
            f'{{"recognized_text":"<识别到的原文>","score":<0~{max_score}的数字保留1位小数>,"feedback":"<简明评语中文不超过150字>"}}'
        )
        try:
            return await self._call_api_multimodal(prompt, image_data, mime)
        except Exception as e:
            return {"score": 0.0, "recognized_text": "", "feedback": f"AI评分失败: {str(e)}"}

    async def _call_api_multimodal(self, prompt: str, image_data: str, mime: str) -> Dict[str, Any]:
        api_url = self.settings.get("api_base_url", self.settings.get("api_url", "https://api.openai.com/v1")).rstrip("/")
        api_key = self.settings["api_key"]
        model = self.settings.get("model_name", self.settings.get("model", "gpt-4o"))
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        payload = {
            "model": model,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {
                        "url": f"data:{mime};base64,{image_data}",
                        "detail": "high",
                    }},
                ],
            }],
            "temperature": float(self.settings.get("temperature", 0.3)),
            "max_tokens": int(self.settings.get("max_tokens", 1000)),
        }
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(f"{api_url}/chat/completions", headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
        content = data["choices"][0]["message"]["content"].strip()
        content = content.replace("```json", "").replace("```", "").strip()
        result = json.loads(content)
        return {
            "score": float(result.get("score", 0)),
            "feedback": str(result.get("feedback", "")),
            "recognized_text": str(result.get("recognized_text", "")),
        }

    async def recognize_choice_from_image(
        self,
        answer_options: list,
        image_path: str,
    ) -> Dict[str, Any]:
        """用多模态模型识别选择题中学生填写/涂写的选项字母（A/B/C/D等）。"""
        if not self.settings.get("enabled") or not self.settings.get("api_key"):
            return {"recognized_answer": ""}
        try:
            with open(image_path, "rb") as f:
                image_data = base64.b64encode(f.read()).decode("utf-8")
        except Exception:
            return {"recognized_answer": ""}
        ext = os.path.splitext(image_path)[1].lower().lstrip(".")
        mime = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext or 'png'}"
        options_str = "/".join((answer_options or ["A", "B", "C", "D"])[:6])
        prompt = (
            f"图片是选择题答题区域（选项：{options_str}）。"
            f"请识别学生填写或涂写的答案字母（单个字母）。"
            f"严格按此JSON返回："
            f'{{\"recognized_text\":\"<单个大写字母，无法识别则留空>\",\"score\":0,\"feedback\":\"\"}}'
        )
        try:
            result = await self._call_api_multimodal(prompt, image_data, mime)
            letter = result.get("recognized_text", "").strip().upper()[:1]
            return {"recognized_answer": letter}
        except Exception:
            return {"recognized_answer": ""}

    async def batch_grade_exam(self, exam_id: int, db) -> Dict[str, Any]:
        from app import models
        pending_answers = db.query(models.StudentAnswer).join(
            models.ExamQuestion,
            models.StudentAnswer.question_id == models.ExamQuestion.id
        ).filter(
            models.ExamQuestion.exam_id == exam_id,
            models.ExamQuestion.question_type.in_([
                models.QuestionType.SUBJECTIVE,
                models.QuestionType.FILL,
            ]),
            models.StudentAnswer.grading_status == models.GradingStatus.PENDING,
        ).all()

        success = 0
        for ans in pending_answers:
            q = ans.question
            sub_qs = q.sub_questions or []
            if sub_qs:
                question_text = '\n'.join(
                    f"{sq.get('label', '')} 参考答案：{sq.get('standard_answer', '')}"
                    for sq in sub_qs if isinstance(sq, dict)
                )
                criteria = '\n'.join(
                    f"{sq.get('label', '')} 评分标准：{sq.get('grading_criteria', '')}"
                    for sq in sub_qs
                    if isinstance(sq, dict) and sq.get('grading_criteria')
                ) or q.grading_criteria or ""
            else:
                question_text = q.standard_answer or ""
                criteria = q.grading_criteria or ""
            result = await self.grade(
                question_text=question_text,
                student_answer=ans.recognized_answer or "",
                criteria=criteria,
                max_score=q.max_score,
            )
            ans.score = result["score"]
            ans.ai_feedback = result["feedback"]
            ans.grading_status = models.GradingStatus.AI_GRADED
            success += 1

        db.commit()
        return {"graded": success}
