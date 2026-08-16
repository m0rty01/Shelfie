"""
Local pretrained spine detection — YOLOv8n (COCO, class 73 = "book") with
OpenCV heuristic fallback when ultralytics is unavailable or confidence is low.

The local model runs entirely on CPU and takes ~200–400 ms per image.
This is the "pretrained local vision model" step described in the spec.
"""
from __future__ import annotations

import logging
import time
from typing import Tuple, List

import cv2
import numpy as np

logger = logging.getLogger("shelfie.spine_detector")

Box = Tuple[int, int, int, int]  # (x, y, w, h)

# ── Try to import YOLOv8 (ultralytics) ──────────────────────────────────────
try:
    from ultralytics import YOLO as _YOLO
    _yolo_model = _YOLO("yolov8n.pt")   # downloads ~6 MB on first run
    _YOLO_AVAILABLE = True
    logger.info("YOLOv8n loaded — using pretrained local model for spine detection")
except Exception as exc:
    _YOLO_AVAILABLE = False
    logger.warning("ultralytics not available (%s) — falling back to OpenCV heuristic", exc)

BOOK_CLASS_ID = 73   # COCO class 73 = "book"
YOLO_CONF_THRESHOLD = 0.25


def _detect_yolo(img_bgr: np.ndarray) -> List[Box]:
    """Run YOLOv8n inference and return book bounding boxes (x,y,w,h)."""
    t0 = time.perf_counter()
    results = _yolo_model(img_bgr, verbose=False)[0]
    logger.info("YOLOv8n inference: %.3fs", time.perf_counter() - t0)

    boxes: List[Box] = []
    for box in results.boxes:
        cls = int(box.cls[0])
        conf = float(box.conf[0])
        if cls == BOOK_CLASS_ID and conf >= YOLO_CONF_THRESHOLD:
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            boxes.append((x1, y1, x2 - x1, y2 - y1))

    # If YOLO found zero books, try the heuristic as fallback
    if not boxes:
        logger.info("YOLO found 0 books — falling back to OpenCV heuristic")
        boxes = _detect_opencv(img_bgr)
    return boxes


def _detect_opencv(img: np.ndarray) -> List[Box]:
    """
    OpenCV heuristic: vertical-edge detection + column projection.
    Looks for tall thin rectangles typical of book spines.
    """
    H, W = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)

    # Detect vertical edges
    sobelx = cv2.Sobel(gray, cv2.CV_16S, 1, 0, ksize=3)
    absx = cv2.convertScaleAbs(sobelx)
    _, th = cv2.threshold(absx, 40, 255, cv2.THRESH_BINARY)

    # Bail if almost no vertical edge content (not a bookshelf image)
    edge_ratio = float(np.count_nonzero(th)) / float(th.size)
    if edge_ratio < 0.008:
        return []

    # Dilate vertically to connect edge fragments
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(15, H // 15)))
    dil = cv2.dilate(th, kernel, iterations=1)

    # Column projection to find vertical-line positions
    col = np.sum(dil, axis=0)
    if col.max() == 0:
        return []
    threshold = col.max() * 0.35
    peaks: List[int] = []
    in_peak = False
    start = 0
    for x in range(len(col)):
        if col[x] > threshold and not in_peak:
            in_peak = True
            start = x
        elif col[x] <= threshold and in_peak:
            in_peak = False
            peaks.append((start + x) // 2)
    if in_peak:
        peaks.append((start + len(col)) // 2)

    # Merge peaks that are too close together
    MIN_SPINE_W = max(15, W // 40)
    merged: List[int] = []
    for p in peaks:
        if merged and abs(p - merged[-1]) < MIN_SPINE_W:
            merged[-1] = (merged[-1] + p) // 2
        else:
            merged.append(p)

    # Build (x, y, w, h) boxes between consecutive boundary peaks
    boxes: List[Box] = []
    boundaries = [0] + merged + [W]
    for i in range(len(boundaries) - 1):
        x_start = boundaries[i]
        x_end = boundaries[i + 1]
        w = x_end - x_start
        if w < MIN_SPINE_W:
            continue
        # Trim top/bottom 10% of image (usually shelf/frame)
        margin = int(H * 0.10)
        boxes.append((x_start, margin, w, H - 2 * margin))

    # Keep only boxes that are taller than they are wide (spine shape)
    boxes = [(x, y, w, h) for x, y, w, h in boxes if h > w * 0.8]

    MAX_SPINES = 20
    return boxes[:MAX_SPINES]


def detect_spines(img_bytes: bytes) -> List[Box]:
    """
    Public entry point.
    Decodes image bytes, resizes if needed, runs YOLOv8n (or OpenCV fallback),
    returns list of (x, y, w, h) bounding boxes for detected book spines.
    """
    arr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image bytes")

    # Resize to max width 1200 to keep inference fast
    H, W = img.shape[:2]
    if W > 1200:
        scale = 1200 / W
        img = cv2.resize(img, (int(W * scale), int(H * scale)))

    if _YOLO_AVAILABLE:
        return _detect_yolo(img)
    else:
        return _detect_opencv(img)
