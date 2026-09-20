// Placeholder provider — replace with the real ComicK API provider when available.
// Real file drops in with no server changes needed.
const ERR = 'ComicK provider not available yet — replace this placeholder with the real provider file.';
async function unavailable(){ throw new Error(ERR); }
module.exports = { __stub: true, search: unavailable, getInfo: unavailable, getChapters: unavailable, getPages: unavailable, getPagesByNumber: unavailable };
