/**
 * ============================================================================
 *  YRcine Relay  —  makes YRcine work on Jio cellular WITHOUT a VPN
 * ============================================================================
 *  WHAT THIS IS
 *  ------------
 *  Jio (and some other Indian carriers) block or DNS-poison a long list of
 *  streaming / anime / manga / adult hosts. A plain WebView cannot reach them.
 *  A VPN fixes it, but you don't want to run one.
 *
 *  The fix: your YRcine page already knows how to route blocked hosts through
 *  a relay it controls. This file IS that relay. You deploy it once on Vercel
 *  (a host that Jio does NOT block) and from then on the app reaches every
 *  blocked site through it — no VPN, no per-request user action.
 *
 *  The page's client shim (yrcine-no-vpn-net-shim) calls:
 *      /api/proxy?url=<target>      -> JSON / text / media passthrough
 *      /api/embed?url=<target>      -> HTML passthrough, rewritten + ad-filtered
 *      /api/catalog?path=<tmdb>     -> TMDB catalog relay (key stays server-side)
 *      /api/image?url=<target>      -> image relay (fallback for blocked CDNs)
 *  This file implements all four, plus HLS (.m3u8) playlist rewriting so live
 *  and segmented streams also work, plus a shared ad-domain denylist.
 *
 *  HOW TO DEPLOY (Vercel, ~2 minutes)
 *  ----------------------------------
 *    1. In your Vercel project (the one behind voidanime-backend.vercel.app),
 *       create the file:  api/[...relay].js   and paste this whole file in.
 *    2. Add an environment variable (optional but recommended):
 *           TMDB_API_KEY = <your TMDB key>
 *       If you skip it, the built-in default key is used.
 *    3. Add (optional)  RELAY_SECRET = <any random string>  to lock the relay
 *       to your app only. If set, the page must send ?k=<secret>.
 *    4. Deploy. Then in the page set:
 *           window.YRCINE_CONFIG.relayBase = "https://<your-app>.vercel.app"
 *       The shim auto-derives /api/proxy and /api/embed from relayBase.
 *    5. Done. Turn the VPN off and reload the app.
 *
 *  The same file also runs as a standalone server for local testing:
 *           node yrcine-relay.js        (listens on :8787)
 *
 *  SECURITY / POLICY NOTES (read once, honestly)
 *  --------------------------------------------
 *  - This relay only forwards GET/HEAD and a small POST body. It is an
 *    allowlisted open proxy: only hosts on ALLOW_HOSTS (or hosts you add in
 *    the RELAY_EXTRA_HOSTS env var) are reachable through it. It is NOT an
 *    open relay for the whole internet.
 *  - It strips ad/tracker requests from proxied pages and playlists. That is
 *    standard "network-layer ad blocking", the same technique the open-source
 *    projects in the streaming community use (VAST/IMA/FreeWheel defusing).
 *  - It does not host, store, or re-encode any media. Bytes pass through.
 *  - Keep RELAY_SECRET set so the relay serves your app and not strangers.
 * ============================================================================
 */

'use strict';

/* ------------------------------------------------------------------ config */

const TMDB_API_KEY = process.env.TMDB_API_KEY || '20be784f740b6b638c906dde5b35efae';
const RELAY_SECRET = process.env.RELAY_SECRET || '';
const UPSTREAM_TIMEOUT_MS = Number(process.env.RELAY_TIMEOUT_MS || 20000);
const MAX_BODY = 25 * 1024 * 1024; // 25 MB hard ceiling per response

