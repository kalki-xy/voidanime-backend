/**
 * ============================================================================
 *  YRcine Relay — EXPRESS version  (drop into your existing backend)
 * ============================================================================
 *  Use this if you already run an Express backend (the one serving your
 *  /api/health manga-provider route) and you do NOT want a second Vercel
 *  project or any vercel.json changes.
 *
 *  WHAT IT GIVES YOU (same as the edge relay):
 *     /proxy?url=     JSON / text / media passthrough for blocked hosts
 *     /embed?url=     player pages, rewritten + ad-filtered so they can frame
 *     /catalog?path=  TMDB catalog relay (key stays server-side)
 *     /image?url=     image relay fallback
 *     /health         reachability check
 *
 *  HOW TO INSTALL (2 lines in your backend):
 *     const relay = require('./yrcine-relay-express');
 *     app.use('/api', relay);          // -> /api/proxy, /api/embed, ...
 *  (or mount it somewhere unique, e.g. app.use('/api/relay', relay))
 *
 *  Requires Node 18+ (global fetch). No other dependencies except express,
 *  which your backend already has.
 *
 *  Env vars (optional):  TMDB_API_KEY, RELAY_SECRET, RELAY_TIMEOUT_MS
 *  If RELAY_SECRET is set, callers must pass ?k=<secret> or header x-yr-key.
 * ============================================================================
 */
'use strict';

const express = require('express');

const TMDB_API_KEY = process.env.TMDB_API_KEY || '20be784f740b6b638c906dde5b35efae';
const RELAY_SECRET = process.env.RELAY_SECRET || '';
const RELAY_ENFORCE = process.env.RELAY_ENFORCE === '1';  /* opt-in: a set RELAY_SECRET alone no longer locks the relay */
const TIMEOUT = Number(process.env.RELAY_TIMEOUT_MS || 20000);

const ALLOW_HOSTS = [
  'api.themoviedb.org', 'image.tmdb.org', 'themoviedb.org',
  'graphql.anilist.co', 'anilist.co', 'api.jikan.moe',
  'www.omdbapi.com', 'omdbapi.com',
  'mangapill.com', 'api.mangadex.org', 'uploads.mangadex.org',
  'mangadex.org', 'mangabuddy.com', 'mangafire.to', 'mangakakalot.com',
  'weebcentral.com', 'toonily.com', 'manganato.com', 'mangataro.org',
  'voidverse.me', 'player.voidverse.me', 'anilink.cc',
  'vidzee.wtf', 'vidfast.pro', 'vidspark.to', 'primesrc.me', 'peachify.top',
  'vidnest.fun', 'vidcore.org', '2embed.skin', '2embed.to', '2embed.cc', 'vidsrc.pm',
  'vaplayer.ru', 'vidup.to', '123embed.net', 'mapple.fun', 'anyembed.xyz',
  'vidsrc.su', 'vidsrc.to', 'multiembed.mov', '111movies.com', 'vidlink.pro',
  'videasy.net', 'vidora.su', 'vidsrc.cc', 'frembed.cc', 'frembed.icu', 'vidsrc.me',
  'embed.su', 'vidsrc.net', 'vidsrc.xyz', 'vidsrc.wtf', 'moviesapi.club', 'moviesapi.to', 'vidbinge.dev',
  'autoembed.cc', 'autoembed.co', 'smashystream.com', 'player.smashystream.com',
  'nontongo.win', '2anime.xyz', 'aniwatch.to', 'aniwatchtv.to',
  'eporner.com', 'www.eporner.com', 'static-ca-cdn.eporner.com', 'gvideo.eporner.com',
  'adultgames.games', 'content-cdn.adultgames.games', 'xxxgames.games',
  'nhentai.net', 'i.nhentai.net', 'i2.nhentai.net', 'i3.nhentai.net', 't.nhentai.net', 't2.nhentai.net',
  'discord.com', 'discordapp.com', 'discordapp.net', 'cdn.discordapp.com',
  'jiosaavn.com', 'www.jiosaavn.com', 'saavncdn.com', 'aac.saavncdn.com',
  'c.saavncdn.com', 'jiosaavn-api-*.vercel.app', 'saavn.dev',
  'jiosavan-api-with-playlist.vercel.app', 'lrclib.net',
  'pollinations.ai', 'image.pollinations.ai',
  'wsrv.nl', 'i.scdn.co', 'lh3.googleusercontent.com', 'media.kitsu.io',
  'cdn.jsdelivr.net', 'fonts.gstatic.com', 'fonts.googleapis.com',
];
const EXTRA = (process.env.RELAY_EXTRA_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
ALLOW_HOSTS.push(...EXTRA);

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

const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; } };
const isAdHost = (h) => AD_HOSTS.some((d) => h === d || h.endsWith('.' + d));
const isAllowed = (h) => ALLOW_HOSTS.some((d) => {
  if (d.indexOf('*') >= 0) return new RegExp('^' + d.replace(/\./g, '\\.').replace(/\*/g, '[^.]+') + '$').test(h);
  return h === d || h.endsWith('.' + d);
});

