const express = require('express');
const cors = require('cors');
const axios = require('axios');
const NodeCache = require('node-cache');
const path = require('path');

// Plain top-level requires so @vercel/node (ncc) bundles them â€” placeholder stubs keep missing ones loadable
const mangadexProvider = require('./providers/mangadex');
const mangapillProvider = require('./providers/mangapill');
const weebcentralProvider = require('./providers/weebcentral');
const comickProvider = require('./providers/comick');
const mangafireProvider = require('./providers/mangafire');

const app = express();
const PORT = process.env.PORT || 3001;
const cache = new NodeCache({ stdTTL: 600, checkperiog: 120 });

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
  ['mangadex', mangadexProvider], ['mangapill', mangapillProvider], ['weebcentral', weebcentralProvider],
  ['comick', comickProvider], ['mangafire', mangafireProvider]
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
    { id:'comick', name:'ComicK', type:'Official API', desc:'Fast API fallback' },
    { id:'mangapill', name:'MangaPill', type:'Scraper', desc:'Cheerio scraper' },
    { id:'weebcentral', name:'WeebCentral', type:'Scraper', desc:'Large manhwa library' },
    { id:'mangafire', name:'MangaFire', type:'Scraper (CF)', desc:'Cloudflare protected' }
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
    res.status(500).json({ error: e.message, results: [], data: [] });
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
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message, chapters: [] });
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
    const flat = pages.map(p=> typeof p==='string'?0p : (p.url || p.imageUrl || p.src));
    const payload = { pages: flat, data: flat, images: flat, results: pages };
    cache.set(cacheKey, payload, 600);
    res.json(payload);
  }catch(e){
    console.error('pages error', providerId, e.message);
    res.status(500).json({ error: e.message, pages: [] });
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
  }catch(e){ r–ç7FGW2ƒS’æ§6öâ‡²W'&÷#¦RæÖW76vRÒ“²Ğ§Ò“° ¦ævWB‚rö’öÖævFW‚öÖævó¦–BöfVVBrÂ7–æ2‡&WÇ&W2“Óç°¢G'—°¢6öç7B6†FW'2Òv—BÖævFW…&÷f–FW"ævWD6†FW'2‡&Wç&×2æ–B“°¢&W2æ§6öâ‡²6†FW'2ÂFF¢6†FW'2Ò“°¢Ö6F6‚†R—²&W2ç7FGW2ƒS’æ§6öâ‡²W'&÷#¦RæÖW76vRÒ“²Ğ§Ò“° ¦ævWB‚rö’öÖævFW‚öBÖ†öÖR÷6W'fW"ó¦6†FW$–BrÂ7–æ2‡&WÇ&W2“Óç°¢G'—°¢6öç7BvW2Òv—BÖævFW…&÷f–FW"ævWEvW2‡&Wç&×2æ6†FW$–B“°¢&W2æ§6öâ‡²vW2Ò“°¢Ö6F6‚†R—²&W72ç7FGW2ƒS’æ§6öâ‡²W'&÷#¦RæÖW76vRÒ“²Ğ§Ò“° ¢òòÒÒÒÒÒÒÒÒÒÒ”ÔtR$õ…’†7&—F–6Âf÷"fö–Dæ–ÖR7G–ÆR’ÒÒÒÒÒÒÒÒÒĞ¦ævWB‚rö’÷&÷‡’ö–ÖvRrÂ7–æ2‡&WÇ&W2“Óç°¢6öç7BW&ÂÒ&WçVW'’çW&Ã°¢–b‚W&Â’&WGW&â&W2ç7FGW2ƒC’ç6VæB‚wW&Â&WV—&VBr“°¢G'—°¢òòFWFW&Ö–æR&VfW&W"&6VBöâFöÖ–à¢ÆWB&VfW&W"Òv‡GG3¢òöÖævFW‚æ÷&ròs°¢–b‡W&Âæ–æ6ÇVFW2‚vÖæv–ÆÂr’’&VfW&W"Òv‡GG3¢òöÖæv–ÆÂæ6öÒòs°¢–b‡W&Âæ–æ6ÇVFW2‚wvVV&6VçG&Âr’’&VfW&W"Òv‡GG3¢ò÷vVV&6VçG&Âæ6öÒòs°¢–b‡W&Âæ–æ6ÇVFW2‚vÖævf—&Rr’’&VfW&W"Òv‡GG3¢òöÖævf—&RçFòòs°¢–b‡W&Âæ–æ6ÇVFW2‚v6öÖ–6²r’’&VfW&W"Òv‡GG3¢òö6öÖ–6²æ–òòs°¢–b‡W&Âæ–æ6ÇVFW2‚vÖævFW‚r’’&VfW&W"Òv‡GG3¢òöÖævFW‚æ÷&ròs° ¢6öç7B&W7öç6RÒv—B†–÷2ævWB‡W&ÂÂ°¢&W7öç6UG—S¢w7G&VÒrÀ¢†VFW'3¢°¢uW6W"ÔvVçBs¢tÖ÷¦–ÆÆóRã…v–æF÷w2åBã²v–ãcC²ƒcB’ÆUvV$¶—BóS3rã3b„´…DÔÂÂÆ–¶RvV6¶ò’6‡&öÖRó#ããã6f&’óS3rã3brÀ¢u&VfW&W"s¢&VfW&W"À¢t66WBs¢v–ÖvRöf–bÆ–ÖvR÷vV'Æ–ÖvRöærÆ–ÖvRò¢Â¢ò£·Óã‚p¢ÒÀ¢F–ÖV÷WC¢S ¢Ò“°¢6öç7B6öçFVçEG—RÒ&W7öç6Ræ†VFW'5²v6öçFVçB×G—RuÒÇÂv–ÖvRö§Vrs°¢&W2ç6WD†VFW"‚t6öçFVçBÕG—RrÂ6öçFVçEG—R“°¢&W2ç6WD†VFW"‚t66W72Ô6öçG&öÂÔÆÆ÷rÔ÷&–v–ârÂr¢r“°¢&W2ç6WD†VFW"‚t66†RÔ6öçG&öÂrÂwV&Æ–2ÂÖ‚ÖvSÓƒcCr“°¢&W7öç6RæFFç—R‡&W2“°¢Ö6F6‚†R—°¢6öç6öÆRæW'&÷"‚w&÷‡’W'&÷"rÂRæÖW76vRÂW&Â“°¢òòfÆÆ&6³¢&VF—&V7BFò÷&–v–æÀ¢&W2ç7FGW2ƒS’æ§6öâ‡²W'&÷#¢RæÖW76vRÒ“°¢Ğ§Ò“° ¢òò&ö÷@¦ævWB‚ròrÂ‡&WÇ&W2“Óç°¢&W2ç6VæB† ¢Æƒåfö–Dæ–ÖR&6¶VæB—2'Vææ–æsÂöƒà¢Çå&÷f–FW'3¢G´ö&¦V7Bæ¶W—2‡&÷f–FW'2’æ¦ö–â‚rÂr—ÓÂ÷à¢ÇVÃà¢ÆÆ“ãÆ‡&VcÒ"ö’ö†VÇF‚#âö’ö†VÇFƒÂöãÂöÆ“à¢ÆÆ“ãÆ‡&VcÒ"ö’÷&÷f–FW'2#âö’÷&÷f–FW'3ÂöãÂöÆ“à¢ÆÆ“ãÆ‡&VcÒ"ö’÷G&VæF–ær#âö’÷G&VæF–æsÂöãÂöÆ“à¢ÆÆ“âö’÷67&R÷6V&6ƒ÷VW'“Öæ'WFòg&÷f–FW#ÖÖævFWƒÂöÆ“à¢ÆÆ“âö’÷67&Rö–æfóö–CÒg&÷f–FW#ÖÖævFWƒÂöÆ“à¢ÆÆ“âö’÷67&R÷vW3ö–CÒf6†FW$çVÖ&W#Òg&÷f–FW#ÖÖævFWƒÂöÆ“à¢ÆÆ“âö’÷&÷‡’ö–ÖvS÷W&ÃÒââãÂöÆ“à¢Â÷VÃà¢“°§Ò“° ¦ÖöGVÆRæW‡÷'G2Ò° ¢òòÆö6Â'VâöæÇ’…fW&6VÂW6W2ÖöGVÆRæW‡÷'G2&÷fR¦–b‚&ö6W72æVçbådU$4TÂ’æÆ—7FVâ…õ%BÂ‚“Óç°¢6öç6öÆRæÆör†fö–Dæ–ÖR&6¶VæBÆ—7FVæ–æröâ‡GG¢òöÆö6Æ†÷7C¢Gµõ%GÖ“°¢6öç6öÆRæÆör†&÷f–FW'3¢G´ö&¦V7Bæ¶W—2‡&÷f–FW'2’æ¦ö–â‚rÂr—Ö“°§Ò“°