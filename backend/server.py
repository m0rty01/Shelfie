"""
Shelfie backend
FastAPI + SQLite + YOLOv8n spine detection + Gemini vision OCR + fuzzy matching.
"""
from __future__ import annotations

import asyncio
import base64
import csv
import io
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Optional

from spine_detector.detector import detect_book_spines

import aiosqlite
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image
from pydantic import BaseModel, Field
from rapidfuzz import fuzz, process
from starlette.middleware.cors import CORSMiddleware

# Google Generative AI (new SDK)
from google import genai
from google.genai import types

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

SQLITE_PATH = os.environ.get("SQLITE_PATH", str(ROOT_DIR / "shelfie.db"))
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
_genai_client: genai.Client | None = None

def _get_genai_client() -> genai.Client:
    global _genai_client
    if _genai_client is None:
        if not GEMINI_API_KEY:
            raise RuntimeError("GEMINI_API_KEY (or EMERGENT_LLM_KEY) is not set")
        _genai_client = genai.Client(api_key=GEMINI_API_KEY)
    return _genai_client
CATALOG_CSV = ROOT_DIR / "catalog.csv"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("shelfie")

app = FastAPI(title="Shelfie API")
api = APIRouter(prefix="/api")

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class DetectedBook(BaseModel):
    spine_id: str
    spine_b64: str  # cropped spine image, base64 (jpg)
    ocr_title: Optional[str] = None
    ocr_author: Optional[str] = None
    best_match: Optional[dict] = None  # {id,title,author,cover_url}
    confidence: float  # 0..1
    status: str  # 'high' | 'low' | 'unreadable'
    reason: Optional[str] = None

class ScanResponse(BaseModel):
    scan_id: str
    detected_count: int
    auto_added_count: int
    review: List[DetectedBook]
    auto_added: List[DetectedBook]

class ConfirmRequest(BaseModel):
    catalog_id: Optional[int] = None  # if user picked catalog match
    title: str
    author: str
    cover_url: Optional[str] = None
    spine_b64: Optional[str] = None
    confidence: float = 1.0

class LibraryBook(BaseModel):
    id: str
    catalog_id: Optional[int] = None
    title: str
    author: str
    cover_url: Optional[str] = None
    spine_b64: Optional[str] = None
    confidence: float
    confirmed_at: str

