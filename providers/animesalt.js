// animesalt.js — Hindi / Tamil / Telugu dubbed anime + movies provider
// Scrapes the AnimeSalt network (animesalttv.to primary). The site family
// serves Indian-language dubs. Episode pages expose a custom WP-REST player
// (wp-json/animesalt/v1/zplay?id=...) that is itself an embeddable iframe.
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

// ---- streams: GET /episode/slug-SxE/ — the page embeds a zplay player iframe ----
async function streams(id, season, ep){
  const slug = String(id).replace(/^\/+/, '').replace(/\/+$/, '');
  const sn = parseInt(season, 10) || 1;
  const en = parseInt(ep, 10) || 1;
  const $ = await get('/episode/' + encodeURIComponent(slug) + '-' + sn + 'x' + en + '/');
  const out = [];
  const seen = {};
  $('iframe').each(function(i, el){
    let src = $(el).attr('src') || $(el).attr('data-src') || '';
    if (!src) return;
    src = unesc(src);
    if (src.indexOf('http') !== 0 && src.indexOf('/') === 0 && GOOD) src = 'https://' + GOOD + src;
    if (!src || seen[src] || src.indexOf('recaptcha') >= 0 || src.indexOf('google') >= 0) return;
    seen[src] = 1;
    out.push({ server: 'AnimeSalt ' + (out.length + 1), link: src });
  });
  return out;
}

// ---- movie: GET /movies/slug/ (fallback /slug/) — player iframes ----
async function movie(id){
  const slug = String(id).replace(/^\/+/, '').replace(/\/+$/, '');
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
  $('iframe').each(function(i, el){
    let src = $(el).attr('src') || $(el).attr('data-src') || '';
    if (!src) return;
    src = unesc(src);
    if (src.indexOf('http') !== 0 && src.indexOf('/') === 0 && GOOD) src = 'https://' + GOOD + src;
    if (!src || seen[src] || src.indexOf('recaptcha') >= 0) return;
    seen[src] = 1;
    out.push({ server: 'AnimeSalt ' + (out.length + 1), link: src });
  });
  return { id: slug, title: title, languages: [], stream: out };
}

module.exports = { search, getInfo, episodes, streams, movie };
