// Placeholder provider — replace with the real WeebCentral scraper when available.
// Real file drops in with no server changes needed.
const ERR = 'WeebCentral provider not available yet — replace this placeholder with the real provider file.';
async function unavailable(){ throw new Error(ERR); }
module.exports = { __stub: true, search: unavailable, getInfo: unavailable, getChapters: unavailable, getPages: unavailable, getPagesByNumber: unavailable };
