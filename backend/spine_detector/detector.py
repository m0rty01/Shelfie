"""
Local pretrained spine detection using Tesseract LSTM.

Why Tesseract instead of YOLOv8n-COCO:
  - YOLOv8n is trained on COCO "book" class which represents books lying flat
    or open — not book spines on a shelf. Wrong training distribution.
  - Book spines are TEXT REGIONS. Tesseract 4+ uses a pretrained LSTM neural
    network (trained on 4500+ fonts across 117 languages) to detect text.
  - Using a text detector for text regions is semantically correct.

Strategy:
  1. Rotate shelf image 90° — spines become horizontal text blocks.
  2. Run Tesseract LSTM in block-level segmentation mode (PSM 3).
  3. Each detected text block = one book spine.
  4. Map bounding boxes back to original orientation.
  5. OpenCV column-projection fallback if Tesseract returns nothing.
"""
from __future__ import annotations

import logging
from typing import List, Tuple

import cv2
import numpy as np

logger = logging.getLogger("shelfie.spine_detector")

Box = Tuple[int, int, int, int]  # (x, y, w, h)

# ── Try to import pytesseract and auto-detect tessdata path ─────────────────
try:
    import os as _os
    import pytesseract
    from pytesseract import Output

    # Auto-detect tessdata directory — handles snap, apt, brew, etc.
    _TESSDATA_CANDIDATES = [
        # snap installation
        "/snap/tesseract/current/usr/local/share/tessdata",
        "/snap/tesseract/current/usr/share/tessdata",
        # apt installation
        "/usr/share/tesseract-ocr/5/tessdata",
        "/usr/share/tessdata",
        "/usr/local/share/tessdata",
    ]
    for _candidate in _TESSDATA_CANDIDATES:
        if _os.path.isfile(_os.path.join(_candidate, "eng.traineddata")):
            _os.environ.setdefault("TESSDATA_PREFIX", _os.path.dirname(_candidate))
            logger.info("Set TESSDATA_PREFIX=%s", _os.environ["TESSDATA_PREFIX"])
            break

    _TESSERACT_AVAILABLE = True
    _ver = pytesseract.get_tesseract_version()
    logger.info(
        "Tesseract LSTM %s loaded — using pretrained text detector for spine detection", _ver
    )
except Exception as exc:
    _TESSERACT_AVAILABLE = False
    logger.warning(
        "pytesseract not available (%s) — falling back to OpenCV heuristic. "
        "Install with: sudo apt install tesseract-ocr && pip install pytesseract",
        exc,
    )


def _detect_tesseract(img_bgr: np.ndarray) -> List[Box]:
    """
    Rotate image 90° CW, run Tesseract block-level page segmentation to find
    text regions (= book spines), then rotate boxes back.
    """
    H, W = img_bgr.shape[:2]

    # Rotate 90° clockwise so vertical spines become horizontal text lines
    rotated = cv2.rotate(img_bgr, cv2.ROTATE_90_CLOCKWISE)
    rH, rW = rotated.shape[:2]   # rH = original W, rW = original H

    # Enhance contrast for better text detection
    gray = cv2.cvtColor(rotated, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)
    enhanced = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)

    # PSM 3 = Fully automatic page segmentation (no OSD)
    # OEM 1 = LSTM neural net only (the pretrained model)
    config = "--psm 3 --oem 1"
    data = pytesseract.image_to_data(enhanced, config=config, output_type=Output.DICT)

    # Collect block-level bounding boxes with enough text content
    blocks: dict[int, list] = {}
    for i, conf in enumerate(data["conf"]):
        block_num = data["block_num"][i]
        text = (data["text"][i] or "").strip()
        if int(conf) < 0 or not text:
            continue
        if block_num not in blocks:
            blocks[block_num] = []
        blocks[block_num].append({
            "x": data["left"][i],
            "y": data["top"][i],
            "w": data["width"][i],
            "h": data["height"][i],
        })

    if not blocks:
        return []

    # Merge each block's words into a single bounding box
    raw_boxes: List[Box] = []
    for words in blocks.values():
        xs = [w["x"] for w in words]
        ys = [w["y"] for w in words]
        x2s = [w["x"] + w["w"] for w in words]
        y2s = [w["y"] + w["h"] for w in words]
        x_min, y_min = min(xs), min(ys)
        x_max, y_max = max(x2s), max(y2s)
        bw, bh = x_max - x_min, y_max - y_min
        if bw < 10 or bh < 5:
            continue
        raw_boxes.append((x_min, y_min, bw, bh))

    # Map bounding boxes from rotated space back to original image space.
    # In 90° CW rotation: original (x, y) = (rH - (ry + rh), rx)
    orig_boxes: List[Box] = []
    pad = 8  # a little padding around each spine
    for rx, ry, rw, rh in raw_boxes:
        # Spine occupies a vertical strip in original image
        orig_x = max(0, ry - pad)
        orig_y = 0
        orig_w = min(W, ry + rh + pad) - orig_x
        orig_h = H
        if orig_w > 10:
            orig_boxes.append((orig_x, orig_y, orig_w, orig_h))

    # Sort by X position, deduplicate overlapping strips
    orig_boxes.sort(key=lambda b: b[0])
    merged = _merge_overlapping(orig_boxes, W)
    logger.info("Tesseract detected %d spine regions (from %d raw blocks)", len(merged), len(raw_boxes))
    return merged[:20]


