const express = require('express');
const cors = require('cors');
const axios = require('axios');
const NodeCache = require('node-cache');
const path = require('path');

// Plain top-level requires so @vercel/node (ncc) bundles them — placeholder stubs keep missing ones loadable
const mangadexProvider = require('./providers/mangadex');
const mangapillProvider = require('./providers/mangapill');
const manganatoProvider = require('./providers/manganato');
const toonilyProvider = require('./providers/toonily');
const mangataroProvider = require('./providers/mangataro');
const animesaltProvider = require('./providers/animesalt');

const app = express();
const PORT = process.env.PORT || 3001;
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s=>s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if(!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin) || allowedOrigins.some(o=> origin && origin.includes(o.replace('https://','').replace('http://','')))){
      cb(null, true);
    } else {
      cb(null, true); // Allow all for manga reader, but you can restrict
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'X-Requested-With'],
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Logging
app.use((req,res,next)=>{
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

const providers = {};
[
  ['mangadex', mangadexProvider], ['mangapill', mangapillProvider], ['manganato', manganatoProvider], ['toonily', toonilyProvider], ['mangataro', mangataroProvider]
].forEach(([k, v]) => { if (v) providers[k] = v; });

// Helper to get provider (stubs fall back to the first real provider)
function getProvider(id){
  const key = String(id||'').toLowerCase();
  let p = providers[key] || providers.mangadex;
  if (p && p.__stub && providers.mangadex && !providers.mangadex.__stub) p = providers.mangadex;
  return p;
}

// ---------- HEALTH ----------
app.get('/api/health', (req,res)=>{
  res.json({ status:'ok', providers: Object.keys(providers), time: new Date().toISOString() });
});

// ---------- PROVIDERS LIST ----------
app.get('/api/providers', (req,res)=>{
  const all = [
    { id:'mangadex', name:'MangaDex', type:'Official API', desc:'Direct public API' },
    { id:'mangapill', name:'MangaPill', type:'Scraper', desc:'Cheerio scraper' },
    { id:'manganato', name:'Manganato', type:'Scraper', desc:'Huge library, fast' },
    { id:'weebcentral', name:'WeebCentral', type:'Scraper', desc:'Blocked: Cloudflare 403' },
    { id:'mangafire', name:'MangaFire', type:'Scraper', desc:'Blocked: Cloudflare' },
    { id:'comick', name:'ComicK', type:'API', desc:'Site shut down (io dead, mirrors fake)' }
  ];
  res.json({
    providers: all.map(p => Object.assign({}, p, { status: providers[p.id] ? (providers[p.id].__stub ? 'placeholder' : 'working') : 'missing' })),
    loaded: Object.keys(providers)
  });
});

// ---------- ANILIST TRENDING (like VoidAnime does) ----------
app.get('/api/trending', async (req,res)=>{
  const cacheKey = 'trending_anilist';
  const cached = cache.get(cacheKey);
  if(cached) return res.json(cached);
  try{
    const query = `
      query {
        Page(perPage: 20) {
          media(type:MANGA, sort:TRENDING_DESC) {
            id
            title { english romaji native }
            coverImage { large extraLarge color }
            averageScore
            format
            status
            genres
            description
          }
        }
      }
    `;
    const r = await axios.post('https://graphql.anilist.co', { query }, {
      headers:{ 'Content-Type':'application/json' },
      timeout: 10000
    });
    const media = r.data?.data?.Page?.media || [];
    const mapped = media.map(m=>({
      id: m.id,
      title: m.title.english || m.title.romaji || m.title.native,
      anilistId: m.id,
      coverUrl: m.coverImage?.extraLarge || m.coverImage?.large,
      coverImage: m.coverImage?.extraLarge || m.coverImage?.large,
      imageUrl: m.coverImage?.extraLarge || m.coverImage?.large,
      score: m.averageScore ? m.averageScore/10 : null,
      rating: m.averageScore ? m.averageScore/10 : null,
      averageScore: m.averageScore,
      format: m.format,
      type: m.format || 'MANGA',
      status: m.status,
      genres: m.genres,
      description: m.description ? m.description.replace(/<[^>]*>/g,'').slice(0,400) : ''
    }));
    const result = { results: mapped, data: mapped };
    cache.set(cacheKey, result, 3600);
    res.json(result);
  }catch(e){
    console.error('trending error', e.message);
    res.status(500).json({ error: e.message, results: [] });
  }
});

// ---------- COMPAT: /api/scrape/search ----------
app.get('/api/scrape/search', async (req,res)=>{
  const q = req.query.query || req.query.q || '';
  const origin = ['ja','ko','zh'].indexOf(req.query.origin) >= 0 ? req.query.origin : '';
  const adult = String(req.query.adult) === '1';
  const providerId = req.query.provider || 'mangadex';
  const cacheKey = `search:${providerId}:${(q||'').toLowerCase()}:${origin}:${adult?'18':''}`;
  const cached = cache.get(cacheKey);
  if(cached) return res.json(cached);
  try{
    const provider = getProvider(providerId);
    const results = await provider.search(q, { origin, adult });
    const payload = { results, data: results, items: results };
    cache.set(cacheKey, payload, 300);
    res.json(payload);
  }catch(e){
    console.error('search error', providerId, e.message);
    res.json({ error: e.message, results: [], data: [] });
  }
});

// ---------- COMPAT: /api/scrape/info ----------
app.get('/api/scrape/info', async (req,res)=>{
  const id = req.query.id;
  const providerId = req.query.provider || 'mangadex';
  if(!id) return res.status(400).json({ error:'id required' });
  const cacheKey = `info:${providerId}:${id}`;
  const cached = cache.get(cacheKey);
  if(cached) return res.json(cached);
  try{
    const provider = getProvider(providerId);
    const data = await provider.getInfo(id);
    const payload = { data, manga: data, results: data };
    cache.set(cacheKey, payload, 600);
    res.json(payload);
  }catch(e){
    console.error('info error', providerId, e.message);
    res.json({ error: e.message, data: null });
  }
});

// ---------- COMPAT: /api/scrape/chapters ----------
app.get('/api/scrape/chapters', async (req,res)=>{
  const id = req.query.id;
  const providerId = req.query.provider || 'mangadex';
  if(!id) return res.status(400).json({ error:'id required' });
  const cacheKey = `chapters:${providerId}:${id}`;
  const cached = cache.get(cacheKey);
  if(cached) return res.json(cached);
  try{
    const provider = getProvider(providerId);
    const chapters = await provider.getChapters(id);
    const payload = { chapters, data: chapters, results: chapters };
    cache.set(cacheKey, payload, 600);
    res.json(payload);
  }catch(e){
    console.error('chapters error', providerId, e.message);
    res.json({ error: e.message, chapters: [], data: [] });
  }
});

// ---------- COMPAT: /api/scrape/pages ----------
app.get('/api/scrape/pages', async (req,res)=>{
  const id = req.query.id;
  const chapterNumber = req.query.chapterNumber;
  const chapterId = req.query.chapterId || req.query.chapterid || id;
  const providerId = req.query.provider || 'mangadex';
  if(!id && !chapterId) return res.status(400).json({ error:'id or chapterId required' });
  const cacheKey = `pages:${providerId}:${id}:${chapterNumber || chapterId}`;
  const cached = cache.get(cacheKey);
  if(cached) return res.json(cached);
  try{
    const provider = getProvider(providerId);
    let pages;
    if(provider.getPagesByNumber){
      pages = await provider.getPagesByNumber(id, chapterNumber, chapterId);
    }else{
      pages = await provider.getPages(chapterId || id);
    }
    // Normalize to array of strings and array of objects
    const flat = pages.map(p=> typeof p==='string'? p : (p.url || p.imageUrl || p.src));
    const payload = { pages: flat, data: flat, images: flat, results: pages };
    cache.set(cacheKey, payload, 600);
    res.json(payload);
  }catch(e){
    console.error('pages error', providerId, e.message);
    res.json({ error: e.message, pages: [], data: [] });
  }
});

// ---------- MANGADEX DIRECT ROUTES (like VoidAnime Go backend) ----------
app.get('/api/mangadex/search', async (req,res)=>{
  const q = req.query.title || req.query.q || req.query.query;
  if(!q) return res.status(400).json({ error:'title required' });
  try{
    const results = await mangadexProvider.search(q);
    res.json({ results, data: results });
  }catch(e){ res.status(500).json({ error:e.message }); }
});

app.get('/api/mangadex/manga/:id', async (req,res)=>{
  try{
    const data = await mangadexProvider.getInfo(req.params.id);
    res.json({ data });
  }catch(e){ res.status(500).json({ error:e.message }); }
});

app.get('/api/mangadex/manga/:id/feed', async (req,res)=>{
  try{
    const chapters = await mangadexProvider.getChapters(req.params.id);
    res.json({ chapters, data: chapters });
  }catch(e){ res.status(500).json({ error:e.message }); }
});

app.get('/api/mangadex/at-home/server/:chapterId', async (req,res)=>{
  try{
    const pages = await mangadexProvider.getPages(req.params.chapterId);
    res.json({ pages });
  }catch(e){ res.status(500).json({ error:e.message }); }
});

// ---------- HINDI DUB ROUTES (AnimeSalt network — Hindi/Tamil/Telugu anime + movies) ----------
app.get('/api/hindi/search', async (req,res)=>{
  const q = req.query.q || req.query.title || '';
  if(!q) return res.status(400).json({ ok:false, error:'q required' });
  try{
    const results = await animesaltProvider.search(q);
    res.json({ ok:true, results: results, data: results });
  }catch(e){ console.error('hindi search error', e.message); res.status(502).json({ ok:false, error:e.message }); }
});

app.get('/api/hindi/series', async (req,res)=>{
  const id = req.query.id;
  if(!id) return res.status(400).json({ ok:false, error:'id required' });
  try{
    const data = await animesaltProvider.getInfo(id);
    res.json({ ok:true, data: data });
  }catch(e){ console.error('hindi series error', e.message); res.status(502).json({ ok:false, error:e.message }); }
});

app.get('/api/hindi/episodes', async (req,res)=>{
  const id = req.query.id;
  const season = parseInt(req.query.season||'1',10)||1;
  if(!id) return res.status(400).json({ ok:false, error:'id required' });
  try{
    const data = await animesaltProvider.episodes(id, season);
    res.json({ ok:true, data: data });
  }catch(e){ console.error('hindi episodes error', e.message); res.status(502).json({ ok:false, error:e.message }); }
});

app.get('/api/hindi/streams', async (req,res)=>{
  const id = req.query.id;
  const season = parseInt(req.query.season||'1',10)||1;
  const ep = parseInt(req.query.ep||'1',10)||1;
  if(!id) return res.status(400).json({ ok:false, error:'id required' });
  try{
    const servers = await animesaltProvider.streams(id, season, ep);
    res.json({ ok:true, servers: servers, data: servers });
  }catch(e){ console.error('hindi streams error', e.message); res.status(502).json({ ok:false, error:e.message }); }
});

app.get('/api/hindi/movie', async (req,res)=>{
  const id = req.query.id;
  if(!id) return res.status(400).json({ ok:false, error:'id required' });
  try{
    const data = await animesaltProvider.movie(id);
    res.json({ ok:true, data: data });
  }catch(e){ console.error('hindi movie error', e.message); res.status(502).json({ ok:false, error:e.message }); }
});

// ---------- HINDI WATCH (justanime core — real English sub/dub sources) ----------
app.get('/api/hindi/watch', async (req,res)=>{
  const anilistId = req.query.anilistId || req.query.id;
  const ep = parseInt(req.query.ep || '1', 10) || 1;
  if(!anilistId) return res.status(400).json({ ok:false, error:'anilistId required' });
  const cacheKey = 'jaw:' + anilistId + ':' + ep;
  const cached = cache.get(cacheKey);
  if(cached) return res.json(cached);
  const HDRS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36', 'Origin': 'https://justanime.to' };
  const found = { sub: [], dub: [] };
  for (const sv of ['megaplay', 'animegg']) {
    try {
      const r = await axios.get('https://core.justanime.to/api/watch/' + encodeURIComponent(anilistId) + '/episode/' + ep + '/' + sv, { headers: HDRS, timeout: 15000 });
      const d = r.data || {};
      ['sub','dub'].forEach(function(k){
        let arr = [];
        if (d[k] && Array.isArray(d[k].sources)) arr = d[k].sources;
        else if (Array.isArray(d[k])) arr = d[k];
        arr.forEach(function(x){
          if (x && x.url) {
            const isM3U8 = !!(x.isM3U8 || (String(x.url).indexOf('.m3u8') >= 0));
            found[k].push({ url: x.url, isM3U8: isM3U8, quality: x.quality || null, type: isM3U8 ? 'hls' : 'mp4', server: sv, subtitles: (d[k] && d[k].subtitles) || x.subtitles || [] });
          }
        });
      });
    } catch (e) { /* try next server */ }
  }
  const payload = { ok: (found.sub.length + found.dub.length) > 0, sub: found.sub, dub: found.dub };
  cache.set(cacheKey, payload, 300);
  res.json(payload);
});

// ---------- HINDI MEDIA PROXY (m3u8 rewrite + stream pipe with CORS + referer) ----------
const MEDIA_REFERS = { animesalt: 'https://animesalttv.to/', megaplay: 'https://megaplay.buzz/', animegg: 'https://www.animegg.org/', justanime: 'https://justanime.to/' };
function mediaProx(u, rk){ return '/api/hindi/media?u=' + encodeURIComponent(u) + '&r=' + rk; }
app.get('/api/hindi/media', async (req,res)=>{
  const u = req.query.u;
  const rk = MEDIA_REFERS[req.query.r] ? req.query.r : 'animesalt';
  if(!u || String(u).indexOf('http') !== 0) return res.status(400).send('u required');
  try {
    const isM3u8 = String(u).indexOf('.m3u8') >= 0;
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36', 'Referer': MEDIA_REFERS[rk], 'Accept': '*/*' };
    if (req.headers.range) headers['Range'] = req.headers.range;
    const r = await axios.get(u, { headers: headers, timeout: 25000, responseType: isM3u8 ? 'text' : 'stream', maxRedirects: 5, validateStatus: null });
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (isM3u8) {
      const base = String(u);
      const lines = String(r.data).split('\n');
      const outL = [];
      for (let ln of lines) {
        if (ln.indexOf('\r') >= 0) ln = ln.split('\r')[0];
        if (!ln) { outL.push(''); continue; }
        if (ln.charAt(0) === '#') {
          const qi = ln.indexOf('URI="');
          if (qi >= 0) {
            const end = ln.indexOf('"', qi + 5);
            const inner = ln.slice(qi + 5, end);
            let abs = inner;
            try { abs = new URL(inner, base).href; } catch (e2) {}
            ln = ln.slice(0, qi) + 'URI="' + mediaProx(abs, rk) + '"' + ln.slice(end + 1);
          }
          outL.push(ln);
        } else {
          let abs2 = ln;
          try { abs2 = new URL(ln, base).href; } catch (e3) {}
          outL.push(mediaProx(abs2, rk));
        }
      }
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.status(r.status === 200 ? 200 : r.status).send(outL.join('\n'));
    } else {
      res.setHeader('Content-Type', r.headers['content-type'] || 'video/mp4');
      if (r.headers['content-length']) res.setHeader('Content-Length', r.headers['content-length']);
      if (r.headers['accept-ranges']) res.setHeader('Accept-Ranges', r.headers['accept-ranges']);
      if (r.headers['content-range']) res.setHeader('Content-Range', r.headers['content-range']);
      res.status(r.status);
      r.data.pipe(res);
    }
  } catch(e){ res.status(502).json({ ok:false, error: String(e.message || e) }); }
});

// ---------- IMAGE PROXY (critical for VoidAnime style) ----------
app.get('/api/proxy/image', async (req,res)=>{
  const url = req.query.url;
  if(!url) return res.status(400).send('url required');
  try{
    // Determine referer based on domain
    let referer = 'https://mangadex.org/';
    if(url.includes('mangapill') || url.includes('readdetectiveconan')) referer = 'https://mangapill.com/';
    if(url.includes('natomanga') || url.includes('manganato') || url.includes('mkklcdn')) referer = 'https://natomanga.com/';
    if(url.includes('weebcentral')) referer = 'https://weebcentral.com/';
    if(url.includes('mangafire')) referer = 'https://mangafire.to/';
    if(url.includes('comick')) referer = 'https://comick.io/';
    if(url.includes('mangadex')) referer = 'https://mangadex.org/';
    if(url.includes('toonily')) referer = 'https://toonily.com/';
    if(url.includes('mangataro')) referer = 'https://mangataro.org/';

    const response = await axios.get(url, {
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': referer,
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
      },
      timeout: 15000
    });
    const contentType = response.headers['content-type'] || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    response.data.pipe(res);
  }catch(e){
    console.error('proxy error', e.message, url);
    // Fallback: redirect to original
    res.status(500).json({ error: e.message });
  }
});

// Root
app.get('/', (req,res)=>{
  res.send(`
    <h1>VoidAnime Backend is Running</h1>
    <p>Providers: ${Object.keys(providers).join(', ')}</p>
    <ul>
      <li><a href="/api/health">/api/health</a></li>
      <li><a href="/api/providers">/api/providers</a></li>
      <li><a href="/api/trending">/api/trending</a></li>
      <li>/api/scrape/search?query=naruto&provider=mangadex</li>
      <li>/api/scrape/info?id=&provider=mangadex</li>
      <li>/api/scrape/pages?id=&chapterNumber=&provider=mangadex</li>
      <li>/api/proxy/image?url=...</li>
    </ul>
  `);
});

module.exports = app;

// Local run only (Vercel uses module.exports above)
if (!process.env.VERCEL) app.listen(PORT, ()=>{
  console.log(`VoidAnime backend listening on http://localhost:${PORT}`);
  console.log(`Providers: ${Object.keys(providers).join(', ')}`);
});
