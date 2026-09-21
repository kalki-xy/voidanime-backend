// animesalt.js — Hindi / Tamil / Telugu dubbed anime + movies provider
// Scrapes the AnimeSalt network (animesalttv.to primary). The site family
// serves Indian-language dubs. Episode pages expose a custom WP-REST player
// (wp-json/animesalt/v1/zplay?id=...) that embeds a megaplay player whose
// page carries a direct `var SRC = ...m3u8` we extract for native playback.
const axios = require('axios');
const cheerio = require('cheerio');

const DOMAINS = ['animesalttv.to', 'animesalt.me', 'animesalt.ro'];
let GOOD = null;

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

async function get(path){
  const bases = (GOOD ? [GOOD] : []).concat(DOMAINS.filter(function(d){ return d !== GOOD; }));
  let lastErr = null;
  for (const d of bases) {
    try {
      const r = await axios.get('https://' + d + path, { headers: UA, timeout: 15000, maxRedirects: 5 });
      const body = typeof r.data === 'string' ? r.data : '';
      if (r.status === 200 && body.length > 2000) {
        GOOD = d;
        return cheerio.load(body);
      }
      lastErr = new Error('bad response from ' + d + ' status ' + r.status);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('all animesalt domains failed');
}

function unesc(s){
  return String(s || '').replace(/&#0?38;/g, '&').replace(/&/g, '&');
}

function slugFrom(href){
  const m = String(href || '').match(/\/(?:anime|movies)\/([^\/?#]+)/);
  return m ? m[1] : null;
}

// ---- search: GET /?s=query — collect /anime/ and /movies/ links ----
async function search(q){
  const $ = await get('/?s=' + encodeURIComponent(String(q || '')));
  const out = [];
  const seen = {};
  $('a[href*="/anime/"], a[href*="/movies/"]').each(function(i, el){
    if (out.length >= 24) return;
    const $el = $(el);
    const href = $el.attr('href') || '';
    const slug = slugFrom(href);
    if (!slug || slug.length < 2 || seen[slug]) return;
    seen[slug] = 1;
    const isMovie = href.indexOf('/movies/') >= 0;
    let title = ($el.attr('title') || '').trim();
    if (!title) {
      const img = $el.find('img').first();
      title = (img.attr('alt') || '').trim();
    }
    if (!title) {
      title = $el.text().replace(/\s+/g, ' ').trim();
    }
    const img = $el.find('img').first();
    const cover = img.attr('data-src') || img.attr('data-lazy-src') || img.attr('data-original') || img.attr('src') || '';
    out.push({
      id: slug,
      type: isMovie ? 'movie' : 'series',
      title: (title && title.length > 1) ? title : slug.replace(/-/g, ' '),
      slugTitle: slug.replace(/-/g, ' '),
      coverUrl: cover && cover.indexOf('data:image') < 0 ? cover : null
    });
  });
  return out;
}

function metaOf($, name){
  const m = $('meta[property="' + name + '"], meta[name="' + name + '"]');
  return (m.attr('content') || '').trim();
}

// ---- series info: GET /anime/slug/ ----
async function getInfo(id){
  const slug = String(id).replace(/^\/+/, '').replace(/\/+$/, '');
  const $ = await get('/anime/' + encodeURIComponent(slug) + '/');
  const title = ($('h1').first().text() || metaOf($, 'og:title') || slug.replace(/-/g, ' ')).replace(/\s+/g, ' ').trim();
  const cover = metaOf($, 'og:image') || null;
  const description = metaOf($, 'og:description') || ($('.description p, .sinopsis p, .wp-content p').first().text() || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  return { id: slug, title: title, coverUrl: cover, description: description };
}

// ---- episodes: GET /anime/slug/ — episode links follow /episode/slug-SxE/ ----
async function episodes(id, season){
  const slug = String(id).replace(/^\/+/, '').replace(/\/+$/, '');
  const want = parseInt(season, 10) || 1;
  const $ = await get('/anime/' + encodeURIComponent(slug) + '/');
  const eps = [];
  const seen = {};
  const seasons = {};
  $('a[href*="/episode/"]').each(function(i, el){
    const href = $(el).attr('href') || '';
    const m = href.match(/\/episode\/(.+?)-(\d+)x(\d+)/);
    if (!m) return;
    const s = parseInt(m[2], 10);
    const e = parseInt(m[3], 10);
    if (!s || !e || seen[s + 'x' + e]) return;
    seen[s + 'x' + e] = 1;
    seasons[s] = 1;
    if (s === want) eps.push({ season: s, episode: e, title: m[1] + ' ' + s + 'x' + e });
  });
  eps.sort(function(a, b){ return a.episode - b.episode; });
  return { seasons: Object.keys(seasons).map(Number).sort(function(a, b){ return a - b; }), episodes: eps };
}

// ---- streams: episode page -> zplay player -> megaplay embed -> direct HLS m3u8 ----
async function streams(id, season, ep){
  const slug = String(id).replace(/^\/+/, '').replace(/\/+$/, '');
  const sn = parseInt(season, 10) || 1;
  const en = parseInt(ep, 10) || 1;
  const $ = await get('/episode/' + encodeURIComponent(slug) + '-' + sn + 'x' + en + '/');
  let zurl = '';
  $('iframe').each(function(i, el){
    if (zurl) return;
    let src = $(el).attr('src') || $(el).attr('data-src') || '';
    if (!src) return;
    src = unesc(src);
    if (src.indexOf('http') !== 0 && src.indexOf('/') === 0 && GOOD) src = 'https://' + GOOD + src;
    if (src && src.indexOf('recaptcha') < 0) zurl = src;
  });
  const out = [];
  async function fetchPage(url){
    try {
      const r = await axios.get(url, { headers: Object.assign({}, UA, { Referer: 'https://' + (GOOD || 'animesalttv.to') + '/' }), timeout: 15000, maxRedirects: 5, validateStatus: null });
      return typeof r.data === 'string' ? r.data : '';
    } catch (e) { return ''; }
  }
  if (zurl) {
    const b = await fetchPage(zurl);
    const srcM = b.match(/SRC\s*=\s*"([^"]+\.m3u8[^"]*)"/);
    const emM = b.match(/https?:\/\/[a-zA-Z0-9.-]*megaplay[a-zA-Z0-9.-]*\/e\/[a-zA-Z0-9]+/);
    if (srcM) {
      const pM = b.match(/POSTER\s*=\s*"([^"]+)"/);
      out.push({ server: 'Hindi HLS', link: srcM[1], type: 'hls', poster: pM ? pM[1] : null });
    }
    if (emM) {
      const b2 = await fetchPage(emM[0]);
      const s2 = b2.match(/SRC\s*=\s*"([^"]+\.m3u8[^"]*)"/);
      if (s2) {
        const p2 = b2.match(/POSTER\s*=\s*"([^"]+)"/);
        out.push({ server: 'Hindi HLS 2', link: s2[1], type: 'hls', poster: p2 ? p2[1] : null });
      }
      out.push({ server: 'Player', link: emM[0], type: 'embed' });
    }
    if (!out.length) out.push({ server: 'AnimeSalt 1', link: zurl, type: 'embed' });
  }
  return out;
}

// ---- movie: GET /movies/slug/ (fallback /slug/) - iframes -> direct HLS ----
function trimSlash(s){
  var p = String(s || '');
  while (p.charAt(0) === '/') p = p.slice(1);
  while (p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
  return p;
}
function pickSrc(body){
  if (!body) return null;
  var BS = String.fromCharCode(92);
  var at = body.indexOf('SRC=');
  while (at >= 0) {
    var q1 = body.indexOf('"', at + 4);
    var q2 = q1 >= 0 ? body.indexOf('"', q1 + 1) : -1;
    if (q1 >= 0 && q2 > q1) {
      var u = body.substring(q1 + 1, q2).split(BS).join('');
      if (u.indexOf('.m3u8') >= 0 || u.indexOf('zhls') >= 0) return u;
    }
    at = body.indexOf('SRC=', at + 4);
  }
  return null;
}
function playlistLanguages(body){
  var out = [];
  if (!body) return out;
  var li = 0;
  while (li < body.length) {
    var k = body.indexOf('LANGUAGE="', li);
    if (k < 0) break;
    var e2 = body.indexOf('"', k + 10);
    if (e2 > k) {
      var code = body.substring(k + 10, e2);
      if (code && out.indexOf(code) < 0) out.push(code);
    }
    li = k + 10;
  }
  return out;
}
function pickPoster(body){
  if (!body) return null;
  var at = body.indexOf('POSTER=');
  if (at < 0) return null;
  var q1 = body.indexOf('"', at + 7);
  var q2 = q1 >= 0 ? body.indexOf('"', q1 + 1) : -1;
  return (q1 >= 0 && q2 > q1) ? body.substring(q1 + 1, q2) : null;
}
function pickMegaplay(body){
  if (!body) return null;
  var at = body.indexOf('megaplay');
  while (at >= 0) {
    var s = body.lastIndexOf('http', at);
    if (s >= 0 && at - s < 200) {
      var e = at;
      while (e < body.length && body.charAt(e) !== '"' && body.charAt(e) !== "'" && body.charAt(e) !== '<' && body.charAt(e) !== ' ') e++;
      var u = body.substring(s, e);
      if (u.indexOf('/e/') >= 0) return u;
    }
    at = body.indexOf('megaplay', at + 8);
  }
  return null;
}
async function fetchMv(url, referer){
  try {
    const r = await axios.get(url, { headers: Object.assign({}, UA, { Referer: referer || ('https://' + (GOOD || 'animesalttv.to') + '/') }), timeout: 15000, maxRedirects: 5, validateStatus: null });
    return typeof r.data === 'string' ? r.data : '';
  } catch (e) { return ''; }
}
async function movie(id){
  const slug = trimSlash(id);
  const paths = ['/movies/' + encodeURIComponent(slug) + '/', '/' + encodeURIComponent(slug) + '/'];
  let $ = null;
  let lastErr = null;
  for (const p of paths) {
    try { $ = await get(p); break; } catch (e) { lastErr = e; }
  }
  if (!$) throw lastErr || new Error('movie page not found');
  const title = ($('h1').first().text() || metaOf($, 'og:title') || slug.replace(/-/g, ' ')).replace(/\s+/g, ' ').trim();
  const out = [];
  const seen = {};
  const frames = [];
  $('iframe').each(function(i, el){
    let src = $(el).attr('src') || $(el).attr('data-src') || '';
    if (!src) return;
    src = unesc(src);
    if (src.indexOf('http') !== 0 && src.indexOf('/') === 0 && GOOD) src = 'https://' + GOOD + src;
    if (!src || seen[src] || src.indexOf('recaptcha') >= 0) return;
    seen[src] = 1;
    frames.push(src);
  });
  for (const f of frames) {
    if (out.length >= 4) break;
    const b = await fetchMv(f, 'https://' + (GOOD || 'animesalttv.to') + '/');
    const direct = pickSrc(b);
    if (direct) {
      var langs = [];
      if (direct.indexOf('zhls') >= 0) {
        var pl = await fetchMv(direct, f);
        langs = playlistLanguages(pl);
      }
      out.push({ server: 'Hindi HLS', link: direct, type: 'hls', poster: pickPoster(b), languages: langs });
      const em = pickMegaplay(b);
      if (em) {
        const b2 = await fetchMv(em, f);
        const d2 = pickSrc(b2);
        if (d2 && d2 !== direct) out.push({ server: 'Hindi HLS 2', link: d2, type: 'hls', poster: pickPoster(b2) });
      }
    } else if (f.indexOf('.m3u8') >= 0) {
      out.push({ server: 'Hindi HLS', link: f, type: 'hls' });
    } else if (f.indexOf('/video/') >= 0 || f.slice(-4) === '.mp4') {
      out.push({ server: 'Hindi MP4', link: f, type: 'mp4' });
    } else {
      out.push({ server: 'AnimeSalt ' + (out.length + 1), link: f, type: 'embed' });
    }
  }
  var allLangs = [];
  for (const s of out) {
    for (const lg of (s.languages || [])) { if (allLangs.indexOf(lg) < 0) allLangs.push(lg); }
  }
  return { id: slug, title: title, languages: allLangs, stream: out };
}

module.exports = { search, getInfo, episodes, streams, movie };
