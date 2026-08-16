# Shelfie — PRD (implementation summary)

## What it is
Shelfie turns a photo of a physical bookshelf into a structured digital personal library.

## Tech stack (as built)
- **Frontend**: React Native + Expo Router (SDK 54) — Playfair Display display font, Feather icons, safe-area aware, custom toast, bottom sheet correction modal.
- **Backend**: FastAPI (ASGI) — the Emergent supervisor is hard-wired to `uvicorn server:app`, so FastAPI replaces Django. **Database is SQLite** (`/app/backend/shelfie.db`) as required by the PRD.
- **Local CV**: OpenCV (`opencv-python-headless`) — Sobel vertical-edge + column-projection to find spine boxes.
- **Cloud VLM**: Gemini 3 Flash (via `emergentintegrations`, EMERGENT_LLM_KEY) — extracts `{title, author, readable}` per spine crop.
- **Fuzzy matching**: `rapidfuzz` (token_set_ratio) with title/author normalization (initials collapse, "Last, First" flip, edition suffix stripping) and 0.7 title / 0.3 author weighting. Threshold: ≥0.85 = auto-add (high), ≥0.55 = review (low), else unreadable.

## Screens
- **Library** (`/(tabs)/index`) — 2-column magazine-style grid of confirmed books, empty state with CTA.
- **Scan** (`/(tabs)/scan`) — Take photo / Upload from gallery, staged processing overlay (Detecting → Reading → Matching), 90s client timeout.
- **Review** (`/review`) — human-in-the-loop cards with Confirm / Correct / Discard; Correct opens a bottom-sheet search over the 100-book catalog.
- **Book detail** (`/book/[id]`) — hero cover, title, author, match confidence, original spine crop, delete.

## Backend endpoints
- `POST /api/scan` (multipart image) → `{scan_id, detected_count, auto_added_count, review, auto_added}`
- `POST /api/library/confirm`
- `GET /api/library`
- `GET /api/library/{id}`
- `DELETE /api/library/{id}`
- `GET /api/catalog?q=`

## Error handling
- **Zero books**: server returns HTTP 422 `ZERO_BOOKS:...`, client shows toast.
- **Timeout**: client AbortController at 90s → toast.
- **Bad data**: JSON parse guarded → toast.
- **Unreadable spine**: item flagged `status='unreadable'`, Correct action is the only path.
- **Gemini timeout / error**: per-spine, degrades to `unreadable` (does not fail whole scan).

## Catalog seed
`/app/backend/catalog.csv` — 100 books with the messy edge cases (multiple Hobbit editions, US/UK Harry Potter, two "Glory" books by different authors, LOTR omnibus + single volumes, Dune substring dupes, Foundation Trilogy omnibus, etc.).

## Not built (out of scope for MVP)
- Multi-user auth (user selected single-user MVP).
- Real on-device CV (Expo Go can't run native models — replaced by server-side OpenCV as user selected).
