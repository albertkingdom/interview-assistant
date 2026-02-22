# Interview Assistant

Interview helper app (React + Vite) with voice input and AI analysis.

## Project Structure
- `src/`: frontend app
- `server/`: Cloudflare Worker API
  - `/api/realtime/session`: OpenAI Realtime ephemeral session creation
  - `/api/gemini/analyze`: Gemini interview analysis
- `docs/`: implementation and deployment notes

## Prerequisites
- Node.js 20+
- npm
- Cloudflare account (for Worker deploy)

## Local Development

### 1) Install frontend deps
```bash
npm install
```

### 2) Install Worker deps
```bash
npm --prefix server install
```

### 3) Configure environment
- Frontend:
  - Copy `.env.example` to `.env`
  - Adjust `VITE_API_BASE_URL` if needed
- Worker:
  - Copy `server/.dev.vars.example` to `server/.dev.vars`
  - Set `OPENAI_API_KEY`
  - Set `GEMINI_API_KEY`

### 4) Run services
- Terminal A (frontend):
```bash
npm run dev:client
```
- Terminal B (worker API):
```bash
npm run dev:server
```

Frontend dev server proxies `/api/*` to `http://127.0.0.1:8787`.

## Worker Endpoint

### `POST /api/realtime/session`
Creates an OpenAI Realtime transcription session (default model: `gpt-4o-mini-transcribe`).

Example request:
```json
{
  "model": "gpt-4o-mini-transcribe",
  "language": "zh",
  "noiseReductionType": "near_field",
  "silenceDurationMs": 900,
  "includeLogprobs": false
}
```

### `POST /api/gemini/analyze`
Runs Gemini interview analysis from backend secret key.

Example request:
```json
{
  "jobTitle": "前端工程師",
  "customTopics": ["技術能力", "問題解決"],
  "coveredTopics": ["技術能力"],
  "conversation": [
    { "question": "介紹一次你解決效能瓶頸的經驗", "answer": "..." }
  ],
  "latestAnswer": "..."
}
```

## Scripts
- `npm run dev` / `npm run dev:client`: run frontend
- `npm run dev:server`: run Worker locally via Wrangler
- `npm run build`: build frontend
- `npm run lint`: lint frontend code
- `npm run check:worker`: dry-run Worker deploy

## Deployment
- Worker deploy notes: `docs/deploy-cloudflare-workers.md`
- WebRTC/STT implementation plan: `docs/plan-webrtc-gpt-4o-mini-transcribe.md`
