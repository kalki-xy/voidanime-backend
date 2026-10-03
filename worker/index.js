/**
 * YRcine relay - Cloudflare Worker (edge replacement for the Vercel relay)
 *
 *   Handled at the edge : /api/health, /api/proxy, /api/proxy/image, /api/embed, /api/catalog, /api/image
 *   Forwarded to origin : everything else (/api/trending, /api/music/*, /api/sync, /api/scrape/*, /)
 *
 * Zero dependencies - deploys with a single `wrangler deploy`.
 */
const ORIGIN = "https://voidanime-backend.vercel.app";
const TMDB_API_KEY = "20be784f740b6b638c906dde5b35efae";
const TIMEOUT_MS = 20000;
const UA = "Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36";

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

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,HEAD,POST,OPTIONS",
  "access-control-allow-headers": "*",
};
function cors(extra){ return Object.assign({}, CORS, extra || {}); }
function json(obj, status){ return new Response(JSON.stringify(obj), { status: status || 200, headers: cors({ "content-type": "application/json; charset=utf-8" }) }); }
function hostOf(u){ try { return new URL(u).hostname.toLowerCase(); } catch(e){ return ""; } }
function isAdHost(h){ return AD_HOSTS.some(function(d){ return h === d || h.endsWith("." + d); }); }
function isAllowed(h){ return ALLOW_HOSTS.some(function(d){ if (d.indexOf("*") >= 0) return new RegExp("^" + d.replace(/\./g, "\\.").replace(/\*/g, "[^.]+") + "$").test(h); return h === d || h.endsWith("." + d); }); }

function fetchT(url, init){
  const ctrl = new AbortController();
  const t = setTimeout(function(){ ctrl.abort(); }, TIMEOUT_MS);
  return fetch(url, Object.assign({}, init, { signal: ctrl.signal })).finally(function(){ clearTimeout(t); });
}
function selfBase(url){ return url.origin + "/api"; }

function rewriteM3u8(text, baseUrl, selfBaseUrl){
  const abs = function(u){ try { return new URL(u, baseUrl).href; } catch(e){ return u; } };
  const prox = function(u){ return selfBaseUrl + "/proxy?url=" + encodeURIComponent(abs(u)); };
  const out = [];
  text.split(/\r?\n/).forEach(function(ln){
    const t = ln.trim();
    if (t === ""){ out.push(ln); return; }
    if (t.startsWith("#")){
      if (/EXT-X-CUE-OUT|EXT-X-CUE-IN|EXT-X-SCTE35|EXT-OATCLS-SCTE35/i.test(t)) return;
      out.push(ln.replace(/URI="([^"]+)"/g, function(m, u){ return isAdHost(hostOf(abs(u))) ? 'URI="data:application/vnd.apple.mpegurl,"' : 'URI="' + prox(u) + '"'; }));
      return;
    }
    if (isAdHost(hostOf(abs(t))) || /\/ad(s)?[\/_-]/i.test(t)) return;
    out.push(prox(t));
  });
  return out.join("\n");
}

