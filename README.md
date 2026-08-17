# Shelfie 📚

A mobile app that photographs a bookshelf and builds a structured personal library.

**Stack:** Django REST Framework · SQLite · YOLOv8n (local, CPU) · Google Gemini (hosted VLM) · Expo (React Native)

---

## Architecture

```
Phone camera → POST /api/scan
  ① YOLOv8n (yolov8n.pt, COCO class 73 "book")
       Pretrained off-the-shelf, CPU-only.
       Detects bounding boxes of individual book spines in the shelf photo.
  ② Gemini gemini-3.1-flash-lite (hosted VLM)
       Each cropped spine image → {"title": ..., "author": ..., "readable": bool}
  ③ RapidFuzz token_set_ratio
       Fuzzy-matches OCR text against catalog.csv to assign a confidence score.
  → confidence ≥ 0.72 → auto-added to library
  → confidence < 0.72 or unreadable → Review screen (human in the loop)
  → User confirms / corrects / discards → saved to SQLite
```

### Local vs. hosted work

| Step | Model | Where | Measured latency | Estimated cost/spine |
|------|-------|--------|-----------------|----------------------|
| Spine detection | YOLOv8n (`yolov8n.pt`, COCO) | **Local CPU** | ~120–250 ms (whole image) | $0 |
| OCR per spine | `gemini-3.1-flash-lite` | **Google API** | **7–9 s** per spine (server logs) | ~$0.00007 † |
| Catalog match | rapidfuzz `token_set_ratio` | **Local CPU** | < 1 ms | $0 |
| **Full scan, 15-spine shelf** | | | **~2 min** (sequential OCR) | **~$0.001** |

† `gemini-3.1-flash-lite` pricing: $0.075/M input tokens, $0.30/M output tokens.
Each spine ≈ 650 input tokens (image + prompt) + 50 output tokens → ~$0.00007/spine.
A 15-book shelf costs roughly **$0.001 per scan** (< one tenth of a cent).

---

## Prerequisites

| Tool | Version |
|------|---------|
| Python | 3.10+ |
| Node.js | 18+ |
| yarn | any |
| Expo Go app | latest (on your phone) |

---

## 1 — Clone the repo

```bash
git clone https://github.com/m0rty01/Shelfie.git
cd Shelfie
```

---

## 2 — Backend setup

### 2a. Install Python dependencies

```bash
cd backend
pip install -r requirements.txt
```

YOLOv8n weights (`yolov8n.pt`) are committed to the repo — no separate download needed.

### 2b. Create `backend/.env`

Get a Gemini API key at **[aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)**:

```env
GEMINI_API_KEY=your-gemini-api-key-here
SQLITE_PATH=./shelfie.db
```

### 2c. Run migrations & start the server

```bash
python3 manage.py migrate          # creates shelfie.db and seeds catalog from catalog.csv
python3 manage.py runserver 0.0.0.0:8000
```

Confirm it's running:
```bash
curl http://localhost:8000/api/
# → {"service":"shelfie","status":"ok"}
```

