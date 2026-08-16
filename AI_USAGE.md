# AI Usage Disclosure

This file documents every place AI tooling was used in this project, as required by the task spec.

## Tools used

| Tool | Where it was used |
|------|-------------------|
| **Claude / Antigravity (Gemini-backed coding agent)** | Primary development assistant throughout the project — scaffolding Django project, writing DRF views, porting business logic from FastAPI, debugging pydantic/SDK errors, writing tests, frontend UI components |
| **Google Gemini 2.x Flash** | Runtime: hosted vision-language model that reads title and author from cropped book spine images |
| **GitHub Copilot** (opportunistic) | Inline completions while editing |

## How AI was used

### Backend
- Antigravity agent scaffolded the full Django project (`manage.py`, `settings.py`, `api/` app, `api/views.py`, `spine_detector/`).
- I reviewed and edited the generated code to fix SDK-version mismatches (e.g. `GenerateContentConfig.timeout` field removed in newer SDK, model name deprecations).
- The fuzzy-matching threshold values (0.72 for auto-add, 0.35 for unreadable) were chosen by me based on manual spot checks of match quality.

### Frontend
- Antigravity agent wrote the React Native / Expo screens, tab layout, and theme system.
- I reviewed the generated UI and directed iterative refinements (floating scan button, white text on dark hero, skeleton loaders).

### Catalog (`catalog.csv`)
- I generated the initial 100-entry catalog using an LLM prompt asking for a realistic messy catalog: duplicate editions, alternate titles, author name variants, omnibus editions, titles that are substrings of other titles.
- I manually reviewed the output and accepted it as-is (per spec: "half an hour is plenty").

## What I own

I understand and can explain every line in the repository. The AI agent was a pair-programmer, not a black box — I directed each step, diagnosed failures (pydantic errors, model 404s, port conflicts), and made all architectural decisions (YOLOv8n for local detection, rapidfuzz token_set_ratio for matching, confidence thresholds, Django over Flask).
