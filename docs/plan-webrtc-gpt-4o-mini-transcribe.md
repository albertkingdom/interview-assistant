# WebRTC STT Plan (gpt-4o-mini-transcribe)

## Goal
Replace browser `SpeechRecognition` with OpenAI Realtime transcription (`gpt-4o-mini-transcribe`) to improve mixed Chinese/English recognition quality and stability.

## Current Status
- [x] Phase 1 backend scaffold started
  - `server/src/index.js` added
  - `POST /api/realtime/session` implemented
  - Cloudflare Worker config (`server/wrangler.toml`) added
- [x] Phase 2 frontend WebRTC skeleton started
  - `src/lib/realtimeSessionClient.js` added
  - `src/lib/openaiRealtimeTranscriber.js` added
  - UI engine toggle (`Browser` / `OpenAI Realtime`) added
- [ ] Phase 3 transcript pipeline hardening
- [ ] Phase 4 fallback toggle
- [ ] Phase 5 verification and hardening

## Scope
- Keep current interview workflow/UI structure.
- Add realtime STT pipeline for interviewer and candidate input.
- Keep browser STT as fallback.

## Architecture
- Frontend (Vite/React)
  - `RTCPeerConnection` to OpenAI Realtime endpoint.
  - Data channel event handling for transcript deltas/final text.
  - Existing text merge logic reused (`interim/final`, pause line-break).
- Backend (new small server)
  - `POST /api/realtime/session` to mint ephemeral session token.
  - Uses server-side `OPENAI_API_KEY` only.

## Phases

### Phase 1: Server Session Endpoint
- Add `server/` (Express or Fastify).
- Implement `POST /api/realtime/session`.
- Request body:
  - `model: "gpt-4o-mini-transcribe"`
  - language hints and turn detection defaults.
- Return ephemeral client secret and session metadata.
- Add `.env.example` for `OPENAI_API_KEY`.

Acceptance:
- Frontend can fetch session token without exposing permanent key.

### Phase 2: Frontend WebRTC Client
- Add `src/lib/realtimeTranscription.js`.
- Flow:
  1. get ephemeral token from backend
  2. create peer connection
  3. add local mic track
  4. open data channel
  5. exchange SDP with Realtime endpoint
- Manage lifecycle:
  - start/stop/reconnect
  - error states
  - cleanup on phase switch/export/analyze

Acceptance:
- Clicking voice input starts a live WebRTC transcription session.

### Phase 3: Transcript Integration
- Map realtime events to current fields:
  - `question` / `answer` target
  - interim text display
  - final text merge
- Keep pause-based line break behavior.
- Add low-volume warning compatibility (reuse current analyzer path).

Acceptance:
- Existing UX still works with improved STT quality.

### Phase 4: Fallback & Settings
- Add STT engine toggle:
  - `OpenAI Realtime (recommended)`
  - `Browser SpeechRecognition (fallback)`
- Reuse current language/audio controls where possible.
- If Realtime fails, auto-switch or prompt fallback.

Acceptance:
- User can continue interview even when Realtime fails.

### Phase 5: Verification & Hardening
- Test cases:
  - long speech (>5 min)
  - mixed zh/en technical terms
  - silence pause and resume
  - network interruption and reconnect
- Update README setup/run steps (frontend + server).

Acceptance:
- Lint/build pass and manual regression checklist pass.

## Data/Event Mapping (Draft)
- Realtime delta event -> `interimText`
- Realtime completed/final event -> append to `currentQuestion/currentAnswer`
- session closed/error -> stop state + fallback option

## Security Notes
- Do not place permanent OpenAI key in frontend bundle.
- Use short-lived ephemeral token for browser WebRTC connection.
- Limit backend endpoint to same-origin and basic rate limit.

## Implementation Order
1. Phase 1 + Phase 2 skeleton
2. Phase 3 integration
3. Phase 4 fallback toggle
4. Phase 5 QA and docs

## Commit Strategy
1. `feat(server): add realtime session endpoint for ephemeral tokens`
2. `feat(stt): add WebRTC realtime transcription client`
3. `feat(ui): integrate realtime transcript into interview inputs`
4. `feat(stt): add engine fallback and runtime toggles`
5. `docs: update setup and realtime transcription workflow`

## Deployment Notes
- Cloudflare Workers deployment notes are tracked in:
  - `docs/deploy-cloudflare-workers.md`