function rewriteHtml(html, baseUrl, selfBaseUrl){
  const abs = function(u){ try { return new URL(u, baseUrl).href; } catch(e){ return u; } };
  const prox = function(u){ return selfBaseUrl + "/proxy?url=" + encodeURIComponent(abs(u)); };
  html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "");
  html = html.replace(/<meta[^>]+http-equiv=["']?x-frame-options["']?[^>]*>/gi, "");
  html = html.replace(/<script\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi, function(m, u){ return isAdHost(hostOf(abs(u))) ? "<!-- ad script removed -->" : m; });
  html = html.replace(/\b(src|href|poster|data-src|data-lazy-src|action)=("|')([^"']+)\2/gi, function(m, attr, q, u){
    if (/^(data:|blob:|javascript:|#|mailto:)/i.test(u)) return m;
    if (isAdHost(hostOf(abs(u)))) return attr + "=" + q + "about:blank" + q;
    return attr + "=" + q + prox(u) + q;
  });
  html = html.replace(/url\((['"]?)(https?:\/\/[^)'"]+)\1\)/gi, function(m, q, u){ return isAdHost(hostOf(u)) ? "url(about:blank)" : "url(" + prox(u) + ")"; });
  const shim = "<script>(function(){var B=" + JSON.stringify(selfBaseUrl) + ";var AD=" + JSON.stringify(AD_HOSTS) +
    ";function ad(u){try{var h=new URL(u,location.href).hostname.toLowerCase();return AD.some(function(d){return h===d||h.slice(-(d.length+1))==='.'+d;});}catch(e){return false;}}" +
    "function px(u){return B+'/proxy?url='+encodeURIComponent(new URL(u,location.href).href);}" +
    "var _f=window.fetch;window.fetch=function(i,o){try{var u=typeof i==='string'?i:(i&&i.url);if(u){if(ad(u))return Promise.resolve(new Response('',{status:204}));if(/^https?:/i.test(u)&&u.indexOf(B)!==0)return _f(px(u),o);}}catch(e){}return _f(i,o);};" +
    "var _o=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){try{if(u){if(ad(u)){return _o.call(this,m,'about:blank');}if(/^https?:/i.test(u)&&u.indexOf(B)!==0)u=px(u);}}catch(e){}return _o.call(this,m,u);};})();<\/script>";
  const withBase = html.replace(/<head([^>]*)>/i, '<head$1><base href="' + baseUrl + '">' + shim);
  return withBase === html ? (shim + html) : withBase;
}

function embedErrorPage(title, detail){
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<body style="margin:0;background:#0b0b10;color:#fff;font:600 14px/1.5 system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center">' +
    '<div style="max-width:320px;padding:20px"><div style="font:800 11px monospace;letter-spacing:2px;color:#fb7185;margin-bottom:8px">YRcine relay</div>' +
    '<div style="font:800 15px system-ui;margin-bottom:6px">' + title + '</div>' +
    '<div style="color:rgba(255,255,255,.55);font-size:12px">' + detail + '</div></div></body>';
}

async function handleProxy(request, url){
  const target = url.searchParams.get("url");
  if (!target) return json({ ok:false, error:"url required" }, 400);
  const h = hostOf(target);
  if (isAdHost(h)) return new Response(null, { status: 204, headers: cors() });
  if (!isAllowed(h)) return json({ ok:false, error:"host not allowed", host:h }, 403);
  const headers = { "user-agent": request.headers.get("user-agent") || UA, "accept": request.headers.get("accept") || "*/*", "accept-encoding": "identity" };
  const init = { method: request.method, headers: headers, redirect: "follow" };
  if (request.method !== "GET" && request.method !== "HEAD"){
    const buf = await request.arrayBuffer();
    if (buf.byteLength){ init.body = buf; const ct = request.headers.get("content-type"); if (ct) headers["content-type"] = ct; }
  }
  try {
    const up = await fetchT(target, init);
    const ctype = up.headers.get("content-type") || "";
    if (/mpegurl|vnd\.apple/i.test(ctype) || /\.m3u8($|\?)/i.test(target)){
      const text = await up.text();
      return new Response(rewriteM3u8(text, target, selfBase(url)), { headers: cors({ "content-type":"application/vnd.apple.mpegurl" }) });
    }
    const oh = cors();
    ["content-type","content-range","accept-ranges","cache-control"].forEach(function(k){ const v = up.headers.get(k); if (v) oh[k] = v; });
    return new Response(up.body, { status: up.status, headers: oh });
  } catch(e){ return json({ ok:false, error:"upstream failed", detail:String(e).slice(0,160) }, 502); }
}

async function handleEmbed(request, url){
  const target = url.searchParams.get("url");
  const sendErr = function(code, title, detail){ return new Response(embedErrorPage(title, detail), { status: code, headers: cors({ "content-type":"text/html; charset=utf-8", "content-security-policy":"frame-ancestors *" }) }); };
  if (!target) return sendErr(400, "No source URL", "The player was opened without a source.");
  const h = hostOf(target);
  if (!isAllowed(h)) return sendErr(403, "Source not allowed", "This host is not in the relay allowlist.");
  try {
    const up = await fetchT(target, { headers: { "user-agent": UA, "accept":"text/html,application/xhtml+xml,*/*;q=0.8", "accept-language":"en-IN,en;q=0.9" }, redirect:"follow" });
    if (!up.ok) return sendErr(502, "Source returned " + up.status, "The provider refused the relay request. Try the Direct route or another source.");
    const html = await up.text();
    if (!/<!doctype|<html|<head|<body/i.test(html)) return sendErr(502, "Unexpected response", "The provider did not return a playable page.");
    return new Response(rewriteHtml(html, target, selfBase(url)), { headers: cors({ "content-type":"text/html; charset=utf-8", "content-security-policy":"frame-ancestors *" }) });
  } catch(e){ return sendErr(502, "Source did not respond", "The provider timed out through the relay. Try the Direct route or another source."); }
}

async function handleCatalog(url){
  const path = String(url.searchParams.get("path") || "").replace(/^\/+/, "");
  if (!path) return json({ ok:false, error:"path required" }, 400);
  const qs = new URLSearchParams();
  url.searchParams.forEach(function(v, k){ if (k !== "path" && k !== "k") qs.set(k, v); });
  qs.set("api_key", TMDB_API_KEY);
  try {
    const r = await fetchT("https://api.themoviedb.org/3/" + path + "?" + qs.toString(), {});
    const body = await r.text();
    return new Response(body, { status: r.status, headers: cors({ "content-type":"application/json; charset=utf-8", "cache-control": (r.status >= 200 && r.status < 300) ? "public, max-age=120" : "no-store" }) });
  } catch(e){ return json({ ok:false, error:"tmdb failed", detail:String(e).slice(0,160) }, 502); }
}

async function handleImage(url){
  const target = url.searchParams.get("url");
  if (!target) return json({ ok:false, error:"url required" }, 400);
  const tries = [target, "https://wsrv.nl/?url=" + encodeURIComponent(target)];
  for (let i = 0; i < tries.length; i++){
    try {
      const r = await fetchT(tries[i], { headers: { "user-agent":"Mozilla/5.0", "accept":"image/*" } });
      if (!r.ok) continue;
      return new Response(r.body, { headers: cors({ "content-type": r.headers.get("content-type") || "image/jpeg", "cache-control":"public, max-age=86400" }) });
    } catch(e){}
  }
  return json({ ok:false, error:"image unreachable" }, 502);
}

async function forward(request, url){
  try {
    const init = { method: request.method, headers: { "accept": request.headers.get("accept") || "*/*" }, redirect: "follow" };
    if (request.method !== "GET" && request.method !== "HEAD"){
      const buf = await request.arrayBuffer(); if (buf.byteLength) init.body = buf;
      const ct = request.headers.get("content-type"); if (ct) init.headers["content-type"] = ct;
    }
    const up = await fetchT(ORIGIN + url.pathname + url.search, init);
    const oh = cors();
    ["content-type","cache-control"].forEach(function(k){ const v = up.headers.get(k); if (v) oh[k] = v; });
    return new Response(up.body, { status: up.status, headers: oh });
  } catch(e){ return json({ ok:false, error:"origin unreachable" }, 502); }
}

export default {
  async fetch(request, env, ctx){
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    const p = url.pathname;
    if (p === "/api/health") return json({ ok:true, relay:"yrcine-worker", hosts: ALLOW_HOSTS.length, ads: AD_HOSTS.length, ts: Date.now() });
    if (p === "/api/proxy" || p === "/api/proxy/image") return handleProxy(request, url);
    if (p === "/api/embed") return handleEmbed(request, url);
    if (p === "/api/catalog") return handleCatalog(url);
    if (p === "/api/image") return handleImage(url);
    return forward(request, url);
  }
};
