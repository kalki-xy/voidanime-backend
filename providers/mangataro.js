// MangaTaro provider - pure JSON API (mangataro.org), full manhwa library
// Endpoints: /auth/search, /auth/manga-chapters (signed), /auth/chapter-content
const axios = require('axios');
const crypto = require('crypto');
const BASE = 'https://mangataro.org';
const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://mangataro.org/',
  'Origin': 'https://mangataro.org'
};

async function jget(url, params){
  const r = await axios.get(url, { headers: UA, params: params || {}, timeout: 20000 });
  return r.data;
}

function sig(){
  const ts = Math.floor(Date.now() / 1000);
  const d = new Date();
  const hour = '' + d.getUTCFullYear()
    + ('0' + (d.getUTCMonth() + 1)).slice(-2)
    + ('0' + d.getUTCDate()).slice(-2)
    + ('0' + d.getUTCHours()).slice(-2);
  const token = crypto.createHash('md5').update('' + ts + 'mng_ch_' + hour).digest('hex').slice(0, 16);
  return { _t: token, _ts: ts };
}

async function search(q){
  const data = await jget(BASE + '/auth/search', { q: String(q || '') });
  if(!data || !data.success) return [];
  const out = [];
  ((data.results || []).slice(0, 24)).forEach(function(item){
    if(!item || !item.slug) return;
    out.push({
      id: item.slug,
      title: item.title || item.slug,
      alt: (item.alt_titles || []).slice(),
      coverUrl: item.thumbnail || ''
    });
  });
  return out;
}

async function findBySlug(slug){
  const data = await jget(BASE + '/auth/search', { q: String(slug || '').replace(/-/g, ' ') });
  if(!data || !data.success) return null;
  const list = (data.results || []).filter(function(r){ return r && r.slug === slug; });
  return list.length ? list[0] : null;
}

async function chapterList(item){
  const s = sig();
  const data = await jget(BASE + '/auth/manga-chapters', {
    manga_id: item.id, offset: 0, limit: 5000, order: 'DESC', _t: s._t, _ts: s._ts
  });
  const chapters = ((data && data.chapters) || []).map(function(c){
    const t = c.title && c.title !== 'N/A' ? c.title : '';
    return { id: String(c.id), number: c.chapter != null ? String(c.chapter) : null, title: t, date: c.date || null };
  });
  chapters.reverse(); // API returns DESC, providers return ASC (mangadex/mangapill convention)
  return chapters;
}

async function getInfo(id){
  const slug = String(id).replace(/^\/+|\/+$/g, '');
  const item = await findBySlug(slug);
  if(!item) throw new Error('manga not found on mangataro: ' + slug);
  const chapters = await chapterList(item);
  return {
    id: slug,
    title: item.title || slug,
    description: (item.description || '').slice(0, 400),
    coverUrl: item.thumbnail || '',
    status: item.status || null,
    alt: (item.alt_titles || []).slice(),
    chapters: chapters
  };
}

async function getChapters(id){
  const slug = String(id).replace(/^\/+|\/+$/g, '');
  const item = await findBySlug(slug);
  if(!item) throw new Error('manga not found on mangataro: ' + slug);
  return chapterList(item);
}

async function getPages(chapterId){
  const data = await jget(BASE + '/auth/chapter-content', { chapter_id: String(chapterId) });
  if(!data || !data.success || !data.images || !data.images.length){
    throw new Error('no images for chapter ' + chapterId);
  }
  return data.images.map(String);
}

async function getPagesByNumber(id, chapterNumber, chapterId){
  if(chapterId) return getPages(chapterId);
  if(chapterNumber == null) throw new Error('chapterId or chapterNumber required');
  const slug = String(id).replace(/^\/+|\/+$/g, '');
  const item = await findBySlug(slug);
  if(!item) throw new Error('manga not found on mangataro: ' + slug);
  const chapters = await chapterList(item);
  const target = String(chapterNumber);
  const matches = chapters.filter(function(c){ return String(c.number) === target; });
  if(!matches.length) throw new Error('chapter not found: ' + target);
  return getPages(matches[0].id);
}

module.exports = { search, getInfo, getChapters, getPages, getPagesByNumber };
