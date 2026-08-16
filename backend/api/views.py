"""
Shelfie DRF views — scan pipeline, library CRUD, catalog search.

Flow:
  1. POST /api/scan  → spine_detector (YOLOv8n / OpenCV) finds bounding boxes
  2. Each spine crop → Gemini Flash (hosted VLM) reads title + author
  3. Each OCR result → rapidfuzz matched against catalog
  4. High-confidence → auto-added to library
  5. Low-confidence / unreadable → returned in 'review' list for human confirmation
  6. POST /api/library/confirm → user confirms / corrects a book
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import time
import uuid
from io import BytesIO

from django.conf import settings
from django.shortcuts import get_object_or_404
from PIL import Image as PILImage
from rapidfuzz import fuzz, process
from rest_framework import status
from rest_framework.parsers import MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import CatalogBook, LibraryBook
from .serializers import ConfirmRequestSerializer, LibraryBookSerializer, CatalogBookSerializer
from spine_detector.detector import detect_spines

logger = logging.getLogger("shelfie")

# ---------------------------------------------------------------------------
# Gemini client (lazy, thread-safe)
# ---------------------------------------------------------------------------
_genai_client = None

def _get_genai_client():
    global _genai_client
    if _genai_client is None:
        from google import genai as _genai
        from google.genai import types as _t
        key = settings.GEMINI_API_KEY
        if not key or key == "your-gemini-api-key-here":
            raise RuntimeError(
                "GEMINI_API_KEY is not set. Get one at https://aistudio.google.com/app/apikey "
                "and add it to backend/.env"
            )
        _genai_client = _genai.Client(
            api_key=key,
            http_options=_t.HttpOptions(timeout=30000),  # 30s in ms
        )
    return _genai_client


# ---------------------------------------------------------------------------
# OCR — Gemini Flash vision call
# ---------------------------------------------------------------------------
_OCR_SYSTEM = (
    "You are an expert OCR assistant for book spines. "
    "You will receive a cropped image of a single book spine. "
    "Return ONLY a JSON object with keys: title (string), author (string), readable (bool). "
    "If the text is too blurry or missing, set readable=false and title/author to empty strings. "
    "Do NOT include markdown fences. Only the JSON object."
)
_OCR_MODEL = "gemini-3.1-flash-lite"


def ocr_spine_gemini(b64_jpg: str, timeout_s: float = 25.0) -> dict:
    """Call Gemini Flash to OCR a single spine image. Returns {title, author, readable}."""
    from google.genai import types as _types
    client = _get_genai_client()
    image_bytes = base64.b64decode(b64_jpg)

    start = time.perf_counter()
    try:
        response = client.models.generate_content(
            model=_OCR_MODEL,
            contents=[
                _types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                "Read the title and author from this book spine. Respond with JSON only.",
            ],
            config=_types.GenerateContentConfig(
                system_instruction=_OCR_SYSTEM,
            ),
        )
        latency = time.perf_counter() - start
        logger.info("Gemini OCR latency: %.2fs", latency)
    except Exception as exc:
        logger.warning("Gemini OCR failed: %s", exc)
        return {"title": "", "author": "", "readable": False}

    text = (response.text or "").strip()
    # Strip any accidental markdown fences
    text = re.sub(r"^```[a-z]*\n?", "", text)
    text = re.sub(r"\n?```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        logger.warning("Bad Gemini JSON: %r", text)
        return {"title": "", "author": "", "readable": False}


# ---------------------------------------------------------------------------
# Fuzzy matching against catalog
# ---------------------------------------------------------------------------
CONFIDENCE_HIGH = 0.72   # auto-add threshold
CONFIDENCE_MIN  = 0.35   # below this → unreadable


def match_catalog(title: str, author: str, catalog: list[CatalogBook]) -> tuple[CatalogBook | None, float]:
    """Return (best_match, confidence 0-1). Uses title + author field weighted scoring."""
    if not catalog or not title:
        return None, 0.0

    # Build a combined search string per catalog entry
    choices = {}
    for book in catalog:
        combined = f"{book.title} {book.author}"
        alts = book.alt_titles or ""
        all_titles = " | ".join(filter(None, [book.title] + alts.split("|")))
        choices[book.pk] = (f"{all_titles} {book.author}", book)

    query = f"{title} {author}"

    # rapidfuzz: score against combined title+author
    results = process.extract(
        query,
        {pk: v[0] for pk, v in choices.items()},
        scorer=fuzz.token_set_ratio,
        limit=1,
    )
    if not results:
        return None, 0.0

    best_pk, raw_score, _ = results[0]
    confidence = raw_score / 100.0
    if confidence < CONFIDENCE_MIN:
        return None, confidence
    return choices[best_pk][1], confidence


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
class HealthView(APIView):
    def get(self, request: Request) -> Response:
        return Response({"service": "shelfie", "status": "ok"})


# ---------------------------------------------------------------------------
# Scan endpoint
# ---------------------------------------------------------------------------
class ScanView(APIView):
    parser_classes = [MultiPartParser]

    def post(self, request: Request) -> Response:
        image_file = request.FILES.get("image")
        if not image_file:
            return Response({"error": "No image uploaded (field name: 'image')"}, status=400)

        # Read image bytes and re-encode as JPEG for downstream processing
        try:
            pil = PILImage.open(image_file).convert("RGB")
            buf = BytesIO()
            pil.save(buf, format="JPEG", quality=85)
            img_bytes = buf.getvalue()
        except Exception as exc:
            logger.error("Image decode error: %s", exc)
            return Response({"error": "Could not decode image"}, status=400)

        # ── Step 1: Local pretrained spine detection ──
        try:
            boxes = detect_spines(img_bytes)
        except Exception as exc:
            logger.error("Spine detection error: %s", exc)
            return Response({"error": "Spine detection failed"}, status=500)

        if not boxes:
            return Response({
                "scan_id": str(uuid.uuid4()),
                "detected_count": 0,
                "auto_added_count": 0,
                "review": [],
                "auto_added": [],
            })

        # ── Step 2: Crop spines + OCR via Gemini ──
        pil_full = PILImage.open(BytesIO(img_bytes))
        catalog = list(CatalogBook.objects.all())
        scan_id = str(uuid.uuid4())

        auto_added: list[dict] = []
        review: list[dict] = []

        for box in boxes:
            x, y, w, h = box
            # Crop spine with small padding
            pad = 4
            crop = pil_full.crop((
                max(0, x - pad), max(0, y - pad),
                min(pil_full.width, x + w + pad),
                min(pil_full.height, y + h + pad),
            ))
            buf = BytesIO()
            crop.save(buf, format="JPEG", quality=85)
            spine_b64 = base64.b64encode(buf.getvalue()).decode()

            # OCR
            try:
                ocr = ocr_spine_gemini(spine_b64)
            except RuntimeError as exc:
                # Gemini key missing — fail fast
                return Response({"error": str(exc)}, status=503)
            except Exception as exc:
                logger.warning("OCR exception: %s", exc)
                ocr = {"title": "", "author": "", "readable": False}

            ocr_title  = (ocr.get("title") or "").strip()
            ocr_author = (ocr.get("author") or "").strip()
            readable   = bool(ocr.get("readable", True))

            spine_id = str(uuid.uuid4())

            if not readable or not ocr_title:
                review.append({
                    "spine_id": spine_id,
                    "spine_b64": spine_b64,
                    "ocr_title": ocr_title,
                    "ocr_author": ocr_author,
                    "best_match": None,
                    "confidence": 0.0,
                    "status": "unreadable",
                })
                continue

            # Fuzzy match
            best, confidence = match_catalog(ocr_title, ocr_author, catalog)
            best_dict = None
            if best:
                best_dict = {
                    "id": best.pk,
                    "title": best.title,
                    "author": best.author,
                    "cover_url": best.cover_url or "",
                }

            item = {
                "spine_id": spine_id,
                "spine_b64": spine_b64,
                "ocr_title": ocr_title,
                "ocr_author": ocr_author,
                "best_match": best_dict,
                "confidence": round(confidence, 4),
                "status": "high" if confidence >= CONFIDENCE_HIGH else "low",
            }

            if confidence >= CONFIDENCE_HIGH and best:
                # Auto-add to library
                lb = LibraryBook.objects.create(
                    catalog_book=best,
                    title=best.title,
                    author=best.author,
                    cover_url=best.cover_url or "",
                    spine_b64=spine_b64,
                    confidence=confidence,
                )
                item["library_id"] = str(lb.pk)
                auto_added.append(item)
            else:
                review.append(item)

        return Response({
            "scan_id": scan_id,
            "detected_count": len(boxes),
            "auto_added_count": len(auto_added),
            "review": review,
            "auto_added": auto_added,
        })


# ---------------------------------------------------------------------------
# Library CRUD
# ---------------------------------------------------------------------------
class LibraryListView(APIView):
    def get(self, request: Request) -> Response:
        books = LibraryBook.objects.all()
        return Response(LibraryBookSerializer(books, many=True).data)


class LibraryConfirmView(APIView):
    def post(self, request: Request) -> Response:
        ser = ConfirmRequestSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=400)
        d = ser.validated_data
        catalog_book = None
        if d.get("catalog_id"):
            try:
                catalog_book = CatalogBook.objects.get(pk=d["catalog_id"])
            except CatalogBook.DoesNotExist:
                pass
        lb = LibraryBook.objects.create(
            catalog_book=catalog_book,
            title=d["title"],
            author=d["author"],
            cover_url=d.get("cover_url") or "",
            spine_b64=d.get("spine_b64") or "",
            confidence=d.get("confidence", 1.0),
        )
        return Response(LibraryBookSerializer(lb).data, status=201)


class LibraryDetailView(APIView):
    def get(self, request: Request, book_id: str) -> Response:
        book = get_object_or_404(LibraryBook, pk=book_id)
        return Response(LibraryBookSerializer(book).data)

    def delete(self, request: Request, book_id: str) -> Response:
        book = get_object_or_404(LibraryBook, pk=book_id)
        book.delete()
        return Response(status=204)


# ---------------------------------------------------------------------------
# Catalog search
# ---------------------------------------------------------------------------
class CatalogSearchView(APIView):
    def get(self, request: Request) -> Response:
        q = (request.query_params.get("q") or "").strip()
        if not q:
            books = CatalogBook.objects.all()[:50]
        else:
            # Use rapidfuzz against all catalog titles for fuzzy search
            all_books = list(CatalogBook.objects.all())
            choices = {b.pk: f"{b.title} {b.author}" for b in all_books}
            results = process.extract(q, choices, scorer=fuzz.token_set_ratio, limit=15)
            matched_pks = [pk for pk, score, _ in results if score > 40]
            books = [b for b in all_books if b.pk in matched_pks]
        return Response(CatalogBookSerializer(books, many=True).data)
