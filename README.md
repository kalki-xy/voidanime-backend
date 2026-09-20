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
