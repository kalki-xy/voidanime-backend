// providers/mangascrape.js
// Manhwa / Manhua providers via the MangaScrapeAPI service
// (github.com/sherenmalik93-create/MangaScrapeAPI).
//
// That service exposes the SAME routes our backend does
// (/api/scrape/search|info|chapters|pages), so we simply proxy it. It also
// handles Cloudflare for sites we cannot scrape directly — which is exactly
// why the old WeebCentral / MangaFire tabs failed.
//
// Providers it gives us:
//   asurascans  - manhwa (Korean)
//   vortexscans - manhwa
//   comix       - manhwa + manhua
//   mangafire   - mixed
//   mangago     - mixed
//
// Override the host with MANGA_SCRAPE_API if you self-host it.

'use strict';
const axios = require('axios');

const API = (process.env.MANGA_SCRAPE_API || 'https://manga-scrape-api.vercel.app').replace(/\/$/, '');
const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json'
};

async function jget(path, params) {
  const r = await axios.get(API + path, { params, headers: UA, timeout: 25000 });
  return r.data || {};
}

function make(pid) {
  return {
    __via: 'mangascrape',
    async search(q) {
      const d = await jget('/api/scrape/search', { query: q, provider: pid });
      const list = d.results || d.data || d.items || [];
      return (Array.isArray(list) ? list : []).map((x) => ({
        id: x.id,
        title: x.title || x.name,
        coverUrl: x.coverUrl || x.cover || x.image,
        score: x.score || x.rating || null,
        format: x.format || null
      })).filter((x) => x && x.title);
    },
    async getInfo(id) {
      const d = await jget('/api/scrape/info', { id, provider: pid });
      const m = d.data || d.manga || d || {};
      if (!m.chapters) m.chapters = [];
      return m;
    },
    async getChapters(id) {
      const d = await jget('/api/scrape/chapters', { id, provider: pid });
      const list = d.chapters || d.data || [];
      return Array.isArray(list) ? list : [];
    },
    async getPages(chapterId) {
      const d = await jget('/api/scrape/pages', { chapterId, provider: pid });
      const list = d.pages || d.images || d.data || [];
      return Array.isArray(list) ? list : [];
    },
    async getPagesByNumber(id, number, chapterId) {
      const d = await jget('/api/scrape/pages', { id, chapterNumber: number, chapterId, provider: pid });
      const list = d.pages || d.images || d.data || [];
      return Array.isArray(list) ? list : [];
    }
  };
}

module.exports = {
  asurascans: make('asurascans'),
  vortexscans: make('vortexscans'),
  comix: make('comix'),
  mangafire: make('mangafire'),
  mangago: make('mangago')
};
