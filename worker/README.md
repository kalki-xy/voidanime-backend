# YRcine relay - Cloudflare Worker

Edge replacement for the Vercel relay. Serves the streaming-critical endpoints and
forwards everything else to the legacy origin (which Cloudflare can reach even when
your phone cannot).

## Endpoints
- Served at the edge: `/api/health`, `/api/proxy`, `/api/proxy/image`, `/api/embed`, `/api/catalog`, `/api/image`
- Forwarded to `https://voidanime-backend.vercel.app`: `/api/trending`, `/api/music/*`, `/api/sync`, `/api/scrape/*`, `/`

## Deploy
```
npm i -g wrangler
wrangler login
cd worker
wrangler deploy
```
`wrangler deploy` prints a URL like `https://yrcine-relay.<your-subdomain>.workers.dev`.
Put that in the app: open a title -> player -> **RELAY HOST** -> paste it -> Save & reload.

## Custom domain (recommended, avoids ISP blocking)
Uncomment and edit in `wrangler.toml`:
```
routes = [{ pattern = "api.yourdomain.com", custom_domain = true }]
```

## Notes
- Zero npm dependencies.
- `ALLOW_HOSTS` / `AD_HOSTS` mirror `relay.js` - keep them in sync when adding providers.
- Requests the Worker cannot serve are proxied to the Vercel origin, so nothing breaks
  if you migrate gradually.
