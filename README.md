# Shelfie 📚

A mobile app that photographs a bookshelf, uses Tesseract + Gemini to identify book spines, and builds a personal digital library.

**Stack:** Django REST Framework · SQLite · Tesseract LSTM · Google Gemini · Expo (React Native)

---

## Architecture

```
Phone camera → POST /api/scan
  ① Tesseract LSTM — detects spine bounding boxes (pretrained text detector, local)
  ② Gemini Flash — OCRs each spine crop → title + author (hosted VLM)
  ③ RapidFuzz — fuzzy-matches against catalog.csv (token_set_ratio ≥ 0.72 → auto-add)
  → High-confidence books auto-added to library
  → Low-confidence books sent to Review screen (human in the loop)
  → User confirms / corrects / discards → saved to SQLite
```

| Step | Model | Where | Latency |
|------|-------|--------|---------|
| Spine detection | Tesseract 4/5 LSTM (`eng.traineddata`) | Local CPU | ~0.5–2s |
| OCR per spine | `gemini-3.1-flash-lite` | Google API | ~8s/spine |
| Catalog match | rapidfuzz `token_set_ratio` | Local CPU | <10ms |

---

## Prerequisites

| Tool | Version |
|------|---------|
| Python | 3.10+ |
| Node.js | 18+ |
| yarn | any |
| Tesseract | 4 or 5 (`sudo apt install tesseract-ocr`) |
| Expo Go app | latest (on your phone) |

---

## 1 — Clone the repo

```bash
git clone https://github.com/m0rty01/Shelfie.git
cd Shelfie
```

---

## 2 — Backend setup

### 2a. Install Tesseract + language data

```bash
# Ubuntu / Debian
sudo apt install tesseract-ocr tesseract-ocr-eng

# macOS
brew install tesseract

# Or download eng.traineddata manually (no sudo needed):
mkdir -p ~/tessdata
curl -L https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata \
     -o ~/tessdata/eng.traineddata
# Then add TESSDATA_PREFIX=~/tessdata to backend/.env
```

### 2b. Install Python dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 2c. Create `backend/.env`

Get a Gemini API key at **[aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)**:

```env
GEMINI_API_KEY=your-gemini-api-key-here
SQLITE_PATH=./shelfie.db

# Only needed if Tesseract can't find its data automatically
# (snap install, unusual paths, etc.)
TESSDATA_PREFIX=/path/to/tessdata   # folder containing eng.traineddata
```

### 2d. Run migrations & start the server

```bash
python3 manage.py migrate          # first time only — creates shelfie.db
python3 manage.py runserver 0.0.0.0:8000
```

Confirm it's running:
```bash
curl http://localhost:8000/api/
# → {"service":"shelfie","status":"ok"}
```

The catalog is seeded automatically from `catalog.csv` on first startup.

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
DJANGO_SETTINGS_MODULE=shelfie.settings python3 - << 'EOF'
import os, sys, inspect
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "shelfie.settings")
sys.path.insert(0, ".")
import django; django.setup()
import tests.test_matching as tm
passed = failed = 0
for name, func in sorted(inspect.getmembers(tm, inspect.isfunction)):
    if not name.startswith("test_"): continue
    try: func(); print(f"  PASS  {name}"); passed += 1
    except AssertionError as e: print(f"  FAIL  {name} — {e}"); failed += 1
    except Exception as e: print(f"  ERROR {name} — {e}"); failed += 1
print(f"\n{passed} passed, {failed} failed")
EOF
```

---

## Project structure

```
Shelfie/
├── backend/
│   ├── manage.py
│   ├── shelfie/           # Django project (settings, urls)
│   ├── api/               # DRF views, models, serializers, migrations
│   ├── spine_detector/    # Tesseract LSTM spine detection + OpenCV fallback
│   ├── catalog.csv        # 100-book fuzzy-match catalog
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
├── test_photos/           # Real bookshelf photos for manual testing
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

## What was cut and why

- **No authentication** — out of scope for a local-only demo app
- **No pagination** — library is small enough for a single list
- **Gemini for detection** — kept local (Tesseract) for detection as required; Gemini only for OCR
- **TESSDATA_PREFIX** — not baked into the app; documented above for portability
