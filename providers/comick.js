// ComicK provider — public JSON API (api.comick.fun)
// Search -> slug; info -> hid; chapters paginated (full list); images via meo.comick.art
const axios = require('axios');
const API = 'https://api.comick.fun';
const IMG = 'https://meo.comick.art/file';
const H = { 'User-Agent': 'VoidAnime-Backend/1.0 (manga reader)', 'Accept': 'application/json' };

async function search(q, opts){
  opts = opts || {};
  const params = { page: 1, limit: 24, tachiyomi: true };
  if (q) params.q = String(q);
  else params.sort = 'follow';
  const r = await axios.get(`${API}/v1.0/search`, { params, headers: H, timeout: 20000 });
  const list = (r.data && r.data.results) || [];
  return list.map(m => ({
    id: m.slug || m.hid,
    title: m.title || (m.md_titles && m.md_titles[0] && m.md_titles[0].title) || 'Untitled',
    coverUrl: (m.md_covers && m.md_covers[0] && m.md_covers[0].b2key) ? `${IMG}/${m.md_covers[0].b2key}` : null,
    description: ''
  }));
}

async function comicBySlug(slug){
  const r = await axios.get(`${API}/comic/${encodeURIComponent(slug)}`, { params: { lang: 'en' }, headers: H, timeout: 20000 });
  return r.data && r.data.comic ? r.data : null;
}

function chapterOf(c){
  return {
    id: c.hid,
    number: c.chap != null ? String(c.chap) : '',
    title: c.title || '',
    date: c.created_at || null
  };
}

async function chapterList(hid){
  // page 1 first, then remaining pages in PARALLEL (fast enough for serverless)
  const r1 = await axios.get(`${API}/chapters/${hid}`, {
    params: { lang: 'en', page: 1, limit: 100, order: 'asc' },
    headers: H, timeout: 25000
  });
  const d1 = r1.data || {};
  const all = ((d1.chapters) || []).map(chapterOf);
  const total = d1.total || d1.last_page || 0;
  const pages = total ? Math.min(Math.ceil(total / 100) - 1, 30) : 0;
  if (pages > 0){
    const rest = await Promise.all(
      Array.from({ length: pages }, (_, i) =>
        axios.get(`${API}/chapters/${hid}`, {
          params: { lang: 'en', page: i + 2, limit: 100, order: 'asc' },
          headers: H, timeout: 25000
        }).catch(() => null)
      )
    );
    rest.forEach(r => { if (r && r.data && r.data.chapters) r.data.chapters.forEach(c => all.push(chapterOf(c))); });
  }
  all.sort((a, b) => (parseFloat(a.number) || 0) - (parseFloat(b.number) || 0));
  return all;
}

async function getInfo(id){
  const data = await comicBySlug(id);
  if (!data) throw new Error('comic not found: ' + id);
  const c = data.comic;
  const chapters = await chapterList(c.hid);
  return {
    id: c.slug || id,
    title: c.title || 'Untitled',
    description: c.desc ? String(c.desc).replace(/<[^>]*>/g, '').slice(0, 400) : '',
    coverUrl: (c.md_covers && c.md_covers[0] && c.md_covers[0].b2key) ? `${IMG}/${c.md_covers[0].b2key}` : null,
    status: (c.status && (c.status.name || c.status)) || null,
    chapters
  };
}

async function getChapters(id){
  const data = await comicBySlug(id);
  if (!data) throw new Error('comic not found: ' + id);
  return chapterList(data.comic.hid);
}

async function getPages(chapterId){
  const r = await axios.get(`${API}/chapter/${chapterId}`, { headers: H, timeout: 25000 });
  const ch = r.data && r.data.chapter;
  const imgs = (ch && ch.md_images) || [];
  return imgs.map(im => `${IMG}/${im.b2key}`);
}

async function getPagesByNumber(id, chapterNumber, chapterId){
  if (chapterId) return getPages(chapterId);
  const chapters = await getChapters(id);
  const target = String(chapterNumber);
  const ch = chapters.find(c => c.number === target);
  if (!ch) throw new Error('chapter not found: ' + target);
  return getPages(ch.id);
}

module.exports = { search, getInfo, getChapters, getPages, getPagesByNumber };