function rewriteM3u8(text, baseUrl, selfBase) {
  const abs = (u) => { try { return new URL(u, baseUrl).href; } catch (e) { return u; } };
  const prox = (u) => selfBase + '/proxy?url=' + encodeURIComponent(abs(u));
  const out = [];
  text.split(/\r?\n/).forEach((ln) => {
    const t = ln.trim();
    if (t === '') { out.push(ln); return; }
    if (t.startsWith('#')) {
      if (/EXT-X-CUE-OUT|EXT-X-CUE-IN|EXT-X-SCTE35|EXT-OATCLS-SCTE35/i.test(t)) return;
      out.push(ln.replace(/URI="([^"]+)"/g, (m, u) => isAdHost(hostOf(abs(u))) ? 'URI="data:application/vnd.apple.mpegurl,"' : 'URI="' + prox(u) + '"'));
      return;
    }
    if (isAdHost(hostOf(abs(t))) || /\/ad(s)?[\/_-]/i.test(t)) return;
    out.push(prox(t));
  });
  return out.join('\n');
}

function rewriteHtml(html, baseUrl, selfBase) {
  const abs = (u) => { try { return new URL(u, baseUrl).href; } catch (e) { return u; } };
  const prox = (u) => selfBase + '/proxy?url=' + encodeURIComponent(abs(u));
  html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
  html = html.replace(/<meta[^>]+http-equiv=["']?x-frame-options["']?[^>]*>/gi, '');
  html = html.replace(/<script\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (m, u) => isAdHost(hostOf(abs(u))) ? '<!-- ad script removed -->' : m);
  html = html.replace(/\b(src|href|poster|data-src|data-lazy-src|action)=("|')([^"']+)\2/gi, (m, attr, q, u) => {
    if (/^(data:|blob:|javascript:|#|mailto:)/i.test(u)) return m;
    if (isAdHost(hostOf(abs(u)))) return attr + '=' + q + 'about:blank' + q;
    return attr + '=' + q + prox(u) + q;
  });
  html = html.replace(/url\((['"]?)(https?:\/\/[^)'"]+)\1\)/gi, (m, q, u) => isAdHost(hostOf(u)) ? 'url(about:blank)' : 'url(' + prox(u) + ')');
  const shim = '<script>(function(){var B=' + JSON.stringify(selfBase) + ';var AD=' + JSON.stringify(AD_HOSTS) +
    ';function ad(u){try{var h=new URL(u,location.href).hostname.toLowerCase();return AD.some(function(d){return h===d||h.slice(-(d.length+1))===\'.\'+d;});}catch(e){return false;}}' +
    'function px(u){return B+\'/proxy?url=\'+encodeURIComponent(new URL(u,location.href).href);}' +
    'var _f=window.fetch;window.fetch=function(i,o){try{var u=typeof i===\'string\'?i:(i&&i.url);if(u){if(ad(u))return Promise.resolve(new Response(\'\',{status:204}));if(/^https?:/i.test(u)&&u.indexOf(B)!==0)return _f(px(u),o);}}catch(e){}return _f(i,o);};' +
    'var _o=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){try{if(u){if(ad(u)){return _o.call(this,m,\'about:blank\');}if(/^https?:/i.test(u)&&u.indexOf(B)!==0)u=px(u);}}catch(e){}return _o.call(this,m,u);};})();</script>';
  html = html.replace(/<head([^>]*)>/i, '<head$1><base href="' + baseUrl + '">' + shim) || (shim + html);
  return html;
}

function embedErrorPage(title, detail) {
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<body style="margin:0;background:#0b0b10;color:#fff;font:600 14px/1.5 system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center">' +
    '<div style="max-width:320px;padding:20px">' +
    '<div style="font:800 11px monospace;letter-spacing:2px;color:#fb7185;margin-bottom:8px">YRcine relay</div>' +
    '<div style="font:800 15px system-ui;margin-bottom:6px">' + title + '</div>' +
    '<div style="color:rgba(255,255,255,.55);font-size:12px">' + detail + '</div></div></body>';
}

const router = express.Router();

router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (RELAY_ENFORCE && RELAY_SECRET && req.query.k !== RELAY_SECRET && req.headers['x-yr-key'] !== RELAY_SECRET) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  next();
});

/* capture raw request bodies so POST-based player APIs work through the relay */
router.use(express.raw({ type: () => true, limit: '3mb' }));

function selfBaseOf(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return proto + '://' + host + req.baseUrl;
}

router.get('/health', (req, res) => {
  res.json({ ok: true, relay: 'yrcine', hosts: ALLOW_HOSTS.length, ads: AD_HOSTS.length, ts: Date.now() });
});

router.all('/proxy', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ ok: false, error: 'url required' });
  const host = hostOf(url);
  if (isAdHost(host)) return res.status(204).end();
  if (!isAllowed(host)) return res.status(403).json({ ok: false, error: 'host not allowed', host });
  try {
    const headers = {
      'user-agent': req.headers['user-agent'] || 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36',
      accept: req.headers.accept || '*/*',
      'accept-encoding': 'identity',
    };
    const init = { method: req.method, headers, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const b = req.body;
      if (Buffer.isBuffer(b)) init.body = b;
      else if (b && typeof b === 'object' && Object.keys(b).length) init.body = JSON.stringify(b);
      else if (typeof b === 'string' && b.length) init.body = b;
      if (init.body && req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    }
    const up = await fetch(url, init);
    const ctype = up.headers.get('content-type') || '';
    if (/mpegurl|vnd\.apple/i.test(ctype) || /\.m3u8($|\?)/i.test(url)) {
      const text = await up.text();
      res.setHeader('content-type', 'application/vnd.apple.mpegurl');
      return res.send(rewriteM3u8(text, url, selfBaseOf(req)));
    }
    ['content-type', 'content-range', 'accept-ranges', 'cache-control'].forEach((k) => {
      const v = up.headers.get(k); if (v) res.setHeader(k, v);
    });
    res.status(up.status);
    if (!up.body) return res.end();
    const reader = up.body.getReader();
    const pump = () => reader.read().then(({ done, value }) => { if (done) return res.end(); res.write(Buffer.from(value)); return pump(); }).catch(() => res.end());
    pump();
  } catch (e) {
    res.status(502).json({ ok: false, error: 'upstream failed', detail: String(e).slice(0, 160) });
  }
});

router.get('/embed', async (req, res) => {
  const url = req.query.url;
  const sendErr = (code, title, detail) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('content-security-policy', 'frame-ancestors *');
    res.status(code).send(embedErrorPage(title, detail));
  };
  if (!url) return sendErr(400, 'No source URL', 'The player was opened without a source.');
  const host = hostOf(url);
  if (!isAllowed(host)) return sendErr(403, 'Source not allowed', 'This host is not in the relay allowlist. Add it to ALLOW_HOSTS.');
  try {
    const up = await fetch(url, { headers: {
      'user-agent': 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36',
      accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-language': 'en-IN,en;q=0.9',
    }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
    if (!up.ok) return sendErr(502, 'Source returned ' + up.status, 'The provider refused the relay request. Try the Direct route or another source.');
    const html = await up.text();
    if (!/<!doctype|<html|<head|<body/i.test(html)) return sendErr(502, 'Unexpected response', 'The provider did not return a playable page.');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('content-security-policy', 'frame-ancestors *');
    res.send(rewriteHtml(html, url, selfBaseOf(req)));
  } catch (e) {
    sendErr(502, 'Source did not respond', 'The provider timed out through the relay. Try the Direct route or another source.');
  }
});

router.get('/catalog', async (req, res) => {
  const path = String(req.query.path || '').replace(/^\/+/, '');
  if (!path) return res.status(400).json({ ok: false, error: 'path required' });
  const qs = new URLSearchParams();
  Object.keys(req.query).forEach((k) => { if (k !== 'path' && k !== 'k') qs.set(k, req.query[k]); });
  qs.set('api_key', TMDB_API_KEY);
  try {
    const r = await fetch('https://api.themoviedb.org/3/' + path + '?' + qs.toString(), { signal: AbortSignal.timeout(TIMEOUT) });
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'public, max-age=120');
    res.status(r.status).send(await r.text());
  } catch (e) {
    res.status(502).json({ ok: false, error: 'tmdb failed', detail: String(e).slice(0, 160) });
  }
});

router.get('/image', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ ok: false, error: 'url required' });
  const tries = [url, 'https://wsrv.nl/?url=' + encodeURIComponent(url)];
  for (const t of tries) {
    try {
      const r = await fetch(t, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'image/*' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      res.setHeader('content-type', r.headers.get('content-type') || 'image/jpeg');
      res.setHeader('cache-control', 'public, max-age=86400');
      const reader = r.body.getReader();
      const pump = () => reader.read().then(({ done, value }) => { if (done) return res.end(); res.write(Buffer.from(value)); return pump(); }).catch(() => res.end());
      return pump();
    } catch (e) { /* next */ }
  }
  res.status(502).json({ ok: false, error: 'image unreachable' });
});

module.exports = router;
module.exports.rewriteM3u8 = rewriteM3u8;
module.exports.rewriteHtml = rewriteHtml;
module.exports.isAdHost = isAdHost;
module.exports.isAllowed = isAllowed;
