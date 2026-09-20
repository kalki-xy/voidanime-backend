// WeebCentral provider — HTML scraper (tolerant selectors, like the MangaPill one)
// series id: the ULID in /series/<id>/... ; chapter id: ULID in /chapters/<id>
const axios = require('axios');
const cheerio = require('cheerio');
const BASE = 'https://weebcentral.com';
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en'
};

async function search(q, opts){
  const r = await axios.get(`${BASE}/search`, { params: { q: q || '' }, headers: H, timeout: 25000 });
  const $ = cheerio.load(r.data);
  const seen = {}; const out = [];
  $('a[href*="/series/"]').each((i, el) => {
    const a = $(el);
    const href = a.attr('href') || '';
    const m = href.match(/\/series\/([A-Za-z0-9]+)/);
    if (!m || seen[m[1]]) return;
    const t = a.text().replace(/\s+/g, ' ').trim();
    if (!t || t.length < 2) return;
    seen[m[1]] = 1;
    const img = a.find('img').first();
    let cov = img.attr('data-src') || img.attr('src') || '';
    if (cov && cov.indexOf('//') === 0) cov = 'https:' + cov;
    out.push({ id: m[1], title: t, coverUrl: /^https?:\/\//.test(cov) ? cov : null, description: '' });
  });
  return out.slice(0, 24);
}

async function chapterList(id){
  const r = await axios.get(`${BASE}/series/${encodeURIComponent(id)}/full-chapter-list`, { headers: H, timeout: 30000 });
  const $ = cheerio.load(r.data);
  const out = [];
  const seen = {};
  $('a[href*="/chapters/"]').each((i, el) => {
    const a = $(el);
    const href = a.attr('href') || '';
    const m = href.match(/\/chapters\/([A-Za-z0-9]+)/);
    if (!m || seen[m[1]]) return;
    seen[m[1]] = 1;
    const t = a.text().replace(/\s+/g, ' ').trim();
    const num = (t.match(/Ch\.?\s*([\d.]+)/i) || [])[1] || ('' + (out.length + 1));
    const title = t.replace(/^Ch\.?\s*[\d.]+\s*-?\s*/, '').trim();
    out.push({ id: m[1], number: num, title: title || '', date: null });
  });
  return out.reverse(); // newest-first on the page -> oldest-first
}

async function getInfo(id){
  const [ir, chapters] = await Promise.all([
    axios.get(`${BASE}/series/${encodeURIComponent(id)}`, { headers: H, timeout: 25000 }),
    chapterList(id)
  ]);
  const $ = cheerio.load(ir.data);
  const title = ($('meta[property="og:title"]').attr('content') || $('title').text() || '').replace(/\s*[-|]\s*WeebCentral.*$/i, '').trim();
  const cov = $('meta[property="og:image"]').attr('content') || null;
  let desc = '';
  const dl = $('article p, section p, .prose p').first().text();
  if (dl) desc = dl.replace(/\s+/g, ' ').trim().slice(0, 400);
  return { id, title: title || 'Untitled', description: desc, coverUrl: cov, status: null, chapters };
}

async function getChapters(id){ return chapterList(id); }

async function getPages(chapterId){
  const r = await axios.get(`${BASE}/chapters/${encodeURIComponent(chapterId)}`, { headers: H, timeout: 30000 });
  const $ = cheerio.load(r.data);
  const out = [];
  $('img').each((i, el) => {
    const im = $(el);
    let src = im.attr('data-src') || im.attr('src') || '';
    if (!/^https?:\/\//.test(src)) return;
    if (/logo|icon|avatar|banner|favicon|\.svg($|\?)/i.test(src)) return;
    out.push(src);
  });
  if (!out.length) throw new Error('no page images found for chapter ' + chapterId);
  return out;
}

async function getPagesByNumber(id, chapterNumber, chapterId){
  if (chapterId) return getPages(chapterId);
  const chapters = await chapterList(id);
  const target = String(chapterNumber);
  const ch = chapters.find(c => c.number === target);
  if (!ch) throw new Error('chapter not found: ' + target);
  return getPages(ch.id);
}

module.exports = { search, getInfo, getChapters, getPages, getPagesByNumber };