def _merge_overlapping(boxes: List[Box], img_w: int) -> List[Box]:
    """Merge boxes whose X ranges overlap or touch."""
    if not boxes:
        return []
    merged = [list(boxes[0])]
    for x, y, w, h in boxes[1:]:
        prev = merged[-1]
        if x <= prev[0] + prev[2] + 5:  # overlap or close
            prev[2] = max(prev[0] + prev[2], x + w) - prev[0]
        else:
            merged.append([x, y, w, h])
    return [tuple(b) for b in merged]


def _detect_opencv(img: np.ndarray) -> List[Box]:
    """
    OpenCV column-projection fallback (used when Tesseract unavailable or
    returns no results). Finds vertical-edge clusters typical of
    book-spine boundaries.
    """
    H, W = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    sobelx = cv2.Sobel(gray, cv2.CV_16S, 1, 0, ksize=3)
    absx = cv2.convertScaleAbs(sobelx)
    _, th = cv2.threshold(absx, 40, 255, cv2.THRESH_BINARY)

    edge_ratio = float(np.count_nonzero(th)) / float(th.size)
    if edge_ratio < 0.008:
        return []

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(15, H // 15)))
    dil = cv2.dilate(th, kernel, iterations=1)
    col = np.sum(dil, axis=0)
    if col.max() == 0:
        return []

    threshold = col.max() * 0.35
    peaks: List[int] = []
    in_peak = False
    start = 0
    for x in range(len(col)):
        if col[x] > threshold and not in_peak:
            in_peak, start = True, x
        elif col[x] <= threshold and in_peak:
            in_peak = False
            peaks.append((start + x) // 2)
    if in_peak:
        peaks.append((start + len(col)) // 2)

    MIN_SPINE_W = max(15, W // 40)
    merged: List[int] = []
    for p in peaks:
        if merged and abs(p - merged[-1]) < MIN_SPINE_W:
            merged[-1] = (merged[-1] + p) // 2
        else:
            merged.append(p)

    boundaries = [0] + merged + [W]
    margin = int(H * 0.10)
    boxes = []
    for i in range(len(boundaries) - 1):
        x_start, x_end = boundaries[i], boundaries[i + 1]
        w = x_end - x_start
        if w >= MIN_SPINE_W:
            boxes.append((x_start, margin, w, H - 2 * margin))

    return [b for b in boxes if b[3] > b[2] * 0.8][:20]


def detect_spines(img_bytes: bytes) -> List[Box]:
    """
    Public entry point. Decodes image bytes, resizes to at most 1200px wide,
    runs Tesseract LSTM detection (with OpenCV fallback), returns list of
    (x, y, w, h) bounding boxes for detected book spines.
    """
    arr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image bytes")

    H, W = img.shape[:2]
    if W > 1200:
        scale = 1200 / W
        img = cv2.resize(img, (int(W * scale), int(H * scale)))

    if _TESSERACT_AVAILABLE:
        boxes = _detect_tesseract(img)
        if boxes:
            return boxes
        logger.info("Tesseract found 0 regions — falling back to OpenCV heuristic")

    return _detect_opencv(img)
