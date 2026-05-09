# BoringDocs

Turn boring documents, web pages, and YouTube videos into clean notes — and optionally turn a handwriting sample into a real `.ttf` font.

A small Express server with a static frontend. Talks to an LLM (local Ollama by default, or OpenAI). The handwriting-to-font feature is powered by a vendored Python service (HandFonted) that the Node server spawns on demand.

---

## Prerequisites

- **Node.js 18+** and npm
- **An LLM provider** — pick one:
  - **Ollama** (recommended, free, offline) — https://ollama.com
  - **OpenAI** API key
- **Python 3.10+** *(only if you want the handwriting → font feature)*

---

## Quick start

```bash
# 1. Install Node deps
npm install

# 2. Create your env file
cp .env.example .env
#    then edit .env — see "LLM setup" below

# 3. Run the server
npm start                # or: npm run dev (auto-restart on file changes)
```

Open http://localhost:5173

---

## LLM setup

Edit `.env`. Pick **one** of the two options:

### Option A — Local (Ollama, default)

```bash
brew install ollama          # macOS; or download from ollama.com
brew services start ollama   # starts the API on localhost:11434
ollama pull qwen2.5:3b
```

Keep these lines in `.env`:

```
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen2.5:3b
```

### Option B — OpenAI

Comment out the two `LLM_*` lines above and add:

```
OPENAI_API_KEY=sk-...
```

You can also paste an OpenAI key per-request from the UI.

---

## Optional: handwriting → font (HandFonted)

The "From a writing sample" tab is disabled until you install the Python pipeline.

```bash
npm run setup-handfonted     # one-time, ~2 min
```

This creates `handfonted/.venv/` and installs PaddleOCR, PyTorch, and friends from `handfonted/requirements.txt`. Once installed, `npm start` will spawn the Python service automatically on port `5179` and the tab will become available.

To skip it, just don't run the setup — the rest of the app works fine.

---

## File layout

```
server.js              # Express server — LLM proxy, scrapers, HandFonted bridge
public/                # Static frontend (index.html, app.js, styles.css)
handfonted/            # Vendored Python font-builder service
notes/                 # Generated notes (gitignored)
.env.example           # Copy to .env
```

---

## Common tweaks

| What | How |
| --- | --- |
| Change port | `PORT=3000` in `.env` |
| Change HandFonted port | `HANDFONTED_PORT=5180` in `.env` |
| Use a different Ollama model | `ollama pull <model>` then set `LLM_MODEL` |
| Use a different OpenAI model | `OPENAI_MODEL=gpt-4o` in `.env` |

---

## Troubleshooting

- **"Local LLM not configured"** — `LLM_BASE_URL` is missing from `.env`, or Ollama isn't running (`brew services start ollama`).
- **"From a writing sample" tab disabled** — run `npm run setup-handfonted`.
- **HandFonted setup fails on `paddleocr`** — make sure you're on Python 3.10+ and have a working C/C++ toolchain (`xcode-select --install` on macOS).
- **Port 5173 in use** — set `PORT` in `.env` to something free.
