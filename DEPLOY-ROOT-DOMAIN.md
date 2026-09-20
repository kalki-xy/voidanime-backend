# Deploy YRcine to Your Root Domain (no API key · no VPN)

This repo IS the deployment: `server.js` (backend + all scrapers) + `public/index.html` (the YRcine app).
When both are in the repo, one Vercel project serves the whole site on your own domain —
frontend and API are **same-origin**, so nothing points at `*.vercel.app` and Indian
ISPs have nothing to block. This is exactly how ppcine/voidverse-style sites work:

- **Catalog** — TMDB/AniList (key already embedded in the frontend — end users never need any key)
- **Streams** — server-side scrapers in this repo (no user keys, no signups)
- **VPN-free** — every blocked CDN (megaplay.su, animesalt if blocked, TMDB images) is proxied
  through YOUR domain via `/api/hindi/media` and the wsrv.nl image chain built into the frontend

## Steps (Vercel, ~5 minutes)

1. **Upload the app** — on GitHub, open the `public` folder of this repo →
   `Add file → Upload files` → drag the full `index.html` (YRcine Noir VoidVerse build,
   v50.26+) over the placeholder → `Commit changes`. Vercel auto-deploys (~2 min).
2. **Add your root domain** — Vercel dashboard → this project → `Settings → Domains` →
   `Add` → enter your ROOT domain (e.g. `yrcine.com`, not a subdomain). Vercel shows DNS records.
3. **Point DNS** — at your registrar: `A @ 76.76.21.21` and `CNAME www cname.vercel-dns.com`
   (or as shown by the Vercel dialog for your specific domain). Wait for the SSL cert (auto).
4. **Done** — open `https://yourdomain.com`. Check `https://yourdomain.com/api/health` → `{"status":"ok"}`.

The app auto-detects it is served from your domain (http/https, non-localhost) and uses the
**same-origin API** automatically. The same file still works from `file://` (falls back to the
public backend) and honours a custom backend set in the app's backend settings.

## Alternate: VPS / Railway / Render

```bash
git clone https://github.com/kalki-xy/voidanime-backend && cd voidanime-backend
npm install --production
npm start            # serves app on :3001 (express.static public/)
# nginx: proxy_pass http://localhost:3001;  (see DEPLOY-TO-DOMAIN notes in repo history)
```

Point your root domain's DNS at the server, `certbot --nginx -d yourdomain.com`.

## What runs where (all key-free for end users)

| Purpose | Source | Via |
|---|---|---|
| Movie/TV catalog + posters | TMDB (embedded key) | direct + wsrv.nl image proxy chain |
| Anime catalog | AniList GraphQL | direct |
| Anime SUB (multi-server) | anikoto network | app player (megaplay.buzz streams) |
| English DUB + SUB | justanime core (megaplay HLS + animegg MP4) | `/api/hindi/watch` + `/api/hindi/media` |
| Hindi/Tamil/Telugu DUB | AnimeSalt network → megaplay HLS | `/api/hindi/*` + `/api/hindi/media` |
| Movies embeds | vidsrc / videasy / 2embed | app player |
| Manga/manhwa | MangaPill + MangaTaro + MangaDex | `/api/scrape/*` |
| Cover images | various | `/api/proxy/image` |

`/api/hindi/media` rewrites m3u8 playlists so every segment and key URI flows through your
domain with the right Referer, and it forwards `Range` requests for seeking.

## Updating the app later

Just replace `public/index.html` the same way (drag-drop upload). Backend changes go in `server.js` / `providers/`.
