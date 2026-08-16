# Shelfie 📚

A mobile app that photographs a bookshelf, uses Google Gemini Vision AI to identify book spines, and builds a personal digital library.

**Stack:** FastAPI · SQLite · OpenCV · Google Gemini · Expo (React Native)

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

> If you hit version conflicts, install only what the server needs:
> ```bash
> pip install fastapi uvicorn aiosqlite opencv-python-headless pillow numpy rapidfuzz python-multipart python-dotenv google-genai
> ```

### 2b. Add your Gemini API key

Get a free key at **[aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)**, then create `backend/.env`:

```env
GEMINI_API_KEY=your-gemini-api-key-here
SQLITE_PATH=./shelfie.db
```

### 2c. Start the backend

```bash
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

Confirm it's running:
```bash
curl http://localhost:8000/api/
# → {"service":"shelfie","status":"ok"}
```

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

A QR code will appear in the terminal.

---

## 4 — Preview on your phone

1. Install **[Expo Go](https://expo.dev/go)** on your iOS or Android device
2. Make sure your phone is on the **same WiFi** as your computer
3. Scan the QR code shown by `npx expo start`

---

## 5 — How it works

```
Phone camera → /api/scan
  → OpenCV detects spine bounding boxes
  → Gemini Flash OCRs each spine crop (title + author)
  → RapidFuzz matches against catalog.csv
  → High-confidence books auto-added; low-confidence sent to Review screen
  → User confirms / corrects / discards → saved to SQLite
```

---

## Project structure

```
Shelfie/
├── backend/
│   ├── server.py          # FastAPI app (scan, library CRUD, catalog)
│   ├── catalog.csv        # Book catalog for fuzzy matching
│   ├── requirements.txt
│   └── tests/
├── frontend/
│   ├── app/
│   │   ├── (tabs)/
│   │   │   ├── index.tsx  # Library screen
│   │   │   └── scan.tsx   # Scan screen
│   │   ├── review.tsx     # Human-in-the-loop review
│   │   └── book/[id].tsx  # Book detail
│   └── src/
│       ├── api.ts         # All fetch calls
│       └── theme.ts       # Design tokens
└── design_guidelines.json # Editorial design system spec
```

---

## API reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/` | Health check |
| `POST` | `/api/scan` | Upload shelf image → detect + OCR + match |
| `GET` | `/api/library` | List confirmed books |
| `GET` | `/api/library/{id}` | Single book |
| `POST` | `/api/library/confirm` | Manually confirm a book |
| `DELETE` | `/api/library/{id}` | Remove a book |
| `GET` | `/api/catalog?q=` | Search the catalog |
