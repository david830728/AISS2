import cv2
import numpy as np
from PIL import Image
import os
import io
from typing import Optional, Tuple, List, Dict, Any, cast


class ImageProcessor:
    """
    Core image processing utilities for exam paper analysis.
    Handles: loading, deskewing, normalizing, region extraction.
    """

    def load_image(self, file_path: str) -> Optional[np.ndarray]:
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"文件不存在，请确认路径正确或重新上传: {file_path}")

        ext = os.path.splitext(file_path)[1].lower()
        if ext == ".pdf":
            return self._pdf_to_image(file_path)

        img = cv2.imread(file_path)
        if img is None:
            try:
                pil = Image.open(file_path).convert("RGB")
                img = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
            except Exception as e:
                raise ValueError(f"无法读取图像文件: {e}")
        return img

    def pdf_to_pages(self, file_path: str) -> List[np.ndarray]:
        """将 PDF 每页独立渲染为 BGR ndarray，返回列表。"""
        try:
            import fitz  # PyMuPDF
        except ImportError:
            raise ValueError("PDF 处理需要安装 PyMuPDF，请执行: pip install pymupdf")

        doc = fitz.open(file_path)
        if doc.page_count == 0:
            raise ValueError("PDF 文件无页面内容")

        pages: List[np.ndarray] = []
        for i in range(doc.page_count):
            page = doc[i]
            mat = fitz.Matrix(2.0, 2.0)  # 144 DPI
            pix = page.get_pixmap(matrix=mat)
            arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
                pix.height, pix.width, pix.n
            )
            if pix.n == 4:
                arr = cv2.cvtColor(arr, cv2.COLOR_RGBA2BGR)
            elif pix.n == 3:
                arr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
            elif pix.n == 1:
                arr = cv2.cvtColor(arr, cv2.COLOR_GRAY2BGR)
            pages.append(arr)
        doc.close()
        return pages

    def _pdf_to_image(self, file_path: str) -> np.ndarray:
        """向后兼容别名：返回第一页图像。"""
        pages = self.pdf_to_pages(file_path)
        return pages[0] if pages else np.zeros((100, 100, 3), dtype=np.uint8)

    def align_by_markers(self, img: np.ndarray, paper_size: Optional[str] = None) -> np.ndarray:
        """
        通过检测答题卡四角定位方块进行透视矫正，将扫描图像对齐到标准纸张尺寸。

        答题卡设计规范（供生成与识别统一使用）：
          - 定位方块：1cm × 1cm 实心黑色正方形
          - 位置：四角，距纸张边缘 0.5cm
          - 周围保留充足留白，不要紧邻文字或线条

        处理流程：
          1. 转灰度 → OTSU 自适应二值化（定位块反白为前景）
          2. 形态学闭运算去噪
          3. 找外轮廓，筛选面积与长宽比符合定位方块特征的候选
          4. 按图像四象限各取一个候选，取最靠近角落者
          5. 根据定位块围成区域的 h/w 比判断竖横向，
             根据其面积占扫描图比例区分 A4/A3
          6. getPerspectiveTransform → warpPerspective 输出标准尺寸图像
          7. 任何步骤失败均回退到 deskew，打印警告日志
        """
        # ── 可调参数常量（动态按图像面积计算，兼容手机/扫描仪不同分辨率）──────
        # 面积阈值将在 img_h/img_w 确定后动态设置（见下方）
        MARKER_ASPECT_MIN  = 0.3    # 定位方块最小宽高比（宽/高）
        MARKER_ASPECT_MAX  = 3.5    # 定位方块最大宽高比（宽/高）
        # 定位区域面积占扫描图总面积比例超过此阈值则判为 A3，否则为 A4
        A3_AREA_RATIO_THRESH = 0.60

        # 标准输出尺寸（300 DPI，单位 px）
        # A4：210×297mm  A3：297×420mm
        A4_PORTRAIT  = (2480, 3508)
        A4_LANDSCAPE = (3508, 2480)
        A3_PORTRAIT  = (3508, 4961)
        A3_LANDSCAPE = (4961, 3508)

        # 定位方块中心距输出图像边缘的像素距离（300 DPI）
        # 前端常量：MARKER_OFF=14pt, MARKER_W=24pt, MARKER_H=16pt
        # 水平中心：(14 + 24/2) pt × 300/72 = 26 × 4.167 ≈ 108 px
        # 垂直中心：(14 + 16/2) pt × 300/72 = 22 × 4.167 ≈  92 px
        MARKER_MARGIN_X = round(26 * 300 / 72)   # = 108
        MARKER_MARGIN_Y = round(22 * 300 / 72)   # =  92

        try:
            img_h, img_w = img.shape[:2]
            img_area = img_h * img_w
            # 动态面积阈值：按图像总面积比例，兼容不同分辨率
            MARKER_AREA_MIN = img_area * 0.0002
            MARKER_AREA_MAX = img_area * 0.0025

            # ── 步骤1：灰度化 → OTSU 二值化（黑色定位块反转为白色前景） ─────────
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            _, binary = cv2.threshold(
                gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU
            )

            # ── 步骤2：形态学闭运算，填补块内空洞并去除细小噪点 ─────────────────
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
            binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

            # ── 步骤3：查找最外层轮廓 ─────────────────────────────────────────
            contours, _ = cv2.findContours(
                binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )

            # ── 步骤4：筛选面积与长宽比符合定位方块特征的候选轮廓 ─────────────────
            candidates = []   # 格式：(质心x, 质心y, 面积)
            rejected_area_ok = []  # 通过面积但被其他条件过滤的，供调试用
            for cnt in contours:
                area = cv2.contourArea(cnt)
                if not (MARKER_AREA_MIN <= area <= MARKER_AREA_MAX):
                    continue
                bx, by, bw, bh = cv2.boundingRect(cnt)
                if bh == 0:
                    continue
                aspect = bw / float(bh)
                m_cnt = cv2.moments(cnt)
                if m_cnt["m00"] == 0:
                    continue
                cx = m_cnt["m10"] / m_cnt["m00"]
                cy = m_cnt["m01"] / m_cnt["m00"]
                pass_aspect = MARKER_ASPECT_MIN <= aspect <= MARKER_ASPECT_MAX
                if not pass_aspect:
                    rejected_area_ok.append((cx, cy, area, aspect))
                    continue
                candidates.append((cx, cy, area))

            if len(candidates) < 4:
                print(
                    f"[align_by_markers] 警告：仅找到 {len(candidates)} 个候选定位块"
                    f"（需要4个），回退到 deskew"
                )
                print(f"[DEBUG] 候选不足，当前候选列表：")
                for cx, cy, area in candidates:
                    print(f"  cx={cx:.0f} cy={cy:.0f} area={area:.0f}")
                print(f"[DEBUG] 通过面积但被其他条件过滤的轮廓（共{len(rejected_area_ok)}个）：")
                for cx, cy, area, aspect in rejected_area_ok:
                    print(f"  cx={cx:.0f} cy={cy:.0f} area={area:.0f} 过滤原因：aspect={aspect:.2f}超出[{MARKER_ASPECT_MIN},{MARKER_ASPECT_MAX}]")
                return self.deskew(img)

            # ── 步骤5：按图像四象限各取一个定位块（最靠近角落者） ─────────────────
            half_w, half_h = img_w / 2.0, img_h / 2.0

            tl_cands = [(cx, cy) for cx, cy, _ in candidates if cx <  half_w and cy <  half_h]
            tr_cands = [(cx, cy) for cx, cy, _ in candidates if cx >= half_w and cy <  half_h]
            bl_cands = [(cx, cy) for cx, cy, _ in candidates if cx <  half_w and cy >= half_h]
            br_cands = [(cx, cy) for cx, cy, _ in candidates if cx >= half_w and cy >= half_h]

            if not (tl_cands and tr_cands and bl_cands and br_cands):
                print(
                    f"[align_by_markers] 警告：四象限定位块数量不足 "
                    f"(TL={len(tl_cands)} TR={len(tr_cands)} "
                    f"BL={len(bl_cands)} BR={len(br_cands)})，回退到 deskew"
                )
                return self.deskew(img)

            def _nearest(pts, corner_x, corner_y):
                """取候选列表中距指定角落最近的点。"""
                return min(
                    pts,
                    key=lambda p: (p[0] - corner_x) ** 2 + (p[1] - corner_y) ** 2,
                )

            tl = np.float32(_nearest(tl_cands, 0,      0))
            tr = np.float32(_nearest(tr_cands, img_w,   0))
            bl = np.float32(_nearest(bl_cands, 0,      img_h))
            br = np.float32(_nearest(br_cands, img_w,  img_h))

            # ── 步骤6：计算定位区域长宽，判断纸张规格与方向 ──────────────────────
            # 水平跨度（TL→TR 与 BL→BR 的均值）
            quad_w = (
                float(np.linalg.norm(tr - tl)) + float(np.linalg.norm(br - bl))
            ) / 2.0
            # 垂直跨度（TL→BL 与 TR→BR 的均值）
            quad_h = (
                float(np.linalg.norm(bl - tl)) + float(np.linalg.norm(br - tr))
            ) / 2.0

            if quad_w < 1 or quad_h < 1:
                print("[align_by_markers] 警告：定位区域尺寸异常，回退到 deskew")
                return self.deskew(img)

            # 判断纸张规格：优先使用考试已存储的纸张规格，否则用定位块面积推断 DPI
            if paper_size is not None:
                is_a3 = paper_size.upper() == 'A3'
                _paper_long_in = (420 if is_a3 else 297) / 25.4
                print(f"[align_by_markers] 纸张规格由考试配置指定: {paper_size.upper()}")
            else:
                # 设计尺寸：宽 24pt × 高 16pt（与前端 MARKER_W/MARKER_H 常量一致）
                _mean_area = sum(a for _, _, a in candidates) / len(candidates)
                _est_dpi   = 72.0 * (_mean_area / (24.0 * 16.0)) ** 0.5
                _paper_long_in = max(quad_w, quad_h) / _est_dpi + 2 * (14.0 / 72.0)
                is_a3 = _paper_long_in > (297 + 420) / 2 / 25.4
                print(f"[align_by_markers] 估算DPI={_est_dpi:.0f} 纸张长边={_paper_long_in*25.4:.0f}mm "
                      f"→ 自动判定为{'A3' if is_a3 else 'A4'}")

            # h/w > 1 → 竖向（portrait）；h/w < 1 → 横向（landscape）
            is_portrait = (quad_h / quad_w) > 1.0

            if is_a3:
                out_w, out_h = A3_PORTRAIT if is_portrait else A3_LANDSCAPE
            else:
                out_w, out_h = A4_PORTRAIT if is_portrait else A4_LANDSCAPE

            print(
                f"[align_by_markers] 检测到 {'A3' if is_a3 else 'A4'} "
                f"{'竖向' if is_portrait else '横向'} "
                f"(长边≈{_paper_long_in*25.4:.0f}mm, h/w={quad_h/quad_w:.3f})，"
                f"输出 {out_w}×{out_h} px"
            )

            # ── 步骤7：构造透视变换的源点与目标点 ────────────────────────────────
            # 目标点：定位方块中心在输出图像中的预期坐标（X/Y 分离）
            mx = float(MARKER_MARGIN_X)
            my = float(MARKER_MARGIN_Y)
            dst_tl = np.float32([mx,          my])
            dst_tr = np.float32([out_w - mx,  my])
            dst_bl = np.float32([mx,          out_h - my])
            dst_br = np.float32([out_w - mx,  out_h - my])

            src_pts = np.float32([tl, tr, bl, br])
            dst_pts = np.float32([dst_tl, dst_tr, dst_bl, dst_br])

            # 诊断日志：实际检测到的定位块中心，与目标位置对比
            print(
                f"[align_by_markers] 检测到定位块中心（扫描图 {img_w}×{img_h}）:\n"
                f"  TL=({tl[0]:.1f},{tl[1]:.1f})  TR=({tr[0]:.1f},{tr[1]:.1f})\n"
                f"  BL=({bl[0]:.1f},{bl[1]:.1f})  BR=({br[0]:.1f},{br[1]:.1f})\n"
                f"  quad_w={quad_w:.1f}  quad_h={quad_h:.1f}  h/w={quad_h/quad_w:.4f}\n"
                f"  目标: TL=({mx:.0f},{my:.0f}) TR=({out_w-mx:.0f},{my:.0f})"
                f" BL=({mx:.0f},{out_h-my:.0f}) BR=({out_w-mx:.0f},{out_h-my:.0f})"
            )

            # ── 步骤8：透视变换，输出标准尺寸矫正图像 ────────────────────────────
            M_persp = cv2.getPerspectiveTransform(src_pts, dst_pts)
            aligned = cv2.warpPerspective(
                img, M_persp, (out_w, out_h),
                flags=cv2.INTER_CUBIC,
                borderMode=cv2.BORDER_REPLICATE,
            )
            return aligned

        except Exception as e:
            print(f"[align_by_markers] 异常: {e}，回退到 deskew")
            return self.deskew(img)

    def deskew(self, img: np.ndarray) -> np.ndarray:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        gray = cv2.bitwise_not(gray)
        thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
        coords = np.column_stack(np.where(thresh > 0))
        if len(coords) == 0:
            return img
        angle = cv2.minAreaRect(coords)[-1]
        if angle < -45:
            angle = -(90 + angle)
        else:
            angle = -angle
        if abs(angle) < 0.5:
            return img
        h, w = img.shape[:2]
        center = (w // 2, h // 2)
        M = cv2.getRotationMatrix2D(center, angle, 1.0)
        rotated = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_CUBIC,
                                  borderMode=cv2.BORDER_REPLICATE)
        return rotated

    def normalize(self, img: np.ndarray, target_width: int = 2480) -> np.ndarray:
        h, w = img.shape[:2]
        if w == target_width:
            return img
        scale = target_width / w
        new_h = int(h * scale)
        return cv2.resize(img, (target_width, new_h))

    def enhance_for_ocr(self, img: np.ndarray) -> np.ndarray:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)
        denoised = cv2.fastNlMeansDenoising(enhanced, h=10)
        return denoised

    def extract_region(self, img: np.ndarray, region: Dict[str, Any]) -> np.ndarray:
        """Extract a sub-region from image using relative coordinates (0-1 scale)."""
        h, w = img.shape[:2]
        x = int(region.get("x", 0) * w)
        y = int(region.get("y", 0) * h)
        rw = int(region.get("width", 1) * w)
        rh = int(region.get("height", 1) * h)
        x = max(0, x)
        y = max(0, y)
        x2 = min(w, x + rw)
        y2 = min(h, y + rh)
        return img[y:y2, x:x2]

    def extract_region_abs(self, img: np.ndarray, x: int, y: int, w: int, h: int) -> np.ndarray:
        img_h, img_w = img.shape[:2]
        x = max(0, x)
        y = max(0, y)
        x2 = min(img_w, x + w)
        y2 = min(img_h, y + h)
        return img[y:y2, x:x2]

    def detect_filled_bubble(self, region: np.ndarray) -> float:
        """Return fill ratio (0-1) for a bubble/checkbox region."""
        if region.size == 0:
            return 0.0
        if len(region.shape) == 3:
            gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
        else:
            gray = region
        _, binary = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
        fill_ratio = np.sum(binary > 0) / binary.size
        return float(fill_ratio)

    def detect_checked_option(self, img: np.ndarray, options: List[Dict[str, Any]]) -> Optional[str]:
        """
        Given a list of bubble/checkbox option regions, return the selected option label.
        options: [{"label": "A", "region": {...}}, ...]
        """
        scores = {}
        for opt in options:
            region = self.extract_region(img, opt["region"])
            scores[opt["label"]] = self.detect_filled_bubble(region)

        if not scores:
            return None
        best = max(scores, key=lambda k: scores[k])
        if scores[best] > 0.15:
            return best
        return None

    def save_region_image(self, region: np.ndarray, save_path: str) -> str:
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        cv2.imwrite(save_path, region)
        return save_path

    def img_to_bytes(self, img: np.ndarray, ext: str = ".jpg") -> bytes:
        _, buf = cv2.imencode(ext, img)
        return buf.tobytes()

    def detect_barcode_or_qr(self, img: np.ndarray) -> Optional[str]:
        """Try to detect QR code or barcode for student ID recognition."""
        try:
            from pyzbar import pyzbar
            decoded = pyzbar.decode(img)
            if decoded:
                return decoded[0].data.decode("utf-8")
        except ImportError:
            pass
        return None

    def _decode_qr(self, img: np.ndarray) -> str:
        """尝试多种方式解码二维码，返回内容字符串或None"""
        attempts = [img]

        if len(img.shape) == 3:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        else:
            gray = img
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        binary_bgr = cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)
        attempts.append(binary_bgr)

        enlarged = cv2.resize(img, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        attempts.append(enlarged)

        for attempt in attempts:
            # OpenCV WeChat解码器
            try:
                wechat = cv2.wechat_qrcode_WeChatQRCode()
                texts, _ = wechat.detectAndDecode(attempt)
                if texts and texts[0]:
                    return texts[0]
            except Exception:
                pass

            # OpenCV基础解码器
            try:
                detector = cv2.QRCodeDetector()
                data, _, _ = detector.detectAndDecode(attempt)
                if data:
                    return data
            except Exception:
                pass

            # pyzbar
            try:
                from pyzbar import pyzbar
                decoded = pyzbar.decode(attempt)
                if decoded:
                    return decoded[0].data.decode("utf-8")
            except Exception:
                pass

        return None

    def detect_page_label_full(self, img: np.ndarray) -> dict:
        """
        识别二维码，返回完整信息。
        格式：{exam_id}_{student_number}_{page_label}
        返回：{"exam_id": "2", "student_number": "20230128", "page_label": "A"}
        识别失败返回 None
        """
        qr_region = self.extract_region(img,
            {"x": 0.38, "y": 0.005, "width": 0.24, "height": 0.08})

        content = self._decode_qr(qr_region)
        if not content:
            # 尝试全图识别
            content = self._decode_qr(img)

        if content:
            parts = content.split("_")
            if len(parts) >= 3:
                label = parts[2].upper()
                if label in {"A", "B", "C", "D"}:
                    print(f"[detect_page_label_full] 识别成功: {content}")
                    return {
                        "exam_id": parts[0],
                        "student_number": parts[1],
                        "page_label": label,
                        "raw": content
                    }

        print(f"[detect_page_label_full] 识别失败")
        return None

    def detect_page_info(self, img: np.ndarray) -> dict:
        """
        在图像顶部居中区域检测 QR 码。
        支持两种格式：
          新格式：{exam_id}_{student_number}_{page_label}  → "2_20230128_A"
          旧格式：{exam_id}_{page_label}                   → "2_A"
        返回：
          {"exam_id": str|None, "student_number": str|None,
           "page_label": str, "raw": str|None}
        识别失败时返回 {"page_label": "A", "exam_id": None, "student_number": None, "raw": None}
        """
        FAIL = {"page_label": "A", "exam_id": None, "student_number": None, "raw": None}

        qr_region = self.extract_region(
            img, {"x": 0.83, "y": 0.02, "width": 0.16, "height": 0.12}
        )
        print(f"[detect_page_info] 二维码裁剪区域尺寸: {qr_region.shape}")

        def _parse(raw: str) -> dict | None:
            parts = raw.strip().split("_")
            if len(parts) >= 3:
                label = parts[-1].upper()
                if label in {"A", "B", "C", "D"}:
                    return {"exam_id": parts[0], "student_number": parts[1],
                            "page_label": label, "raw": raw}
            if len(parts) == 2:
                label = parts[-1].upper()
                if label in {"A", "B", "C", "D"}:
                    return {"exam_id": parts[0], "student_number": None,
                            "page_label": label, "raw": raw}
            return None

        def _try_decode(img_arr) -> dict | None:
            # pyzbar
            try:
                from pyzbar import pyzbar
                decoded = pyzbar.decode(img_arr)
                if decoded:
                    content = decoded[0].data.decode("utf-8")
                    print(f"[detect_page_info] pyzbar: {content}")
                    return _parse(content)
            except ImportError:
                pass
            except Exception as e:
                print(f"[detect_page_info] pyzbar异常: {e}")
            # OpenCV
            try:
                det = cv2.QRCodeDetector()
                data, _, _ = det.detectAndDecode(img_arr)
                if data:
                    print(f"[detect_page_info] OpenCV: {data}")
                    return _parse(data)
            except Exception as e:
                print(f"[detect_page_info] OpenCV异常: {e}")
            return None

        gray = cv2.cvtColor(qr_region, cv2.COLOR_BGR2GRAY)
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        binary_bgr = cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)
        up = max(2.0, 400 / max(1, min(qr_region.shape[:2])))
        enlarged = cv2.resize(qr_region, None, fx=up, fy=up, interpolation=cv2.INTER_CUBIC)
        enlarged_bin = cv2.resize(binary_bgr, None, fx=up, fy=up, interpolation=cv2.INTER_NEAREST)

        for attempt in [qr_region, binary_bgr, enlarged, enlarged_bin]:
            result = _try_decode(attempt)
            if result:
                return result

        print("[detect_page_info] 未识别到有效二维码，默认 A 面")
        return FAIL

    def detect_page_label(self, img: np.ndarray) -> str:
        """向后兼容包装，返回面序号字符串。"""
        return self.detect_page_info(img)["page_label"]
    def find_answer_areas_by_template(
        self,
        img: np.ndarray,
        template_config: Dict[str, Any]
    ) -> Dict[str, np.ndarray]:
        """
        Use template_config to locate and extract answer regions.
        Returns dict mapping question_number -> cropped image.
        """
        results = {}
        regions = template_config.get("regions", [])
        for region_def in regions:
            qnum = region_def.get("question_number")
            region = region_def.get("region")
            if qnum and region:
                cropped = self.extract_region(img, region)
                results[str(qnum)] = cropped
        return results