# ---------------------------------------------------------------------------
# DB
# ---------------------------------------------------------------------------
async def init_db() -> None:
    async with aiosqlite.connect(SQLITE_PATH) as db:
        await db.execute(
            """CREATE TABLE IF NOT EXISTS catalog (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                edition TEXT,
                cover_url TEXT
            )"""
        )
        await db.execute(
            """CREATE TABLE IF NOT EXISTS library (
                id TEXT PRIMARY KEY,
                catalog_id INTEGER,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                cover_url TEXT,
                spine_b64 TEXT,
                confidence REAL,
                confirmed_at TEXT NOT NULL
            )"""
        )
        # Seed catalog if empty
        cur = await db.execute("SELECT COUNT(*) FROM catalog")
        row = await cur.fetchone()
        if row and row[0] == 0 and CATALOG_CSV.exists():
            with CATALOG_CSV.open(newline="", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                rows = [
                    (int(r["id"]), r["title"].strip(), r["author"].strip(),
                     (r.get("edition") or "").strip() or None,
                     (r.get("cover_url") or "").strip() or None)
                    for r in reader
                ]
            await db.executemany(
                "INSERT INTO catalog(id,title,author,edition,cover_url) VALUES (?,?,?,?,?)",
                rows,
            )
            logger.info("Seeded catalog with %d books", len(rows))
        await db.commit()

async def get_catalog() -> list[dict]:
    async with aiosqlite.connect(SQLITE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT id,title,author,edition,cover_url FROM catalog")
        rows = await cur.fetchall()
        return [dict(r) for r in rows]

# ---------------------------------------------------------------------------
# Local CV: book spine detection is handled by spine_detector.detector
# (YOLOv8n, COCO class 73 'book', CPU-only).  See that module for details.
# ---------------------------------------------------------------------------

def _pil_to_b64(pil_img) -> str:
    """Encode a PIL Image to a base64 JPEG string."""
    buf = io.BytesIO()
    pil_img.save(buf, format="JPEG", quality=80)
    return base64.b64encode(buf.getvalue()).decode("ascii")

# ---------------------------------------------------------------------------
# Cloud OCR via Gemini
# ---------------------------------------------------------------------------
GEMINI_OCR_SYSTEM = (
    "You are an OCR assistant specialized in reading book spines. "
    "For each spine image, extract the book TITLE and AUTHOR. "
    "Return STRICT JSON with keys: title (string or null), author (string or null), "
    "readable (boolean). If text is illegible or blurry, set readable=false and title/author=null. "
    "Do NOT include markdown fences. Only the JSON object."
)

# Model name to use for OCR
_OCR_MODEL = "gemini-3.1-flash-lite"


async def ocr_spine_gemini(b64_jpg: str, timeout_s: float = 25.0) -> dict:
    """Call Gemini Flash to OCR a single spine image. Returns {title,author,readable}."""
    client = _get_genai_client()

    # Decode image bytes for the inline_data blob
    image_bytes = base64.b64decode(b64_jpg)

    def _call_gemini():
        return client.models.generate_content(
            model=_OCR_MODEL,
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                "Read the title and author from this book spine. Respond with the JSON only.",
            ],
            config=types.GenerateContentConfig(
                system_instruction=GEMINI_OCR_SYSTEM,
            ),
        )

    loop = asyncio.get_event_loop()
    try:
        response = await asyncio.wait_for(
            loop.run_in_executor(None, _call_gemini),
            timeout=timeout_s,
        )
        response_text = response.text
    except asyncio.TimeoutError:
        return {"title": None, "author": None, "readable": False, "error": "timeout"}
    except Exception as e:
        logger.exception("Gemini OCR failed: %s", e)
        return {"title": None, "author": None, "readable": False, "error": str(e)[:120]}

    # Extract JSON
    text = str(response_text or "").strip()
    # Strip code fences if any
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
    except Exception:
        # attempt to extract first {...}
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            return {"title": None, "author": None, "readable": False, "error": "bad_json"}
        try:
            data = json.loads(m.group(0))
        except Exception:
            return {"title": None, "author": None, "readable": False, "error": "bad_json"}

    return {
        "title": (data.get("title") or None),
        "author": (data.get("author") or None),
        "readable": bool(data.get("readable", True)) if data.get("title") else False,
    }

# ---------------------------------------------------------------------------
# Fuzzy matching against catalog
# ---------------------------------------------------------------------------
def normalize_author(a: str) -> str:
    a = a.strip().lower()
    # Handle "Tolkien, John Ronald Reuel" -> "john ronald reuel tolkien"
    if "," in a:
        parts = [p.strip() for p in a.split(",", 1)]
        if len(parts) == 2:
            a = f"{parts[1]} {parts[0]}"
    # Collapse initials: "j.r.r." -> "jrr"
    a = re.sub(r"\.", "", a)
    a = re.sub(r"\s+", " ", a)
    return a.strip()

def normalize_title(t: str) -> str:
    t = t.lower()
    t = re.sub(r"\(.*?\)", "", t)  # strip parenthetical editions
    t = re.sub(r"[^a-z0-9 ]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t

def fuzzy_match(ocr_title: Optional[str], ocr_author: Optional[str],
                catalog: list[dict]) -> tuple[Optional[dict], float]:
    if not ocr_title:
        return None, 0.0
    nt = normalize_title(ocr_title)
    na = normalize_author(ocr_author or "")
    best = None
    best_score = 0.0
    for c in catalog:
        ct = normalize_title(c["title"])
        ca = normalize_author(c["author"])
        # Title score: use token_set_ratio; also boost if substring match
        t_score = fuzz.token_set_ratio(nt, ct) / 100.0
        if nt and (nt in ct or ct in nt):
            t_score = max(t_score, 0.85)
        # Author score
        a_score = fuzz.token_set_ratio(na, ca) / 100.0 if na else 0.5
        # Combined - title weighted heavier
        score = 0.7 * t_score + 0.3 * a_score
        if score > best_score:
            best_score = score
            best = c
    return best, best_score

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@api.get("/")
async def root():
    return {"service": "shelfie", "status": "ok"}

@api.get("/catalog")
async def list_catalog(q: str = ""):
    catalog = await get_catalog()
    if q:
        nq = normalize_title(q)
        na = normalize_author(q)
        scored = []
        for c in catalog:
            ct = normalize_title(c["title"])
            ca = normalize_author(c["author"])
            # Full-string aware scoring so "children of dune" ranks
            # "Children of Dune" above "Dune". token_sort_ratio compares the
            # whole normalized string; partial_ratio is only a weaker secondary
            # signal so substrings can't dominate the ranking.
            title_score = max(
                fuzz.token_sort_ratio(nq, ct),
                fuzz.partial_ratio(nq, ct) * 0.6,
            )
            author_score = max(
                fuzz.token_sort_ratio(na, ca),
                fuzz.partial_ratio(na, ca) * 0.6,
            )
            s = max(title_score, author_score)
            if s >= 50:
                scored.append((s, c))
        # Tiebreak: prefer titles closer in length to the query.
        scored.sort(key=lambda x: (-x[0], abs(len(normalize_title(x[1]["title"])) - len(nq))))
        return {"results": [c for _, c in scored[:25]]}
    return {"results": catalog[:50]}

@api.post("/scan", response_model=ScanResponse)
async def scan(image: UploadFile = File(...)):
    try:
        img_bytes = await image.read()
        if len(img_bytes) == 0:
            raise HTTPException(status_code=400, detail="Empty image upload")

        # Detect book spines via YOLOv8n (COCO class 73).
        # ValueError is raised for ZERO_BOOKS, MALFORMED_BOX, BAD_IMAGE, etc.
        try:
            spine_crops = detect_book_spines(img_bytes)
        except ValueError as exc:
            msg = str(exc)
            status = 400 if msg.startswith("BAD_IMAGE") else 422
            raise HTTPException(status_code=status, detail=msg)

        catalog = await get_catalog()

        # Cap spines to keep latency reasonable
        spine_crops = spine_crops[:12]

        # Convert PIL crops → base64 JPEG strings
        spines: list[DetectedBook] = []
        crops_b64 = [_pil_to_b64(c) for c in spine_crops]
        crops_b64 = [c for c in crops_b64 if c]

        # OCR concurrently but with a small cap
        sem = asyncio.Semaphore(4)
        async def _ocr(b64):
            async with sem:
                return await ocr_spine_gemini(b64)
        ocr_results = await asyncio.gather(*[_ocr(c) for c in crops_b64], return_exceptions=True)

        for b64, res in zip(crops_b64, ocr_results):
            spine_id = str(uuid.uuid4())
            if isinstance(res, Exception):
                spines.append(DetectedBook(
                    spine_id=spine_id, spine_b64=b64,
                    confidence=0.0, status="unreadable",
                    reason="AI error"))
                continue
            title = res.get("title")
            author = res.get("author")
            readable = res.get("readable", bool(title))
            if not readable or not title:
                spines.append(DetectedBook(
                    spine_id=spine_id, spine_b64=b64,
                    ocr_title=title, ocr_author=author,
                    confidence=0.0, status="unreadable",
                    reason="Spine text unreadable"))
                continue
            match, score = fuzzy_match(title, author, catalog)
            if match and score >= 0.85:
                status = "high"
            elif match and score >= 0.55:
                status = "low"
            else:
                status = "low"
            spines.append(DetectedBook(
                spine_id=spine_id, spine_b64=b64,
                ocr_title=title, ocr_author=author,
                best_match=match, confidence=round(score, 3),
                status=status,
            ))

        # Auto-add high-confidence
        auto_added: list[DetectedBook] = []
        review: list[DetectedBook] = []
        async with aiosqlite.connect(SQLITE_PATH) as db:
            for s in spines:
                if s.status == "high" and s.best_match:
                    lib_id = str(uuid.uuid4())
                    await db.execute(
                        """INSERT INTO library(id,catalog_id,title,author,cover_url,spine_b64,confidence,confirmed_at)
                           VALUES (?,?,?,?,?,?,?,?)""",
                        (lib_id, s.best_match["id"], s.best_match["title"],
                         s.best_match["author"], s.best_match.get("cover_url"),
                         s.spine_b64, s.confidence,
                         datetime.now(timezone.utc).isoformat()),
                    )
                    auto_added.append(s)
                else:
                    review.append(s)
            await db.commit()

        return ScanResponse(
            scan_id=str(uuid.uuid4()),
            detected_count=len(spines),
            auto_added_count=len(auto_added),
            review=review,
            auto_added=auto_added,
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"BAD_IMAGE: {e}")
    except Exception as e:
        logger.exception("scan failed")
        raise HTTPException(status_code=500, detail=f"SERVER_ERROR: {str(e)[:200]}")


@api.post("/library/confirm", response_model=LibraryBook)
async def confirm_book(req: ConfirmRequest):
    lib_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(SQLITE_PATH) as db:
        await db.execute(
            """INSERT INTO library(id,catalog_id,title,author,cover_url,spine_b64,confidence,confirmed_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (lib_id, req.catalog_id, req.title, req.author, req.cover_url,
             req.spine_b64, req.confidence, now),
        )
        await db.commit()
    return LibraryBook(
        id=lib_id, catalog_id=req.catalog_id, title=req.title, author=req.author,
        cover_url=req.cover_url, spine_b64=req.spine_b64,
        confidence=req.confidence, confirmed_at=now,
    )


@api.get("/library", response_model=List[LibraryBook])
async def list_library():
    async with aiosqlite.connect(SQLITE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            """SELECT id,catalog_id,title,author,cover_url,spine_b64,confidence,confirmed_at
               FROM library ORDER BY confirmed_at DESC""")
        rows = await cur.fetchall()
        return [LibraryBook(**dict(r)) for r in rows]


@api.delete("/library/{book_id}")
async def delete_library_book(book_id: str):
    async with aiosqlite.connect(SQLITE_PATH) as db:
        await db.execute("DELETE FROM library WHERE id=?", (book_id,))
        await db.commit()
    return {"deleted": book_id}


@api.get("/library/{book_id}", response_model=LibraryBook)
async def get_book(book_id: str):
    async with aiosqlite.connect(SQLITE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            """SELECT id,catalog_id,title,author,cover_url,spine_b64,confidence,confirmed_at
               FROM library WHERE id=?""", (book_id,))
        row = await cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        return LibraryBook(**dict(row))


# ---------------------------------------------------------------------------
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def on_startup():
    await init_db()
    logger.info("Shelfie backend ready. SQLITE=%s", SQLITE_PATH)