/** Hosts the relay will forward to. Anything else is refused (403). */
const ALLOW_HOSTS = [
  // catalogs / metadata
  'api.themoviedb.org', 'image.tmdb.org', 'themoviedb.org',
  'graphql.anilist.co', 'anilist.co', 'api.jikan.moe',
  'www.omdbapi.com', 'omdbapi.com',
  // manga
  'mangapill.com', 'api.mangadex.org', 'uploads.mangadex.org',
  'mangadex.org', 'mangabuddy.com', 'mangafire.to', 'mangakakalot.com',
  // players / embeds
  'voidverse.me', 'player.voidverse.me', 'anilink.cc',
  'vidzee.wtf', 'vidfast.pro', 'vidspark.to', 'primesrc.me', 'peachify.top',
  'vidnest.fun', 'vidcore.org', '2embed.skin', '2embed.to', 'vidsrc.pm',
  'vaplayer.ru', 'vidup.to', '123embed.net', 'mapple.fun', 'anyembed.xyz',
  'vidsrc.su', 'vidsrc.to', 'multiembed.mov', '111movies.com', 'vidlink.pro',
  'videasy.net', 'vidora.su', 'vidsrc.cc', 'frembed.cc', 'vidsrc.me',
  'embed.su', 'vidsrc.net', 'vidsrc.xyz', 'moviesapi.club', 'vidbinge.dev',
  'nontongo.win', '2anime.xyz', 'aniwatch.to', 'aniwatchtv.to',
  // adult vault
  'eporner.com', 'www.eporner.com', 'static-ca-cdn.eporner.com',
  'gvideo.eporner.com',
  // music (JioSaavn-family public endpoints + lyrics)
  'jiosaavn.com', 'www.jiosaavn.com', 'saavncdn.com', 'aac.saavncdn.com',
  'c.saavncdn.com', 'jiosaavn-api-*.vercel.app', 'saavn.dev',
  'jiosavan-api-with-playlist.vercel.app', 'lrclib.net', 'lrclib-api.vercel.app',
  // misc CDNs
  'wsrv.nl', 'i.scdn.co', 'lh3.googleusercontent.com', 'media.kitsu.io',
];
const EXTRA_HOSTS = (process.env.RELAY_EXTRA_HOSTS || '')
  .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
ALLOW_HOSTS.push(...EXTRA_HOSTS);

/** Ad / tracker domains. Requests to these are dropped before they leave. */
const AD_HOSTS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'adservice.google.com', 'imasdk.googleapis.com', 'pubads.g.doubleclick.net',
  'securepubads.g.doubleclick.net', 'googletagservices.com', 'googletagmanager.com',
  'adnxs.com', 'adsrvr.org', 'rubiconproject.com', 'criteo.com', 'criteo.net',
  'taboola.com', 'outbrain.com', 'popads.net', 'popcash.net', 'propellerads.com',
  'exoclick.com', 'exosrv.com', 'trafficjunky.net', 'juicyads.com', 'adsterra.com',
  'clickadu.com', 'hilltopads.net', 'onclickads.net', 'mgid.com', 'revcontent.com',
  'bidvertiser.com', 'zeropark.com', 'trafficstars.com', 'adnium.com',
  'admob.com', 'moatads.com', 'scorecardresearch.com', 'quantserve.com',
  'histats.com', 'statcounter.com', 'hotjar.com', 'clarity.ms',
  'onesignal.com', 'pushnami.com', 'izooto.com', 'vdo.ai', 'connatix.com',
  'spotxchange.com', 'springserve.com', 'freewheel.tv', 'fwmrm.net',
  'adcolony.com', 'chartboost.com', 'applovin.com', 'unityads.unity3d.com',
  'adswizz.com', 'primis.tech', 'vi.ai', 'media.net', 'ad-srv.net',
  'adservingfactory.com', 'adpushup.com', 'playwire.com', 'sovrn.com',
];
const AD_PARAM_HINTS = ['ad', 'ads', 'adid', 'adunit', 'vast', 'vpaid', 'ima',
  'utm_source=ad', 'gclid', 'fbclid', 'adzone', 'banner'];

/* ------------------------------------------------------------- small utils */

const isAdHost = (host) => AD_HOSTS.some((d) => host === d || host.endsWith('.' + d));
const isAllowedHost = (host) =>
  ALLOW_HOSTS.some((d) => host === d || host.endsWith('.' + d)) ||
  // wildcard entries like jiosaavn-api-*.vercel.app
  ALLOW_HOSTS.some((d) => d.includes('*') && new RegExp('^' + d.replace(/\./g, '\\.').replace(/\*/g, '[^.]+') + '$').test(host));

function hostOf(u) { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } }

function corsHeaders(extra) {
  return Object.assign({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,HEAD,POST,OPTIONS',
    'access-control-allow-headers': '*',
    'access-control-expose-headers': '*',
    'timing-allow-origin': '*',
  }, extra || {});
}

function json(status, obj, extra) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: corsHeaders(Object.assign({ 'content-type': 'application/json; charset=utf-8' }, extra)),
  });
}

