# VoidAnime Backend

Node/Express manga API powering YRcine's Manga section. Five providers: MangaFire (default) · MangaDex · ComicK · MangaPill · WeebCentral.

## Endpoints

- `GET /api/health` — status + provider list
- `GET /api/trending` — AniList trending manga
- `GET /api/scrape/search?query=&provider=` — search a provider
- `GET /api/scrape/info?id=&provider=` — manga details + chapters
- `GET /api/scrape/chapters?id=&provider=` — chapter list
- `GET /api/scrape/pages?id=&chapterNumber=&chapterId=&provider=` — page image URLs
- `GET /api/proxy/image?url=` — referer-aware image proxy
- `GET /api/providers` — provider metadata

## Run locally

```bash
npm install
npm start   # http://localhost:3001
```

## Deploy to Vercel

1. Push this repo to GitHub (done)
2. vercel.com → Add New → Project → Import `voidanime-backend`
3. Deploy (no env vars needed; CORS allows all origins)
4. Backend will be live at `https://voidanime-backend.vercel.app` (or your project name)

Optional env: `ALLOWED_ORIGINS=https://yoursite.com` to restrict CORS.

## Status

- [x] server.js (Vercel-safe: `module.exports` + local-only `app.listen`)
- [x] vercel.json + package.json
- [ ] `providers/` — mangadex.js, mangapill.js, weebcentral.js, comick.js, mangafire.js (to be added)


---

## Relay & sync architecture (YRcine streaming)

The YRcine app needs a relay to reach blocked streaming hosts. It is served from three
interchangeable places — point the app at any of them with the in-app **RELAY HOST**
button (player -> route row):

| Host | Serves | Notes |
|---|---|---|
| **Supabase Edge Function `yrcine`** (default) | `/api/proxy`, `/api/embed`, `/api/catalog`, `/api/image`, `/api/health`, durable `/api/sync` | Mumbai edge; sync persists in Postgres (`yrc_sync`) |
| **Cloudflare Worker** (`worker/`) | the same relay routes | edge, no cold start; deploy with `wrangler deploy` |
| **This Vercel backend** (`relay.js`) | the same relay routes + `/api/sync` (in-memory) | original; kept as origin / fallback |

Both edge versions **forward any route they do not implement** to this Vercel backend,
so music (`/api/music/*`), `/api/trending` and `/api/scrape/*` keep working unchanged.

### Deploying the edge versions
- **Supabase**: source is `supabase/functions/yrcine/index.ts` (already deployed as function `yrcine`).
- **Cloudflare**: `cd worker && wrangler deploy` — or push to `main` and let the
  `deploy-worker` Action do it. That Action needs repo secrets `CLOUDFLARE_API_TOKEN`
  and `CLOUDFLARE_ACCOUNT_ID`.

### Environment notes
- `RELAY_SECRET` on its own no longer locks the relay. Set `RELAY_ENFORCE=1` as well to
  require `?k=<secret>` (or header `x-yr-key`) on relay routes.
- `TMDB_API_KEY` overrides the built-in TMDB key used by `/api/catalog`.
- `/api/music/debug?q=<query>` reports which JioSaavn upstream answered.
