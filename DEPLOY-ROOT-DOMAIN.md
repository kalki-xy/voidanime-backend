# Deploy YRcine to Your Root Domain (no API key · no VPN)

This repo IS the deployment: `server.js` (backend + all scrapers) + `public/index.html` (the YRcine app).
When both are in the repo, one Vercel project serves the whole site on your own domain —
frontend and API are **same-origin**, so nothing points at `*.vercel.app` and Indian
ISPs have nothing to block. This is exactly how ppcine/voidverse-style sites work.

## Key-free and VPN-free, endpoint by endpoint

| Purpose | Source | Via |
|---|---|---|
| Movie/TV catalog + posters | TMDB | **`/api/tmdb/*` backend proxy** (server-side PUBLIC key — the one Overseerr ships in its open source — with a 30-minute response cache; the app's fetch layer strips its client key and routes every call here, so users never need any key and the Jio/ISP block on api.themoviedb.org is bypassed) |
| TMDB images | image.tmdb.org | wsrv.nl / weserv image chain built into the app |
| Anime catalog | AniList GraphQL | direct |
| Anime SUB (multi-server) | anikoto network | app player (megaplay.buzz streams) |
| English DUB + SUB | justanime core (megaplay HLS + animegg MP4) | `/api/hindi/watch` + `/api/hindi/media` |
| Hindi/Tamil/Telugu DUB | AnimeSalt network → megaplay HLS | `/api/hindi/*` + `/api/hindi/media` |
| Movies embeds | vidsrc / videasy / 2embed | app player |
| Manga/manhwa | MangaPill + MangaTaro + MangaDex | `/api/scrape/*` |
| Cover images | various | `/api/proxy/image` |

`/api/hindi/media` rewrites m3u8 playlists so every segment and key URI flows through your
domain with the right Referer, and it forwards `Range` requests for seeking.

## Steps (Vercel, ~5 minutes)

1. **Upload the app** — on GitHub, open the `public` folder of this repo →
   `Add file → Upload files` → drag the full `index.html` (YRcine Noir VoidVerse build,
   v50.28+) over the placeholder → `Commit changes`. Vercel auto-deploys (~2 min).
2. **Add your root domain** — Vercel dashboard → this project → `Settings → Domains` →
   `Add` → enter your ROOT domain (e.g. `yrcine.com`, not a subdomain). Vercel shows DNS records.
3. **Point DNS** — at your registrar: `A @ 76.76.21.21` and `CNAME www cname.vercel-dns.com`
   (or as shown by the Vercel dialog for your specific domain). Wait for the SSL cert (auto).
4. **Done** — open `https://yourdomain.com`. Check `https://yourdomain.com/api/health` → `{"status":"ok"}`.

The app auto-detects it is served from your domain (http/https, non-localhost) and uses the
**same-origin API** automatically. The same file still works from `file://` (falls back to the
public backend) and honours a custom backend set in the app's backend settings.

## Optional env vars

- `TMDB_KEY` — if you ever want your own TMDB key to take priority over the public one
- `ALLOWED_ORIGINS` — restrict CORS if desired (defaults to allow all)

## Alternate: VPS / Railway / Render

```bash
git clone https://github.com/kalki-xy/voidanime-backend && cd voidanime-backend
npm install --production
npm start            # serves app on :3001 (express.static public/)
# nginx: proxy_pass http://localhost:3001;
```

Point your root domain's DNS at the server, `certbot --nginx -d yourdomain.com`.

## Updating the app later

Just replace `public/index.html` the same way (drag-drop upload). Backend changes go in `server.js` / `providers/`.