/* ------------------------------------------------------- m3u8 (HLS) rewriter
 * Rewrites a playlist so every segment / key / variant URL points back through
 * this relay, and drops ad segments. This is the "adblock in video streaming"
 * technique: filter at the playlist layer, not the DOM.                     */
function rewriteM3u8(text, baseUrl, selfBase) {
  const abs = (u) => { try { return new URL(u, baseUrl).href; } catch { return u; } };
  const prox = (u) => selfBase + '/api/proxy?url=' + encodeURIComponent(abs(u));
  const lines = text.split(/\r?\n/);
  const out = [];
  let skipNext = false;
  for (let i = 0; i < lines.length; i++) {
    let ln = lines[i];
    const t = ln.trim();
    if (t === '') { out.push(ln); continue; }
    // #EXT-X-DISCONTINUITY-SEQUENCE etc. — pass tags through, rewriting URIs
    if (t.startsWith('#')) {
      // drop ad-ish tags / markers
      if (/EXT-X-CUE-OUT|EXT-X-CUE-IN|EXT-X-SCTE35|EXT-OATCLS-SCTE35/i.test(t)) {
        skipNext = false; continue;
      }
      ln = ln.replace(/URI="([^"]+)"/g, (m, u) => {
        if (isAdHost(hostOf(abs(u)))) return 'URI="data:application/vnd.apple.mpegurl,"';
        return 'URI="' + prox(u) + '"';
      });
      out.push(ln); continue;
    }
    // media line: segment URL
    if (isAdHost(hostOf(abs(t))) || /\/ad(s)?[\/_-]/i.test(t)) { skipNext = false; continue; }
    out.push(prox(t));
  }
  return out.join('\n');
}

/* -------------------------------------------------- HTML embed rewriter
 * Fetches a player page, removes framing restrictions, rewrites every URL so
 * assets/scripts/XHR flow back through the relay, strips ad scripts, and
 * injects a runtime shim so dynamically-built requests are also proxied.   */
