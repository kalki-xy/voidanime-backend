// Toonily provider — Madara (WordPress) theme scraper, ported from MangaForge's toonily.py
// Coverage: full Korean manhwa library (the gap MangaDex licensing leaves)
const axios = require('axios');
const BASE = 'https://toonily.com';
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://toonily.com/'
};

function unesc(s){
  var map={'amp':'&','lt':'<','gt':'>','quot':'"','#039':"'",'#8217':"'",'#8220':'"','#8221':'"','nbsp':' ','hellip':'...','rsquo':"'",'lsquo':"'",'ldquo':'"','rdquo':'"','mdash':'\u2014'};
  return String(s||'').replace(/&#?([a-z0-9]+);/gi,function(_,k){return map[String(k).toLowerCase()]!=null?map[String(k).toLowerCase()]:_;})
    .replace(/\u2018|\u2019/g,"'").replace(/\u201c|\u201d/g,'"').replace(/\u2026/g,'...');
}

function stripTags(s){ return unesc(String(s||'').replace(/<[^>]*>/g,'')).trim(); }
function abs(u){
  if(!u) return '';
  u = String(u).trim().split(' ')[0];
  if(u.startsWith('//')) return 'https:'+u;
  if(u.startsWith('/')) return BASE+u;
  return u;
}
function imgSrc(tag){
  if(!tag) return '';
  const m = tag.match(/(?:data-src|data-lazy-src|data-original|src)="([^"]+)"/);
  const u = m ? m[1] : '';
  if(!u || u.startsWith('data:')) return '';
  return abs(u);
}
async function get(url, extra){
  const r = await axios.get(url, { headers: Object.assign({}, H, extra || {}), timeout: 20000 });
  return r.data;
}

async function search(q){
  if(!q) return [];
  const html = await get(BASE + '/?s=' + encodeURIComponent(q) + '&post_type=wp-manga');
  const out = [];
  const seen = {};
  // Madara search rows: each result block has <h3 class="h5"><a href=".../webtoon/slug/">Title</a> and a cover <img>
  const blocks = html.split(/(?=<div[^>]+class="[^"]*(?:page-item-detail|c-tabs-item__content)[^"]*")/);
  for (const b of blocks){
    const m = b.match(/<h3[^>]*class="[^"]*h5[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if(!m) continue;
    const href = abs(m[1]);
    if(href.indexOf(BASE + '/webtoon/') !== 0) continue;
    const slug = href.replace(/\/+$/,'').split('/').pop();
    if(seen[slug]) continue;
    seen[slug] = 1;
    const img = imgSrc((b.match(/<img[^>]+(?:data-src|data-lazy-src|src)="[^"]+"/)||[''])[0]);
    out.push({ id: slug, title: stripTags(m[2]), alt: [], coverUrl: img });
  }
  return out;
}

function parseChapters(html){
  const out = [];
  const seen = {};
  const re = /<li[^>]*class="[^"]*wp-manga-chapter[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = re.exec(html))){
    const a = m[1].match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if(!a) continue;
    const href = abs(a[1]);
    if(href.indexOf('/webtoon/') < 0 && href.indexOf('/manga/') < 0) continue;
    const label = stripTags(a[2]);
    const nm = label.match(/(?:chapter|episode|ch\.?|season\s*\d+\s*:?\s*chapter)\s*([0-9]+(?:\.[0-9]+)?)/i) || href.match(/chapter-?([0-9]+(?:\.[0-9]+)?)/i);
    const num = nm ? nm[1] : null;
    if(href && seen[href]) continue;
    seen[href] = 1;
    const rel = href.indexOf(BASE) === 0 ? href.slice(BASE.length) : href;
    out.push({ id: rel.replace(/^\//+/,''), number: num, title: label, date: null });
  }
  return out;
}

async function chapterList(slug){
  const url = BASE + '/webtoon/' + slug.replace(/^\/+|\/+$/g,'') + '/';
  let html = await get(url);
  let list = parseChapters(html);
  if (list.length < 20){
    // newer Madara builds lazy-load the TOC — full list via the ajax endpoint
    try {
      const r = await axios.post(url + 'ajax/chapters/', '', { headers: Object.assign({'X-Requested-With':'XMLHttpRequest'}, H), timeout: 20000 });
      const more = parseChapters(typeof r.data === 'string' ? r.data : '');
      if (more.length > list.length) list = more;
    } catch (e) { /* keep static list */ }
  }
  // Madara lists newest first; keep site order (matches MangaPill convention)
  return list;
}

async function getInfo(id){
  const slug = String(id).replace(/^\/+|\/+$/g,'');
  const url = BASE + '/webtoon/' + slug + '/';
  const html = await get(url);
  const title = stripTags(((html.match(/<div[^>]*class="[^"]*post-title[^"]*"[^>]*>\s*<h1[^>]*>([\s\S]*?)<\/h1>/)||[])[1]||''));
  const covBlock = (html.match(/<div[^>]*class="[^"]*summary_image[^"]*"[^>]*>[\s\S]{0,800}?<img[^>]*>/)||[''])[0];
  const cover = imgSrc(covBlock);
  const desc = stripTags(((html.match(/<div[^>]*class="[^"]*summary__content[^"]*"[^>]*>([\s\S]*?)<\/div>/)||[])[1]||'').slice(0,400));
  const chapters = await chapterList(slug);
  return { id: slug, title: title || slug, description: desc, coverUrl: cover, status: null, chapters };
}

async function getPages(chapterId){
  let p = String(chapterId);
  if(!/^https?:/i.test(p)) p = BASE + '/' + p.replace(/^\//+/,'');
  const html = await get(p);
  const urls = [];
  const re = /<img[^>]*>/g;
  let m;
  while ((m = re.exec(html))){
    const tag = m[0];

    const src = imgSrc(tag);
    if(!src) continue;
    if(/logo|banner|avatar|favicon/i.test(src)) continue;
    if(urls.indexOf(src) < 0) urls.push(src);
  }
  // if the page used generic <img> tags without classes, filter to wp-content/uploads
  const filtered = urls.filter(u => u.indexOf('wp-content/uploads') >= 0 || u.indexOf('cdn') >= 0);
  const out = filtered.length >= 3 ? filtered : urls;
  if(!out.length) throw new Error('no images found for ' + p);
  return out;
}

async function getPagesByNumber(id, chapterNumber, chapterId){
  if (chapterId) return getPages(chapterId);
  if (chapterNumber == null) throw new Error('chapterId or chapterNumber required');
  const chapters = await chapterList(id);
  const target = String(chapterNumber);
  const matches = chapters.filter(c => String(c.number) === target);
  if (!matches.length) throw new Error('chapter not found: ' + target);
  return getPages(matches[0].id);
}

module.exports = { search, getInfo, getChapters: chapterList, getPages, getPagesByNumber };
