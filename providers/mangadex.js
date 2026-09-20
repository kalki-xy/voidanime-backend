// MangaDex provider — official public API (api.mangadex.org)
const axios = require('axios');
const API = 'https://api.mangadex.org';
const UA = { 'User-Agent': 'VoidAnime-Backend/1.0 (manga reader)' };

function titleOf(t){ return (t && (t.en || Object.values(t).find(Boolean))) || 'Untitled'; }
function descOf(d){ const s = d && (d.en || Object.values(d).find(Boolean)); return s ? String(s).replace(/<[^>]*>/g, '').slice(0, 400) : ''; }
function coverOf(m){
  const rel = (m.relationships || []).find(r => r.type === 'cover_art');
  const fn = rel && rel.attributes && rel.attributes.fileName;
  return fn ? `https://uploads.mangadex.org/covers/${m.id}/${fn}` : null;
}

async function search(q){
  const r = await axios.get(`${API}/manga`, {
    params: { title: q, limit: 24, 'includes[]': 'cover_art' },
    headers: UA, timeout: 15000
  });
  return r.data.data.map(m => ({
    id: m.id,
    title: titleOf(m.attributes.title),
    coverUrl: coverOf(m),
    description: descOf(m.attributes.description)
  }));
}

async function chapterList(id){
  const r = await axios.get(`${API}/manga/${id}/feed`, {
    params: { limit: 500, 'translatedLanguage[]': 'en', 'order[chapter]': 'asc' },
    headers: UA, timeout: 20000
  });
  return r.data.data.map(c => ({
    id: c.id,
    number: c.attributes.chapter || null,
    title: c.attributes.title || '',
    date: c.attributes.publishAt || null
  }));
}

async function getInfo(id){
  const [mr, chapters] = await Promise.all([
    axios.get(`${API}/manga/${id}`, { params: { 'includes[]': 'cover_art' }, headers: UA, timeout: 15000 }),
    chapterList(id)
  ]);
  const m = mr.data.data;
  return {
    id: m.id,
    title: titleOf(m.attributes.title),
    description: descOf(m.attributes.description),
    coverUrl: coverOf(m),
    status: m.attributes.status || null,
    chapters
  };
}

function getChapters(id){ return chapterList(id); }

async function getPages(chapterId){
  const r = await axios.get(`${API}/at-home/server/${chapterId}`, { headers: UA, timeout: 20000 });
  const d = r.data || {};
  const base = d.baseUrl;
  const ch = d.chapter || {};
  const files = ch.data && ch.data.length ? ch.data : (ch.dataSaver || []);
  return files.map(p => `${base}/data/${ch.hash}/${p}`);
}

async function getPagesByNumber(id, chapterNumber, chapterId){
  if (chapterId) return getPages(chapterId);
  if (chapterNumber == null) throw new Error('chapterId or chapterNumber required');
  const chapters = await chapterList(id);
  const target = String(chapterNumber);
  const ch = chapters.find(c => String(c.number) === target);
  if (!ch) throw new Error('chapter not found: ' + target);
  return getPages(ch.id);
}

module.exports = { search, getInfo, getChapters, getPages, getPagesByNumber };
