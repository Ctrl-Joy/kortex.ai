# Deploying KORTEX on Render

```
Browser / phone ──HTTPS + WSS──▶ Render static site  (apps/web, React build)
                                        │
                                        └──▶ Render web service  (services/api, FastAPI + SQLite)
                                                    ▲
Demo laptop: vision service ────────────────────────┘  (optional; webcam stays local)
```

Both services live on **Render** so WebSockets work end-to-end (the Live Monitoring
page streams events in real time). The free tier sleeps after ~15 minutes of
inactivity (first request takes 30–60 s) and has no persistent disk, so the SQLite
database reseeds on each deploy.

## 1. One-click Blueprint deploy

1. Sign in at <https://render.com> with GitHub.
2. **New → Blueprint** → select the `kortex.ai` repo.
3. Render reads `render.yaml` and creates two services:

   | Service | Type | What it runs |
   |---|---|---|
   | **kortex-api** | Web Service (Python) | FastAPI backend at `/api/*` |
   | **kortex-web** | Static Site | React SPA built with Vite |

4. Set the environment variables Render prompts you for:

   | Variable | Where | Value |
   |---|---|---|
   | `KORTEX_SECRET_KEY` | kortex-api | A long random string — `python -c "import secrets;print(secrets.token_urlsafe(48))"` |
   | `KORTEX_VISION_API_KEY` | kortex-api | Another random string |
   | `KORTEX_SEED_STAFF_PASSWORD` | kortex-api | A **strong** password (the site is public) |
   | `KORTEX_CORS_ORIGINS` | kortex-api | `https://kortex-web.onrender.com` (or whatever URL Render gives the static site — no trailing slash!) |

   `render.yaml` wires `VITE_API_BASE_URL` on the static site to point at the API
   service automatically via `fromService`.

5. Click **Apply**. Both services build and deploy.
6. Verify: open `https://<your-api-service>.onrender.com/api/health` → `"ok": true`.
7. Open the static site URL → sign in as `manager` with the password from step 4.

## 2. Manual setup (if not using the Blueprint)

### API (web service)

1. **New → Web Service** → connect the repo.
2. **Root Directory:** `services/api`
3. **Runtime:** Python 3
4. **Build Command:** `pip install -r requirements.txt`
5. **Start Command:** `python -m app.db.seed && uvicorn app.main:app --host 0.0.0.0 --port $PORT`
6. **Environment Variables:** same as the table in step 1.4 above, plus:
   * `PYTHON_VERSION` = `3.12.8`
   * `KORTEX_ENVIRONMENT` = `production`
7. Add a health check path: `/api/health`

### Web app (static site)

1. **New → Static Site** → connect the same repo.
2. **Root Directory:** `apps/web`
3. **Build Command:** `npm ci && npm run build`
4. **Publish Directory:** `dist`
5. **Environment Variables:**
   * `VITE_API_BASE_URL` = `https://<your-api-service>.onrender.com` (no trailing slash)
6. Add a rewrite rule: `/*` → `/index.html` (status 200) for SPA routing.
7. Add security headers (optional but recommended):
   * `X-Frame-Options: DENY`
   * `X-Content-Type-Options: nosniff`
   * `Referrer-Policy: strict-origin-when-cross-origin`

### Connect them

Set `KORTEX_CORS_ORIGINS` on the API service to the static site's URL (no trailing
slash). Render redeploys automatically. Open the static site and check the header
badge shows **Live**.

## 3. Optional: send real camera events from a laptop

In the laptop's `.env`:

```
KORTEX_API_URL=https://<your-api-service>.onrender.com
KORTEX_VISION_API_KEY=<the same value you set on Render>
```

Then run `scripts\start-vision.ps1`. Detections appear on the hosted dashboard as
**LIVE CAMERA** events. The video preview itself is only shown on the laptop's local
dashboard (`http://localhost:5173`).

## Notes and limits

* **Free tier:** the API service sleeps after ~15 min idle → first request takes
  30–60 s to cold-start. The database reseeds automatically on each deploy (no
  persistent disk on the free plan).
* **WebSockets:** Render supports WebSockets on web services. The Live Monitoring
  page receives real-time events without polling — this is why we deploy here
  instead of a serverless platform.
* Changing `VITE_API_BASE_URL` requires a **redeploy** of the static site (Vite
  bakes it in at build time).
* Every push to `main` redeploys both services automatically.
* This is a prototype: there is no rate limiting and tokens are stored in the
  browser. Keep the demo staff password strong.
