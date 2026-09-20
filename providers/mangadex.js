// MangaDex provider — official public API (api.mangadex.org)
const axios = require('axios');
const API = 'https://api.mangadex.org';
const UA = { 'User-Agent': 'VoidAnime-Backend/1.0 (manga reader)' };

function titleOf(t){ return (t && (t.en || Object.values(t).find(Boolean))) || 'Untitled'; }
function dispTitle(m){
  const t = (m.attributes && m.attributes.title) || {};
  const alts = (m.attributes && m.attributes.altTitles) || [];
  const altEn = (alts.find(a => a.en) || {}).en;
  if (t.en) return t.en;
  if (altEn) return altEn; // many manhwa/manhua list a romaji primary title but carry the EN title in altTitles
  return titleOf(t);
}
function altsOf(m){
  const out = [];
  const push = v => { if (v && out.indexOf(v) < 0) out.push(v); };
  Object.values((m.attributes && m.attributes.title) || {}).forEach(push);
  ((m.attributes && m.attributes.altTitles) || []).forEach(a => Object.values(a).forEach(push));
  return out;
}
function descOf(d){ const s = d && (d.en || Object.values(d).find(Boolean)); return s ? String(s).replace(/<[^>]*>/g, '').slice(0, 400) : ''; }
function coverOf(m){
  const rel = (m.relationships || []).find(r => r.type === 'cover_art');
  const fn = rel && rel.attributes && rel.attributes.fileName;
  return fn ? `https://uploads.mangadex.org/covers/${m.id}/${fn}` : null;
}

async function search(q, opts){
  opts = opts || {};
  const ratings = opts.adult ? ['safe','suggestive','erotica','pornographic'] : ['safe','suggestive'];
  const qs = new URLSearchParams();
  qs.set('limit', '24');
  qs.append('includes[]', 'cover_art');
  if (q) qs.set('title', String(q));
  else { qs.set('order[followedCount]', 'desc'); qs.set('hasAvailableChapters', 'true'); }
  if (opts.origin) qs.set('originalLanguage[]', String(opts.origin));
  ratings.forEach(r => qs.append('contentRating[]', r));
  const r = await axios.get(`${API}/manga?${qs.toString()}`, { headers: UA, timeout: 15000 });
  return r.data.data.map(m => ({
    id: m.id,
    title: dispTitle(m),
    alt: altsOf(m),
    coverUrl: coverOf(m),
    description: descOf(m.attributes.description)
  }));
}

async function chapterList(id){
  // FULL list: paginate the feed until exhausted (500 per page, hard cap 5000)
  const out = [];
  const seenNum = {};
  let offset = 0;
  while (true){
    const r = await axios.get(`${API}/manga/${id}/feed`, {
      params: { limit: 500, offset, 'translatedLanguage[]': 'en', 'order[chapter]': 'asc', includeExternalUrl: '0' },
      headers: UA, timeout: 25000
    });
    const batch = r.data.data || [];
    batch.forEach(c => {
      if (c.attributes && c.attributes.isUnavailable === true) return; // bugged/unreadable entries
      const num = c.attributes.chapter || null;
      if (num != null && seenNum['n' + num]) return; // multiple groups per number -> keep first
      seenNum['n' + num] = 1;
      out.push({
        id: c.id,
        number: num,
        title: c.attributes.title || '',
        date: c.attributes.publishAt || null
      });
    });
    if (batch.length < 500 || out.length >= 5000) break;
    offset += 500;
  }
  return out;
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
  const matches = chapters.filter(c => String(c.number) === target);
  if (!matches.length) throw new Error('chapter not found: ' + target);
  let err = null;
  for (const ch of matches){ // an entry may 404 (unavailable) -> try the next group's copy
    try { return await getPages(ch.id); }
    catch (e) { err = e; }
  }
  throw err;
}

module.exports = { search, getInfo, getChapters, getPages, getPagesByNumber };
