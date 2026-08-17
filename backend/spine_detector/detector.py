"""
Local pretrained spine detection using YOLOv8n (COCO class 73 — 'book').

Strategy:
  1. Decode incoming image bytes → PIL Image.
  2. Run YOLOv8n inference on CPU (off-the-shelf yolov8n.pt, no fine-tuning).
  3. Filter results to COCO class 73 ('book').
  4. Validate each bounding box [x1, y1, x2, y2] for well-formed geometry.
  5. Crop the original image in-memory using those coordinates.
  6. Return a list of PIL Image crops — ready to hand off to the VLM.

Graceful failure:
  - 0 books detected  → raises ValueError("ZERO_BOOKS: ...")
  - Malformed box     → raises ValueError("MALFORMED_BOX: ...")
  - YOLO model error  → exception is caught, logged, re-raised as ValueError
"""
from __future__ import annotations

import logging
from typing import List

from PIL import Image

logger = logging.getLogger("shelfie.spine_detector")

# COCO class ID for 'book'
_BOOK_CLASS_ID = 73

# ---------------------------------------------------------------------------
# Lazy-loaded YOLO singleton — model is downloaded once on first call
# ---------------------------------------------------------------------------
_yolo_model = None


def _get_model():
    global _yolo_model
    if _yolo_model is None:
        try:
            from ultralytics import YOLO
            logger.info("Loading YOLOv8n model (yolov8n.pt) on CPU …")
            _yolo_model = YOLO("yolov8n.pt")
            logger.info("YOLOv8n loaded successfully.")
        except Exception as exc:
            logger.error("Failed to load YOLOv8n model: %s", exc)
            raise ValueError(f"MODEL_LOAD_ERROR: Could not load YOLOv8n — {exc}") from exc
    return _yolo_model


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def detect_book_spines(img_bytes: bytes) -> List[Image.Image]:
    """
    Detect book spines in a bookshelf image using YOLOv8n.

    Parameters
    ----------
    img_bytes : bytes
        Raw bytes of the uploaded image (JPEG, PNG, etc.).

    Returns
    -------
    List[PIL.Image.Image]
        One cropped PIL Image per detected book spine, kept in memory.

    Raises
    ------
    ValueError
        - "ZERO_BOOKS: …"    — model found no books in the image.
        - "MALFORMED_BOX: …" — a bounding box has invalid geometry.
        - "BAD_IMAGE: …"     — image bytes could not be decoded.
        - "MODEL_ERROR: …"   — unexpected YOLO inference failure.
    """
    # 1. Decode image bytes
    import io
    try:
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    except Exception as exc:
        raise ValueError(f"BAD_IMAGE: Could not decode image bytes — {exc}") from exc

    img_w, img_h = img.size
    logger.info("Running YOLOv8n inference on image %dx%d …", img_w, img_h)

    # 2. Run inference (CPU-only, off-the-shelf weights)
    try:
        model = _get_model()
        results = model.predict(img, device="cpu", verbose=False)
    except ValueError:
        raise  # re-raise MODEL_LOAD_ERROR cleanly
    except Exception as exc:
        logger.exception("YOLOv8n inference failed")
        raise ValueError(f"MODEL_ERROR: Inference failed — {exc}") from exc

    # 3. Filter to COCO class 73 ('book')
    book_boxes: list[tuple[int, int, int, int]] = []
    for result in results:
        if result.boxes is None:
            continue
        for box in result.boxes:
            cls_id = int(box.cls[0].item())
            if cls_id != _BOOK_CLASS_ID:
                continue
            x1, y1, x2, y2 = (int(v) for v in box.xyxy[0].tolist())
            book_boxes.append((x1, y1, x2, y2))

    logger.info("YOLOv8n detected %d book(s) (class 73).", len(book_boxes))

    # 4. Graceful failure: no books detected
    if not book_boxes:
        raise ValueError(
            "ZERO_BOOKS: The model detected 0 books in the image. "
            "Make sure the photo shows a bookshelf with visible spines."
        )

    # 5. Validate boxes and crop
    crops: List[Image.Image] = []
    for idx, (x1, y1, x2, y2) in enumerate(book_boxes):
        # Clamp to image bounds
        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(img_w, x2)
        y2 = min(img_h, y2)

        # Well-formedness check
        if x2 <= x1 or y2 <= y1:
            raise ValueError(
                f"MALFORMED_BOX: Bounding box {idx} has invalid geometry "
                f"[{x1}, {y1}, {x2}, {y2}] after clamping to image bounds."
            )

        crop = img.crop((x1, y1, x2, y2))
        crops.append(crop)
        logger.debug("Spine %d: box=[%d,%d,%d,%d] size=%s", idx, x1, y1, x2, y2, crop.size)

    logger.info("Returning %d cropped spine image(s).", len(crops))
    return crops
