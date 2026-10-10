# Deploying KORTEX: Vercel (web) + Railway (API)

```
Browser / phone ──HTTPS──▶ Vercel  (apps/web, static React build)
       │
       └──HTTPS + WSS──▶ Railway (services/api, FastAPI + SQLite on a volume)
                              ▲
Demo laptop: vision service ──┘  (optional; webcam stays local)
```

Vercel serves the static web app. Vercel functions can't hold WebSockets or a
persistent SQLite database, so the API runs on Railway as a normal long-running
service with a persistent volume. The vision service needs a webcam, so it stays
on the demo laptop and can send its events to the hosted API.

## 1. API on Railway (do this first)

1. Sign in at https://railway.com with GitHub → **New Project → Deploy from GitHub repo** → `kortex.ai`.
2. Open the new service → **Settings**:
   * **Root Directory:** `services/api` (Railway then uses `services/api/railway.json`:
     Python 3.12 from `.python-version`, dependencies from `requirements.txt`, seed + uvicorn,
     health check `/api/health`).
   * **Networking → Generate Domain** to get a public URL such as `https://kortex-api-production.up.railway.app`.
3. Right-click the service → **Attach Volume** → mount path `/data` (keeps the database across deploys).
4. **Variables** → add:

   | Variable | Value |
   |---|---|
   | `KORTEX_ENVIRONMENT` | `production` |
   | `KORTEX_DATABASE_URL` | `sqlite:////data/kortex.db` |
   | `KORTEX_SECRET_KEY` | a long random string (e.g. `python -c "import secrets;print(secrets.token_urlsafe(48))"`) |
   | `KORTEX_VISION_API_KEY` | another random string |
   | `KORTEX_SEED_STAFF_PASSWORD` | a **strong** password (the site is public) |
   | `KORTEX_CORS_ORIGINS` | `https://placeholder.invalid` for now (step 3 sets the real one) |

5. Railway redeploys. Open `https://<your-railway-domain>/api/health` and check for `"ok": true`.

Railway gives new accounts trial credit; after that it is a paid service (a small API
like this costs a few dollars a month).

<details>
<summary>Alternative: Render (free, but the database resets on every deploy)</summary>

Render → **New → Blueprint** → select the repo (uses `render.yaml`). Set
`KORTEX_SEED_STAFF_PASSWORD` and `KORTEX_CORS_ORIGINS` when prompted; the secret keys are
generated. The free plan sleeps after about 15 minutes idle (the first request takes 30–60 s)
and has no persistent disk.
</details>

## 2. Web app on Vercel

1. Sign in at https://vercel.com with GitHub → **Add New… → Project** → import `kortex.ai`.
2. **Root Directory:** `apps/web` (click *Edit* next to it). The framework is detected as Vite;
   `apps/web/vercel.json` sets the build and SPA routing.
3. **Environment Variables:**
   * `VITE_API_BASE_URL` = `https://<your-railway-domain>` (no trailing slash)
4. **Deploy**. Note the production URL, e.g. `https://kortex-ai.vercel.app`.

## 3. Connect them

On Railway → your service → **Variables**:

* `KORTEX_CORS_ORIGINS` = your Vercel production URL, e.g. `https://kortex-ai.vercel.app`
* optional `KORTEX_CORS_ORIGIN_REGEX` to also allow preview deployments, e.g.
  `^https://kortex-ai-[a-z0-9-]+\.vercel\.app$`

Railway redeploys automatically. Open the Vercel URL: the header badge should say **Live**.
Sign in as `manager` with the password from step 1.4.

Because Vercel serves HTTPS, phones can open `https://<vercel-url>/shop` and use the
camera directly. No local HTTPS setup is needed.

## 4. Optional: send real camera events from the laptop

In the laptop's `.env`:

```
KORTEX_API_URL=https://<your-railway-domain>
KORTEX_VISION_API_KEY=<the same value you set on Railway>
```

Then run `scripts\start-vision.ps1`. Note that the local dashboard's dev proxy also follows
`KORTEX_API_URL`, so switch it back to `http://127.0.0.1:8000` for fully local demos. Detections appear on the hosted site as **LIVE CAMERA**
events. The video preview itself is only shown on the laptop's local dashboard
(`http://localhost:5173`). The hosted Live Monitoring page says so instead of showing a
broken image.

## Notes and limits

* Changing `VITE_API_BASE_URL` requires a Vercel **redeploy** (Vite bakes it in at build time).
* Every push to `main` redeploys both Railway and Vercel automatically.
* This is a prototype: there is no rate limiting, and tokens are stored in the browser.
  Keep the demo staff password strong and don't put real customer data in it.
