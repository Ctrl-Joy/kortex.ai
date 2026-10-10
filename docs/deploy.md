# Deploying KORTEX: Vercel (web) + Render (API)

```
Browser / phone ──HTTPS──▶ Vercel  (apps/web, static React build)
       │
       └──HTTPS + WSS──▶ Render  (services/api, FastAPI + SQLite)
                              ▲
Demo laptop: vision service ──┘  (optional; webcam stays local)
```

Vercel serves the static web app. Vercel functions can't hold WebSockets or a
persistent SQLite database, so the API runs on Render as a normal long-running
web service. The vision service needs a webcam, so it stays on the demo laptop
and can send its events to the Render API.

## 1. API on Render (do this first)

1. Sign in at https://dashboard.render.com with GitHub.
2. **New → Blueprint** → select the `kortex.ai` repository. Render reads `render.yaml`.
3. When prompted for the secret values, set:
   * `KORTEX_SEED_STAFF_PASSWORD` to a **strong** password (this site is public).
   * `KORTEX_CORS_ORIGINS` to `https://placeholder.invalid` for now. You'll update it in step 3.
   * `KORTEX_CORS_ORIGIN_REGEX`: leave empty.

   `KORTEX_SECRET_KEY` and `KORTEX_VISION_API_KEY` are generated automatically.
4. **Apply**. When the deploy is live, open `https://<your-service>.onrender.com/api/health`.
   You should see `"ok": true`. Note this URL.

**Free-plan behaviour:** the service sleeps after about 15 minutes idle, so the first
request after that takes about 30–60 s. The SQLite database is recreated (re-seeded with
demo data) on every deploy or restart. For persistent data, add a Render disk mounted at
`/var/data` and set `KORTEX_DATABASE_URL=sqlite:////var/data/kortex.db` (paid plan).

## 2. Web app on Vercel

1. Sign in at https://vercel.com with GitHub → **Add New… → Project** → import `kortex.ai`.
2. **Root Directory:** `apps/web` (click *Edit* next to it). The framework is detected as Vite;
   `apps/web/vercel.json` sets the build and SPA routing.
3. **Environment Variables:**
   * `VITE_API_BASE_URL` = `https://<your-service>.onrender.com` (no trailing slash)
4. **Deploy**. Note the production URL, e.g. `https://kortex-ai.vercel.app`.

## 3. Connect them

On Render → `kortex-api` → **Environment**:

* `KORTEX_CORS_ORIGINS` = your Vercel production URL, e.g. `https://kortex-ai.vercel.app`
* optional `KORTEX_CORS_ORIGIN_REGEX` to also allow preview deployments, e.g.
  `^https://kortex-ai-[a-z0-9-]+\.vercel\.app$`

Save. Render redeploys. Open the Vercel URL: the header badge should say **Live**.
Sign in as `manager` with the password from step 1.3.

Because Vercel serves HTTPS, phones can open `https://<vercel-url>/shop` and use the
camera directly. No local HTTPS setup is needed.

## 4. Optional: send real camera events from the laptop

In the laptop's `.env`:

```
KORTEX_API_URL=https://<your-service>.onrender.com
KORTEX_VISION_API_KEY=<copy the value from Render → Environment>
```

Then run `scripts\start-vision.ps1`. Detections appear on the hosted site as **LIVE CAMERA**
events. The video preview itself is only shown on the laptop's local dashboard
(`http://localhost:5173`). The hosted Live Monitoring page says so instead of showing a
broken image.

## Notes and limits

* Changing `VITE_API_BASE_URL` requires a Vercel **redeploy** (Vite bakes it in at build time).
* Every push to `main` redeploys both Render and Vercel automatically.
* This is a prototype: there is no rate limiting, and tokens are stored in the browser.
  Keep the demo staff password strong and don't put real customer data in it.
