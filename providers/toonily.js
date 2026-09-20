// Toonily provider - Madara WordPress scraper via cheerio (same style as mangapill.js)
// Coverage: full Korean manhwa library (the gap MangaDex licensing leaves)
const axios = require('axios');
const cheerio = require('cheerio');
const BASE = 'https://toonily.com';
const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://toonily.com/'
};

async function get(url){
  const r = await axios.get(url, { headers: UA, timeout: 20000 });
  return cheerio.load(r.data);
}

function absImg(src){
  if(!src) return null;
  src = String(src).split(' ')[0];
  if(src.startsWith('//')) return 'https:' + src;
  if(src.startsWith('/')) return BASE + src;
  return src;
}

async function search(q){
  const $ = await get(BASE + '/?s=' + encodeURIComponent(String(q || '')) + '&post_type=wp-manga');
  const out = [];
  const seen = {};
  $('div.page-item-detail, div.c-tabs-item__content').each((i, el) => {
    const $el = $(el);
    const a = $el.find('h3 a').first();
    const href = a.attr('href') || '';
    if(!href || href.indexOf('/webtoon/') < 0) return;
    const slug = href.replace(/\/+$/, '').split('/').pop();
    if(!slug || seen[slug]) return;
    seen[slug] = 1;
    const img = $el.find('img').first();
    let title = (a.attr('title') || a.text() || '').replace(/\s+/g, ' ').trim();
    if(!title && img.length) title = (img.attr('alt') || '').replace(/\s+/g, ' ').trim();
    out.push({ id: slug, title: title || slug, alt: [], coverUrl: absImg(img.attr('data-src') || img.attr('src')) });
  });
  return out.slice(0, 24);
}

function parseChapters($){
  const chapters = [];
  const seen = {};
  $('li.wp-manga-chapter a').each((i, el) => {
    const $el = $(el);
    const href = $el.attr('href') || '';
    if(!href || (href.indexOf('/webtoon/') < 0 && href.indexOf('/manga/') < 0)) return;
    if(seen[href]) return;
    seen[href] = 1;
    const text = $el.text().replace(/\s+/g, ' ').trim();
    let n = text.match(/(?:chapter|episode)\s*([\d.]+)/i);
    if(!n) n = href.match(/chapter-?([\d.]+)/i);
    const rel = href.indexOf(BASE) === 0 ? href.slice(BASE.length) : href;
    chapters.push({ id: rel.replace(/^\/+/, ''), number: n ? n[1] : null, title: text.slice(0, 80), date: null });
  });
  return chapters;
}

async function chapterList(slug){
  const url = BASE + '/webtoon/' + String(slug).replace(/^\/+|\/+$/g, '') + '/';
  let $ = await get(url);
  let chapters = parseChapters($);
  if(chapters.length < 20){
    // newer Madara builds lazy-load the TOC, full list via the ajax endpoint
    try{
      const r = await axios.post(url + 'ajax/chapters/', '', { headers: Object.assign({ 'X-Requested-With': 'XMLHttpRequest' }, UA), timeout: 20000 });
      const more = parseChapters(cheerio.load(String(r.data || '')));
      if(more.length > chapters.length) chapters = more;
    }catch(e){ /* keep static list */ }
  }
  return chapters;
}

async function getInfo(id){
  const slug = String(id).replace(/^\/+|\/+$/g, '');
  const $ = await get(BASE + '/webtoon/' + slug + '/');
  const title = ($('div.post-title h1').first().text() || slug).replace(/\s+/g, ' ').trim();
  const img = $('div.summary_image img').first();
  const cover = absImg(img.attr('data-src') || img.attr('src'));
  const description = ($('div.summary__content').first().text() || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  const alt = [];
  $('div.post-content_item').each((i, el) => {
    const label = $(el).find('div.summary-heading').first().text().replace(/\s+/g, ' ').trim().toLowerCase();
    if(label === 'alternative' || label === 'alternative titles' || label === 'alt name(s)'){
      $(el).find('div.summary-content a').each((j, a) => {
        const t = $(a).text().replace(/\s+/g, ' ').trim();
        if(t && alt.indexOf(t) < 0) alt.push(t);
      });
    }
  });
  const chapters = await chapterList(slug);
  return { id: slug, title: title, description: description, coverUrl: cover, status: null, alt: alt, chapters: chapters };
}

async function getChapters(id){
  return chapterList(id);
}

async function getPages(chapterId){
  let p = String(chapterId);
  if(!/^https?:/i.test(p)) p = BASE + '/' + p.replace(/^\/+/, '');
  const $ = await get(p);
  const urls = [];
  const add = (u) => { const s = absImg(u); if(s && urls.indexOf(s) < 0) urls.push(s); };
  $('div.read-container img, div.reading-content img, img.wp-manga-chapter-img').each((i, el) => {
    add($(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('src'));
  });
  if(!urls.length){
    $('img').each((i, el) => {
      const s = absImg($(el).attr('data-src') || $(el).attr('src'));
      if(s && (s.indexOf('wp-content/uploads') >= 0 || s.indexOf('/uploads/') >= 0) && urls.indexOf(s) < 0) urls.push(s);
    });
  }
  if(!urls.length) throw new Error('no images found for ' + p);
  return urls;
}

async function getPagesByNumber(id, chapterNumber, chapterId){
  if(chapterId) return getPages(chapterId);
  if(chapterNumber == null) throw new Error('chapterId or chapterNumber required');
  const chapters = await chapterList(id);
  const target = String(chapterNumber);
  const matches = chapters.filter(c => String(c.number) === target);
  if(!matches.length) throw new Error('chapter not found: ' + target);
  return getPages(matches[0].id);
}

module.exports = { search, getInfo, getChapters, getPages, getPagesByNumber };
