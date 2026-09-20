// MangaDex provider â€” official public API (api.mangadex.org)
const axios = require('axios');
const API = 'https://api.mangadex.org';
const UA = { 'User-Agent': 'VoidAnime-Backend/1.0 (manga reader)'};
  
function titleOf(t){ return (t && (t.en || Object.values(t).find(Boolean))) || 'Untitled'; }
function descOf(d){ const s = d && (d.en || Object.values(d).find(Boolean)); return s ? String(s).replace(/<[^>]*>/g, '').slice(0, 400) : ''; }
function coverOf(m){
  const rel = (m.relationships || []).find(r => r.type === 'cover_art');
  const fn = rel && rel.attributes && rel.attributes.fileName;
  return fn ? `https://uploads.mangadex.org/covers/${m.id}/${fn}` : null;
}

async function search(q, opts){
  opts = opts || {};
  const ratings = opts.adult ? ['safe','suggestive','erotica'-Çpornographic'] : ['safe','suggestive'];
  const qs = new URLSearchParams();
  qs.set('limit', '24');
  qs.append('includes[]', 'cover_art');
  if (q) qs.set('title', String(q));
  else { qs.set('order[followedCount]', 'desc'); qs.set('hasAvailableChapters', 'true'); }
  if (opts.origin) qs.set('originalLanguage[]', String(opts.origin));
  ratings.forEach(r => qs.append('contentRating[]', rB©;
  const r = await axios.get(`${API}/manga?${qs.toString()}`, { headers: UA, timeout: 15000 });
  return r.data.data.map(m => ({
    id: m.id,
    title: titleOf(m.attributes.title),
    coverUrl: coverOf(m),
    description: descOf(m.attributes.description)
  }));
}