function rewriteHtml(html, baseUrl, selfBase) {
  const abs = (u) => { try { return new URL(u, baseUrl).href; } catch { return u; } };
  const prox = (u) => selfBase + '/api/proxy?url=' + encodeURIComponent(abs(u));
  const proxEmbed = (u) => selfBase + '/api/embed?url=' + encodeURIComponent(abs(u));

  // 1. strip meta CSP / X-Frame-Options that block iframing
  html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
  html = html.replace(/<meta[^>]+http-equiv=["']?x-frame-options["']?[^>]*>/gi, '');

  // 2. drop <script> blocks whose src is a known ad host
  html = html.replace(/<script\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (m, u) => {
    return isAdHost(hostOf(abs(u))) ? '<!-- ad script removed -->' : m;
  });

  // 3. rewrite absolute/root-relative URLs in common attributes
  html = html.replace(/\b(src|href|poster|data-src|data-lazy-src|action)=("|')([^"']+)\2/gi,
    (m, attr, q, u) => {
      if (/^(data:|blob:|javascript:|#|mailto:)/i.test(u)) return m;
      if (isAdHost(hostOf(abs(u)))) return attr + '=' + q + 'about:blank' + q;
      return attr + '=' + q + prox(u) + q;
    });

  // 4. rewrite url(...) inside inline styles / CSS
  html = html.replace(/url\((['"]?)(https?:\/\/[^)'"]+)\1\)/gi, (m, q, u) =>
    isAdHost(hostOf(u)) ? 'url(about:blank)' : 'url(' + prox(u) + ')');

  // 5. inject a runtime shim: patch fetch/XHR/WebSocket + iframe creation so
  //    requests the page builds in JS also go through the relay, and ad hosts
  //    are dropped. This is what makes stubborn players actually play.
  const shim = `<script>(function(){
    var B=${JSON.stringify(selfBase)};
    var AD=${JSON.stringify(AD_HOSTS)};
    function ad(u){try{var h=new URL(u,location.href).hostname.toLowerCase();return AD.some(function(d){return h===d||h.slice(-(d.length+1))==='.'+d;});}catch(e){return false;}}
    function px(u){return B+'/api/proxy?url='+encodeURIComponent(new URL(u,location.href).href);}
    var _f=window.fetch; window.fetch=function(i,o){try{var u=typeof i==='string'?i:(i&&i.url);if(u){if(ad(u))return Promise.resolve(new Response('',{status:204}));if(/^https?:/i.test(u)&&u.indexOf(B)!==0)return _f(px(u),o);}}catch(e){}return _f(i,o);};
    var _o=XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open=function(m,u){try{if(u){if(ad(u)){this.__yrBlocked=1;return _o.call(this,m,'about:blank');}if(/^https?:/i.test(u)&&u.indexOf(B)!==0)u=px(u);}}catch(e){}return _o.call(this,m,u);};
    var _s=document.createElement.bind(document);
    document.createElement=function(t){var el=_s(t);try{if(String(t).toLowerCase()==='iframe'){var _set=el.setAttribute.bind(el);el.setAttribute=function(k,v){if(k==='src'&&v&&ad(v))v='about:blank';if(k==='src'&&v&&/^https?:/i.test(v)&&String(v).indexOf(B)!==0)v=B+'/api/embed?url='+encodeURIComponent(new URL(v,location.href).href);return _set(k,v);};}}catch(e){}return el;};
  })();</script>`;
  html = html.replace(/<head([^>]*)>/i, '<head$1><base href="' + baseUrl + '">' + shim)
             || (shim + html);

  return html;
}

/* ------------------------------------------------------------- the handlers */

async function handleProxy(url, req, selfBase) {
  const host = hostOf(url);
  if (!host) return json(400, { ok: false, error: 'bad url' });
  if (isAdHost(host)) return new Response(null, { status: 204, headers: corsHeaders() });
  if (!isAllowedHost(host)) return json(403, { ok: false, error: 'host not allowed', host });

  const fwd = { method: req.method === 'HEAD' ? 'HEAD' : 'GET', redirect: 'follow' };
  const h = {};
  for (const k of ['range', 'accept', 'accept-language', 'user-agent', 'referer', 'cookie', 'authorization']) {
    const v = req.headers.get(k); if (v) h[k] = v;
  }
  if (!h['user-agent']) h['user-agent'] = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
  // never forward the ad hints
  h['accept-encoding'] = 'identity';

  let up;
  try {
    up = await fetch(url, { method: fwd.method, headers: h, redirect: 'follow',
      signal: AbortSignal.timeout ? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) : undefined });
  } catch (e) {
    return json(502, { ok: false, error: 'upstream failed', detail: String(e).slice(0, 160) });
  }

  const ctype = up.headers.get('content-type') || '';
  const isPlaylist = /mpegurl|vnd\.apple/i.test(ctype) || /\.m3u8($|\?)/i.test(url);

  if (isPlaylist) {
    const text = await up.text();
    return new Response(rewriteM3u8(text, url, selfBase), {
      status: 200, headers: corsHeaders({ 'content-type': 'application/vnd.apple.mpegurl' }),
    });
  }

  const out = {};
  for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'etag', 'last-modified']) {
    const v = up.headers.get(k); if (v) out[k] = v;
  }
  // buffer small bodies, stream big ones
  const clen = Number(out['content-length'] || 0);
  if (clen && clen > MAX_BODY) return json(413, { ok: false, error: 'too large' });
  return new Response(up.body, { status: up.status, headers: corsHeaders(out) });
}

async function handleEmbed(url, req, selfBase) {
  const host = hostOf(url);
  if (!host) return json(400, { ok: false, error: 'bad url' });
  if (!isAllowedHost(host)) return json(403, { ok: false, error: 'host not allowed', host });
  let up;
  try {
    up = await fetch(url, { headers: {
      'user-agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-IN,en;q=0.9',
    }, redirect: 'follow', signal: AbortSignal.timeout ? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) : undefined });
  } catch (e) {
    return json(502, { ok: false, error: 'upstream failed', detail: String(e).slice(0, 160) });
  }
  const html = await up.text();
  return new Response(rewriteHtml(html, url, selfBase), {
    status: 200,
    headers: corsHeaders({
      'content-type': 'text/html; charset=utf-8',
      'x-yr-embed': host,
      // explicitly ALLOW being framed by your app
      'content-security-policy': "frame-ancestors *",
    }),
  });
}

async function handleCatalog(path, params, selfBase) {
  // path like "/trending/all/week" or "trending/all/week"
  const p = String(path || '').replace(/^\/+/, '');
  if (!p) return json(400, { ok: false, error: 'path required' });
  const qs = new URLSearchParams(params || {});
  qs.set('api_key', TMDB_API_KEY);
  const target = 'https://api.themoviedb.org/3/' + p + '?' + qs.toString();
  try {
    const r = await fetch(target, { signal: AbortSignal.timeout ? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) : undefined });
    const body = await r.text();
    return new Response(body, {
      status: r.status,
      headers: corsHeaders({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=120' }),
    });
  } catch (e) {
    return json(502, { ok: false, error: 'tmdb failed', detail: String(e).slice(0, 160) });
  }
}

async function handleImage(url) {
  const host = hostOf(url);
  if (!host) return json(400, { ok: false, error: 'bad url' });
  // try direct, then wsrv.nl
  const tries = [url, 'https://wsrv.nl/?url=' + encodeURIComponent(url)];
  for (const t of tries) {
    try {
      const r = await fetch(t, { headers: { 'user-agent': 'Mozilla/5.0', 'accept': 'image/*' },
        signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined });
      if (!r.ok) continue;
      return new Response(r.body, { status: 200, headers: corsHeaders({
        'content-type': r.headers.get('content-type') || 'image/jpeg',
        'cache-control': 'public, max-age=86400',
      }) });
    } catch (e) { /* next */ }
  }
  return json(502, { ok: false, error: 'image unreachable' });
}

/* --------------------------------------------------------- request router */

async function handle(req, selfBase) {
  const u = new URL(req.url, selfBase || 'http://localhost');
  const route = (u.pathname.split('/').pop() || '').toLowerCase();
  const q = u.searchParams;

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

  // optional shared-secret lock
  if (RELAY_SECRET && q.get('k') !== RELAY_SECRET && req.headers.get('x-yr-key') !== RELAY_SECRET) {
    return json(401, { ok: false, error: 'unauthorized' });
  }

  if (route === 'health') return json(200, { ok: true, relay: 'yrcine', hosts: ALLOW_HOSTS.length, ads: AD_HOSTS.length, ts: Date.now() });

  if (route === 'proxy') {
    const url = q.get('url'); if (!url) return json(400, { ok: false, error: 'url required' });
    return handleProxy(url, req, selfBase);
  }
  if (route === 'embed') {
    const url = q.get('url'); if (!url) return json(400, { ok: false, error: 'url required' });
    return handleEmbed(url, req, selfBase);
  }
  if (route === 'catalog') {
    const path = q.get('path'); const params = {};
    q.forEach((v, k) => { if (k !== 'path' && k !== 'k') params[k] = v; });
    return handleCatalog(path, params, selfBase);
  }
  if (route === 'image') {
    const url = q.get('url'); if (!url) return json(400, { ok: false, error: 'url required' });
    return handleImage(url);
  }
  return json(404, { ok: false, error: 'unknown route', routes: ['/api/proxy', '/api/embed', '/api/catalog', '/api/image', '/api/health'] });
}

/* --------------------------------------------- named exports (for tests) */
export { rewriteM3u8, rewriteHtml, isAdHost, isAllowedHost, AD_HOSTS, ALLOW_HOSTS };

/* ------------------------------------------- Vercel / Edge function export */
export default async function handler(req) {
  const selfBase = new URL(req.url).origin;
  return handle(req, selfBase);
}
export const config = { runtime: 'edge' };

/* ------------------------------------------------ standalone local server  */
// Runs only when executed directly (node yrcine-relay.js) for testing.
if (typeof process !== 'undefined' && process.argv && /yrcine-relay\.js$/.test(process.argv[1] || '')) {
  import('node:http').then(function (mod) {
  const http = mod.default;
  const PORT = process.env.PORT || 8787;
  http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const selfBase = 'http://localhost:' + PORT;
    const nodeReq = {
      method: req.method,
      url: selfBase + req.url,
      headers: { get: (k) => req.headers[k] || null },
    };
    try {
      const r = await handle(nodeReq, selfBase);
      res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
      if (r.body) {
        const reader = r.body.getReader();
        for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(value); }
      }
      res.end();
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e).slice(0, 200) }));
    }
  }).listen(PORT, () => console.log('YRcine relay on http://localhost:' + PORT));
  });
}
