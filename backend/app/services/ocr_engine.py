import numpy as np
import cv2
from typing import Optional, List, Dict, Any
import os
import re

_reader = None


def get_ocr_reader():
    global _reader
    if _reader is None:
        try:
            import easyocr
            _reader = easyocr.Reader(["ch_sim", "en"], gpu=False, verbose=False)
        except Exception:
            _reader = None
    return _reader


class OCREngine:
    """
    OCR engine for recognizing text in exam answer regions.
    Supports fill-in and subjective answer recognition.
    """

    def recognize_text(self, img: np.ndarray) -> str:
        reader = get_ocr_reader()
        if reader is None:
            return self._fallback_ocr(img)
        try:
            results = reader.readtext(img, detail=0, paragraph=True)
            return " ".join(results).strip()
        except Exception:
            return self._fallback_ocr(img)

    def _fallback_ocr(self, img: np.ndarray) -> str:
        try:
            import pytesseract
            if len(img.shape) == 3:
                gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            else:
                gray = img
            _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
            text = pytesseract.image_to_string(binary, lang="chi_sim+eng", config="--psm 6")
            return text.strip()
        except Exception:
            return ""

    def recognize_choice_answer(
        self,
        img: np.ndarray,
        options: Optional[List[str]] = None
    ) -> Optional[str]:
        """
        For multiple-choice questions: detect which option bubble is filled.
        Falls back to text recognition if no bubble layout defined.
        """
        if options is None:
            options = ["A", "B", "C", "D"]

        if len(img.shape) == 3:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        else:
            gray = img

        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
        h, w = binary.shape

        if h < 20 or w < 20:
            return self._recognize_text_choice(img, options)

        n = len(options)
        slot_w = w // n
        scores = {}
        for i, opt in enumerate(options):
            x1 = i * slot_w
            x2 = min(w, (i + 1) * slot_w)
            slot = binary[:, x1:x2]
            scores[opt] = float(np.sum(slot > 0)) / (slot.size + 1e-6)

        best = max(scores, key=lambda k: scores[k])
        if scores[best] > 0.08:
            return best

        return self._recognize_text_choice(img, options)

    def _recognize_text_choice(self, img: np.ndarray, options: List[str]) -> Optional[str]:
        text = self.recognize_text(img).upper().strip()
        for opt in options:
            if opt in text:
                return opt
        letters = re.findall(r"[A-Da-d]", text)
        if letters:
            return letters[0].upper()
        return None

    def recognize_fill_answer(self, img: np.ndarray) -> str:
        text = self.recognize_text(img)
        text = re.sub(r"\s+", " ", text).strip()
        return text

    def recognize_subjective_answer(self, img: np.ndarray) -> str:
        text = self.recognize_text(img)
        return text.strip()

    def recognize_student_id(self, img: np.ndarray) -> Optional[str]:
        text = self.recognize_text(img)
        numbers = re.findall(r"\d{6,12}", text)
        if numbers:
            return numbers[0]
        return None

    def recognize_student_name(self, img: np.ndarray) -> Optional[str]:
        text = self.recognize_text(img)
        text = re.sub(r"[^\u4e00-\u9fff\u3400-\u4dbfA-Za-z\s]", "", text).strip()
        if 1 < len(text) <= 10:
            return text
        return None
