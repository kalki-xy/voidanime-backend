// Manganato provider — HTML/JSON scraper (readmanganato.com / manganato.com)
// id format: 'manga-xxxx' ; chapter id format: 'manga-xxxx/chapter-y'
const axios = require('axios');
const cheerio = require('cheerio');
const BASE = 'https://manganato.com';
const READ = 'https://readmanganato.com';
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'en',
  'Referer': 'https://manganato.com/'
};

function stripHost(u){
  return String(u || '').replace(/^https?:\/\/[^/]+\//, '').replace(/\/+$/, '');
}

async function search(q, opts){
  if (q) {
    const r = await axios.post(`${READ}/getstorysearchjson`, 'searchword=' + encodeURIComponent(q), {
      headers: Object.assign({}, H, { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }),
      timeout: 20000
    });
    const list = Array.isArray(r.data) ? r.data : [];
    const out = [];
    const seen = {};
    list.forEach(x => {
      const id = stripHost(x.link_story);
      if (!id || seen[id]) return;
      seen[id] = 1;
      const name = cheerio.load('<div>' + (x.name || '') + '</div>')('div').text().replace(/\s+/g, ' ').trim();
      out.push({ id: id, title: name || 'Untitled', coverUrl: x.image || null, description: '' });
    });
    return out.slice(0, 24);
  }
  // browse: genre-all page
  const r = await axios.get(`${BASE}/genre-all`, { headers: H, timeout: 25000 });
  const $ = cheerio.load(r.data);
  const out = [];
  const seen = {};
  $('a[href*="/manga-"]').each((i, el) => {
    const a = $(el);
    const id = stripHost(a.attr('href'));
    if (!id || seen[id]) return;
    const t = a.attr('title') || a.text().replace(/\s+/g, ' ').trim();
    if (!t || t.length < 2) return;
    seen[id] = 1;
    const img = a.find('img').first();
    out.push({ id: id, title: t, coverUrl: (img.attr('src') || img.attr('data-src') || '').replace(/^\/\//, 'https://') || null, description: '' });
  });
  return out.slice(0, 24);
}

async function fetchMangaPage(id){
  return axios.get(`${READ}/${stripHost(id)}`, { headers: H, timeout: 30000 });
}

function parseChapters($){
  const out = [];
  const seen = {};
  $('.panel-story-chapter-list .row-content-chapter li a, .row-content-chapter li a').each((i, el) => {
    const a = $(el);
    const href = stripHost(a.attr('href'));
    if (!href || href.indexOf('chapter') < 0 || seen[href]) return;
    seen[href] = 1;
    const t = a.text().replace(/\s+/g, ' ').trim();
    const num = (t.match(/Chapter\s*([\d.]+)/i) || [])[1] || ('' + (out.length + 1));
    const title = t.replace(/^.*?Chapter\s*[\d.]+\s*:?\s*/, '').trim();
    out.push({ id: href, number: num, title: title || '', date: null });
  });
  return out.reverse(); // page is newest-first -> oldest-first
}

async function getInfo(id){
  const r = await fetchMangaPage(id);
  const $ = cheerio.load(r.data);
  const title = ($('.story-info-right h1').first().text() || $('title').text() || '').replace(/\s*[-|]\s*Manganato.*$/i, '').trim();
  const cov = $('.info-image img').first().attr('src') || null;
  let desc = $('#panel-story-info-description').text().replace(/Description\s*:?/i, '').replace(/\s+/g, ' ').trim();
  const chapters = parseChapters($);
  return { id: stripHost(id), title: title || 'Untitled', description: desc.slice(0, 400), coverUrl: cov, status: null, chapters };
}

async function getChapters(id){
  const r = await fetchMangaPage(id);
  return parseChapters(cheerio.load(r.data));
}

async function getPages(chapterId){
  const r = await axios.get(`${READ}/${stripHost(chapterId)}`, { headers: H, timeout: 30000 });
  const $ = cheerio.load(r.data);
  const out = [];
  $('.container-chapter-reader img').each((i, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || '';
    if (/^https?:\/\//.test(src)) out.push(src);
  });
  if (!out.length) throw new Error('no page images found for chapter ' + chapterId);
  return out;
}

async function getPagesByNumber(id, chapterNumber, chapterId){
  if (chapterId) return getPages(chapterId);
  if (chapterNumber == null) throw new Error('chapterId or chapterNumber required');
  const chapters = await getChapters(id);
  const target = String(chapterNumber);
  const ch = chapters.find(c => c.number === target);
  if (!ch) throw new Error('chapter not found: ' + target);
  return getPages(ch.id);
}

module.exports = { search, getInfo, getChapters, getPages, getPagesByNumber };
