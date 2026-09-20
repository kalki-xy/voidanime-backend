// MangaPill provider — HTML scraper (mangapill.com)
// NOTE: MangaPill removed all manhwa from the site — this provider serves manga only.
const axios = require('axios');
const cheerio = require('cheerio');
const BASE = 'https://mangapill.com';
const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9'
};

async function get(url){
  const r = await axios.get(url, { headers: UA, timeout: 20000 });
  return cheerio.load(r.data);
}

function absImg(src){
  if(!src) return null;
  if(src.startsWith('//')) return 'https:' + src;
  if(src.startsWith('/')) return BASE + src;
  return src;
}

async function search(q){
  const $ = await get(BASE + '/search?q=' + encodeURIComponent(String(q || '')));
  const out = [];
  const seen = {};
  $('a[href^="/manga/"]').each((i, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/^\/manga\/(\d+)(?:\/([^/?#]+))?/);
    if(!m || seen[m[1]]) return;
    seen[m[1]] = 1;
    const $el = $(el);
    const img = $el.find('img').first();
    let title = ($el.attr('title') || '').trim();
    if(!title && img.length) title = (img.attr('alt') || '').trim();
    if(!title) title = $el.text().replace(/\s+/g, ' ').split('  ')[0].trim();
    title = title.replace(/\s+/g, ' ').trim();
    const half = title.length / 2;
    if(half % 1 === 0 && half > 3 && title.slice(0, half) === title.slice(half)) title = title.slice(0, half).trim();
    const cover = absImg(img.attr('data-src') || img.attr('data-original') || img.attr('src'));
    out.push({ id: m[2] ? m[1] + '/' + m[2] : m[1], title: title || ('Manga ' + m[1]), coverUrl: cover });
  });
  return out.slice(0, 24);
}

async function getInfo(id){
  const key = String(id);
  const path = key.indexOf(BASE) === 0 ? key : BASE + '/manga/' + key.replace(/^\/+/, '');
  const $ = await get(path);
  const title = ($('h1').first().text() || '').trim();
  let cover = null;
  $('img').each((i, el) => {
    if(cover) return;
    const s = absImg($(el).attr('data-src') || $(el).attr('src'));
    if(s && /mangapill/i.test(s)) cover = s;
  });
  const description = ($('meta[name="description"]').attr('content') || $('h1').first().parent().find('p').first().text() || '').trim().replace(/\s+/g, ' ').slice(0, 400);
  const chapters = [];
  const seen = {};
  $('a[href^="/chapters/"]').each((i, el) => {
    const $el = $(el);
    const href = $el.attr('href') || '';
    const m = href.match(/^\/chapters\/([^/?#]+)/);
    if(!m || seen[m[1]]) return;
    seen[m[1]] = 1;
    const text = $el.text().replace(/\s+/g, ' ').trim();
    const n = text.match(/chapter\s*([\d.]+)/i);
    chapters.push({ id: m[1], number: n ? n[1] : null, title: text.slice(0, 80), date: null });
  });
  chapters.reverse();
  return { id: key, title, description, coverUrl: cover, status: null, chapters };
}

async function getChapters(id){
  const info = await getInfo(id);
  return info.chapters;
}

async function getPages(chapterId){
  const url = BASE + '/chapters/' + String(chapterId).replace(/^\/+/, '');
  const $ = await get(url);
  const pages = [];
  $('img').each((i, el) => {
    const s = absImg($(el).attr('data-src') || $(el).attr('src'));
    if(s && /mangapill/i.test(s)) pages.push(s);
  });
  if (pages.length) return pages;
  // fallback: scan the RAW html for image URLs (lazy-loaded / JS-embedded readers)
  const raw = $.html() || '';
  const re = /https?:\/\/[^"'\s\\)]+?\.(?:webp|jpe?g|png)(?:\?[^"'\s\\)]*)?/gi;
  const seen = {};
  let m;
  while ((m = re.exec(raw))){
    const u = m[0];
    if (/logo|icon|favicon|avatar|banner|\/i\/\d+\.webp/i.test(u)) continue; // covers/logo
    if (seen[u]) continue;
    seen[u] = 1;
    pages.push(u);
  }
  if (!pages.length){
    const sample = (raw.match(/https?:\/\/[^"'\s\\)]{10,90}/g) || []).slice(0, 6).join(' | ');
    throw new Error('MPpages-debug no imgs; urls: ' + sample);
  }
  return pages;
}

async function getPagesByNumber(id, chapterNumber, chapterId){
  if(chapterId) return getPages(chapterId);
  const chapters = await getChapters(id);
  const target = String(chapterNumber);
  const ch = chapters.find(c => String(c.number) === target);
  if(!ch) throw new Error('chapter not found: ' + target);
  return getPages(ch.id);
}

module.exports = { search, getInfo, getChapters, getPages, getPagesByNumber };
