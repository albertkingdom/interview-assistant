# Cloudflare Workers Deployment Notes

## Target
- Repository: `interview-assistant` (monorepo)
- Backend path: `server/`
- Runtime target: Cloudflare Workers
- Purpose: host `POST /api/realtime/session` for ephemeral token minting

## Recommended Repo Structure
- `src/` + Vite frontend (existing)
- `server/` Worker code
- `server/wrangler.toml` Worker config

## One-Time Setup (Cloudflare Dashboard)
1. Go to `Workers & Pages` -> `Create` -> `Import a repository`.
2. Install/authorize `Cloudflare Workers & Pages` GitHub App.
3. Select this repository and target branch (e.g. `main`).
4. In Build settings:
   - `Root directory`: `server`
   - `Deploy command`: `npx wrangler deploy`
5. In Build watch paths:
   - Include: `server/**`
   - Exclude: `src/**`, `public/**`, `docs/**`
6. Save and deploy.

## Environment Variables / Secrets
- Required:
  - `OPENAI_API_KEY` (Worker secret)
- Optional:
  - `ALLOWED_ORIGIN` (frontend domain for CORS check)
  - `RATE_LIMIT_PER_MINUTE` (soft protection)

Set via dashboard or CLI:
- `wrangler secret put OPENAI_API_KEY`

## Example `wrangler.toml` (Draft)
```toml
name = "interview-assistant-api"
main = "src/index.ts"
compatibility_date = "2026-02-21"

[vars]
ALLOWED_ORIGIN = "https://your-frontend-domain"
```

## CI/CD Behavior in Same Branch
- Cloudflare does **not** deploy by branch path detection.
- It deploys based on project build config:
  - root directory `server/`
  - watch paths `server/**`
- Result: pushing the same branch only triggers backend deploy when `server/**` changes.

## Verify Deployment
1. Open deployed Worker URL.
2. Test endpoint:
   - `POST /api/realtime/session`
   - expect `200` and ephemeral session payload.
3. From frontend, confirm request path:
   - `VITE_API_BASE_URL=https://<worker-domain>`

## Rollback
- Cloudflare Dashboard -> Worker -> Deployments -> select previous deployment -> rollback.

## Next Step
- After `server/` code is created, add exact deploy scripts and request/response schema examples.