The catalog is seeded automatically from `catalog.csv` on first startup (via Django's `AppConfig.ready()`).

---

## 3 — Frontend setup

### 3a. Install dependencies

```bash
cd frontend
yarn install --ignore-engines
```

### 3b. Set the backend URL

Find your machine's local IP:
```bash
ip route get 1 | awk '{print $7; exit}'   # Linux
ipconfig getifaddr en0                     # macOS
```

Create `frontend/.env`:
```env
EXPO_PUBLIC_BACKEND_URL=http://<your-local-ip>:8000
```

### 3c. Start Expo

```bash
npx expo start --lan
```

Scan the QR code with **Expo Go** (iOS or Android). Phone must be on the same WiFi.

---

## Running the matching tests

```bash
cd backend
python3 -m pytest tests/test_matching.py -v
```

8 tests covering: exact match, alternate editions, author name forms (initials, Lastname/Firstname), substring title disambiguation, unreadable OCR, garbage input, typo tolerance, empty catalog.

---

## Project structure

```
Shelfie/
├── backend/
│   ├── manage.py
│   ├── shelfie/           # Django project (settings, urls)
│   ├── api/               # DRF views, models, serializers, migrations
│   ├── spine_detector/    # YOLOv8n spine detection (COCO class 73, CPU)
│   ├── catalog.csv        # 100-book fuzzy-match catalog
│   ├── yolov8n.pt         # Pretrained YOLO weights (committed for clean-clone setup)
│   ├── tests/             # Matching test suite
│   └── requirements.txt
├── frontend/
│   ├── app/
│   │   ├── (tabs)/
│   │   │   ├── index.tsx  # Library screen
│   │   │   └── scan.tsx   # Scan screen
│   │   ├── review.tsx     # Human-in-the-loop review
│   │   └── book/[id].tsx  # Book detail
│   └── src/
│       ├── api.ts
│       └── theme.ts
├── test_photos/           # Real bookshelf photos used during development
├── AI_USAGE.md            # AI tooling disclosure
└── README.md
```

---

## API reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/` | Health check |
| `POST` | `/api/scan` | Upload shelf image → detect + OCR + match |
| `GET` | `/api/library` | List confirmed books |
| `GET` | `/api/library/{id}` | Single book |
| `POST` | `/api/library/confirm` | Confirm a reviewed book |
| `DELETE` | `/api/library/{id}` | Remove a book |
| `GET` | `/api/catalog?q=` | Fuzzy-search the catalog |

---

## The catalog — how it was built and what ambiguity is in it

The catalog has 100 entries, built to exercise all the hard matching cases the spec calls out:

- **Two editions of the same book** — *The Hobbit* appears twice (1st edition, Illustrated edition). This tests whether the matcher returns the right entry instead of splitting confidence.
- **Same book under two regional titles** — *Harry Potter and the Philosopher's Stone* (UK) vs. *Harry Potter and the Sorcerer's Stone* (US). An OCR reading either title must still match with good confidence.
- **Two genuinely different books that share a title** — *It* (Stephen King) vs. *It Ends with Us* (Colleen Hoover) vs. *It Starts with Us* (Colleen Hoover). Title-only matching would fail here; the scorer uses `title + author` combined.
- **Omnibus / collected editions alongside individual volumes** — e.g. *The Lord of the Rings* (omnibus) alongside *The Fellowship of the Ring*, *The Two Towers*, *The Return of the King*.
- **Titles that are substrings of other titles** — *Dune* vs. *Dune Messiah* vs. *Children of Dune*. `token_set_ratio` handles this better than substring matching.
- **Author names in more than one form** — J.R.R. Tolkien / Tolkien J.R.R., J. K. Rowling / Rowling, J.K., Dostoevsky / Fyodor Dostoevsky / Dostoevsky Fyodor (Lastname, Firstname order on some spines).
- **Weighted towards books people actually own** — dominated by widely-read fiction and non-fiction (Tolkien, Rowling, Orwell, Fitzgerald, Austen, Hemingway, King, Atwood, Cormac McCarthy, etc.) so real-world photos are likely to produce meaningful matches.

---

## Key decisions and tradeoffs

**YOLOv8n for spine detection, not a text detector**
YOLOv8n (COCO "book" class 73) finds rectangular book objects reliably even when spines are thin or at angle. A text detector (e.g. Tesseract, CRAFT) would find text regions but miss spines where text is rotated or small — and would produce many more crops to OCR, raising cost.

**Gemini for OCR, not local Tesseract**
A hosted VLM handles rotated, stylised, and low-contrast spine text far better than Tesseract LSTM on unconstrained photos. The latency cost (~8 s/spine) is the main tradeoff — acceptable for a single-device local demo, but the obvious next improvement is concurrent calls.

**`token_set_ratio` scoring**
`token_set_ratio` is order-insensitive and handles partial matches well. Combined title+author query means author signal helps break ties between edition variants. Threshold of 0.72 was chosen by running the test suite against the catalog — low enough to catch OCR typos, high enough to avoid false auto-adds.

---

## What was cut and why

- **Authentication** — out of scope for a single-device local demo
- **Pagination** — library is expected to be small (< 500 books)
- **Deployment** — spec says "not required"; README is enough to run locally
- **Concurrent OCR** — sequential calls keep the code simple; documented as the highest-ROI next step

---

## What I'd do with another day

**Biggest win: parallel Gemini calls**
Right now OCR calls are sequential: 15 spines × 8 s = ~2 min/scan.
Making them concurrent (`asyncio.gather`) would drop that to ~8 s total.

**Other high-value items:**
1. **Batch spine crops into one Gemini call** — send a grid image of all crops, ask for a JSON array. Reduces API calls from N to 1, slashing cost and latency.
2. **Stream results via SSE** — show books appearing one by one instead of a 2-min wait.
3. **Smarter catalog** — deduplicate editions at query time; add ISBN lookup to fill gaps.
4. **Cost guardrail** — cap spines per scan (e.g. 20 max) and surface the per-scan estimate to the user before they confirm.
