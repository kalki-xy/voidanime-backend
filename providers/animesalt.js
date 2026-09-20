// animesalt.js — Hindi / Tamil / Telugu dubbed anime + movies provider
// Scrapes the AnimeSalt network, a Dooplay WordPress family of sites that
// hosts Indian-language dubs. Domains rotate often, so we try a list and
// cache the one that works. API surface mirrors the ZeroTwo-Py anime-api
// reference scraper (search / series / episodes / streams / movies).
const axios = require('axios');
const cheerio = require('cheerio');

const DOMAINS = [
  'animesalttv.to',
  'animesalt.ro',
  'animesalt.me',
  'animesalt.in',
  'animesalt.ac',
  'animesalt.to',
  'animesalt.link'
];
let GOOD = null;

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

function unesc(s){
  return String(s || '').replace(/&#0?38;/g, '&').replace(/&/g, '&');
}

async function get(path){
  const bases = (GOOD ? [GOOD] : []).concat(DOMAINS.filter(function(d){ return d !== GOOD; }));
  let lastErr = null;
  for (const d of bases) {
    try {
      const r = await axios.get('https://' + d + path, { headers: UA, timeout: 15000, maxRedirects: 5 });
      const body = typeof r.data === 'string' ? r.data : '';
      if (r.status === 200 && body.length > 400) {
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

function imgOf($, el){
  const img = $(el).find('img').first();
  if (!img.length) return null;
  let src = img.attr('data-src') || img.attr('data-lazy-src') || img.attr('data-original') || img.attr('src') || '';
  if (!src || src.indexOf('data:image') === 0) return null;
  if (src.indexOf('//') === 0) src = 'https:' + src;
  return src;
}

function slugFrom(href){
  const m = String(href || '').match(/\/(series|movies)\/([^\/?#]+)/);
  if (!m) return null;
  return { type: m[1] === 'movies' ? 'movie' : 'series', slug: m[2] };
}

// ---- search: GET /?s=query (Dooplay search) ----
async function search(q){
  const $ = await get('/?s=' + encodeURIComponent(String(q || '')));
  const out = [];
  const seen = {};
  $('#aa-movies li, .result-item').each(function(i, el){
    if (out.length >= 24) return;
    const $el = $(el);
    let title = ($el.find('h2.entry-title, h3.title').first().text() || $el.find('.title').first().text() || '').replace(/\s+/g, ' ').trim();
    if (!title) return;
    let href = $el.find('a.lnk-blk').attr('href') || $el.find('a[href*="/series/"]').first().attr('href') || $el.find('a[href*="/movies/"]').first().attr('href') || '';
    const info = slugFrom(href);
    if (!info || seen[info.slug]) return;
    seen[info.slug] = 1;
    out.push({ id: info.slug, type: info.type, title: title, coverUrl: imgOf($, el) });
  });
  return out;
}

// ---- series info: GET /series/slug/ ----
async function getInfo(id){
  const slug = String(id).replace(/^\/+/, '').replace(/\/+$/, '');
  const $ = await get('/series/' + encodeURIComponent(slug) + '/');
  const title = ($('.fg1 .entry-title, .entry-title, h1').first().text() || '').replace(/\s+/g, ' ').trim();
  let cover = null;
  const thumb = $('.post-thumbnail img, .dfxb img, .poster img').first();
  if (thumb.length) {
    let src = thumb.attr('data-src') || thumb.attr('data-original') || thumb.attr('src') || '';
    if (src) {
      if (src.indexOf('//') === 0) src = 'https:' + src;
      cover = src;
    }
  }
  const languages = [];
  $('.language-list a, .language a, .sgextra a[href*="language"]').each(function(i, el){
    const t = $(el).text().trim();
    if (t && languages.indexOf(t) < 0) languages.push(t);
  });
  const overview = ($('.description p').first().text() || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  return { id: slug, title: title, coverUrl: cover, languages: languages, description: overview };
}

// ---- episodes: GET /episode/slug-Sx1/ (lists the season episode grid) ----
async function episodes(id, season){
  const slug = String(id).replace(/^\/+/, '').replace(/\/+$/, '');
  const sn = parseInt(season, 10) || 1;
  const $ = await get('/episode/' + encodeURIComponent(slug) + '-' + sn + 'x1/');
  const eps = [];
  const seen = {};
  $('#episode_by_temp li').each(function(i, el){
    const numEpi = ($(el).find('.num-epi').text() || '').trim();
    const parts = numEpi.split('x');
    const s = parseInt(parts[0], 10) || sn;
    const e = parseInt(parts[1], 10);
    if (!e || seen[s + 'x' + e]) return;
    seen[s + 'x' + e] = 1;
    eps.push({ season: s, episode: e, title: ($(el).find('.entry-title').text() || '').replace(/\s+/g, ' ').trim() });
  });
  const seasons = [];
  $('.aa-cnt li a').each(function(i, el){
    const v = parseInt($(el).attr('data-season'), 10);
    if (v && seasons.indexOf(v) < 0) seasons.push(v);
  });
  eps.sort(function(a, b){ return a.episode - b.episode; });
  return { seasons: seasons, episodes: eps };
}

// ---- streams: GET /episode/slug-SxE/ (player iframes) ----
async function streams(id, season, ep){
  const slug = String(id).replace(/^\/+/, '').replace(/\/+$/, '');
  const sn = parseInt(season, 10) || 1;
  const en = parseInt(ep, 10) || 1;
  const $ = await get('/episode/' + encodeURIComponent(slug) + '-' + sn + 'x' + en + '/');
  const out = [];
  const seen = {};
  $('#aa-options > div.video').each(function(i, el){
    let src = $(el).find('iframe').attr('src') || $(el).find('iframe').attr('data-src') || '';
    if (!src) return;
    src = unesc(src);
    if (seen[src]) return;
    seen[src] = 1;
    out.push({ server: ($(el).attr('id') || 'server' + (out.length + 1)).toString(), link: src });
  });
  // fallback: any iframe inside the player area
  if (!out.length) {
    $('aside.video-player iframe, #aa-options iframe, .video iframe').each(function(i, el){
      let src = $(el).attr('src') || $(el).attr('data-src') || '';
      if (!src || seen[src]) return;
      src = unesc(src);
      seen[src] = 1;
      out.push({ server: 'server' + (out.length + 1), link: src });
    });
  }
  return out;
}

// ---- movie: GET /movies/slug/ (movie page with player iframes) ----
async function movie(id){
  const slug = String(id).replace(/^\/+/, '').replace(/\/+$/, '');
  let $ = null;
  const paths = ['/movies/' + encodeURIComponent(slug) + '/', '/movies/' + encodeURIComponent(slug), '/' + encodeURIComponent(slug) + '/', '/' + encodeURIComponent(slug)];
  let lastErr = null;
  for (const p of paths) {
    try { $ = await get(p); break; } catch (e) { lastErr = e; }
  }
  if (!$) throw lastErr || new Error('movie page not found');
  const title = ($('.fg1 .entry-title, .entry-title, h1').first().text() || $('meta[property="og:title"]').attr('content') || '').replace(/\s+/g, ' ').trim();
  const languages = [];
  $('.language-list a, .language a').each(function(i, el){
    const t = $(el).text().trim();
    if (t && languages.indexOf(t) < 0) languages.push(t);
  });
  const out = [];
  const seen = {};
  $('aside.video-player iframe, #aa-options > div.video iframe, .video iframe').each(function(i, el){
    let src = $(el).attr('src') || $(el).attr('data-src') || '';
    if (!src || seen[src]) return;
    src = unesc(src);
    seen[src] = 1;
    out.push({ server: 'server' + (out.length + 1), link: src });
  });
  return { id: slug, title: title, languages: languages, stream: out };
}

module.exports = { search, getInfo, episodes, streams, movie };
