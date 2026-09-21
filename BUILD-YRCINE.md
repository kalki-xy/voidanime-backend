# How YRcine Is Made — Build Procedure

YRcine is a **single-file HTML streaming app**. There is no bundler, no build tool, no framework install — the entire product is one `index.html` (~1.1 MB) that runs straight off any static host, works offline-first on a phone browser, and talks to this repo's Express backend for data.

This document is the procedure to produce it. The built HTML files are intentionally **not** stored in this repo anymore — rebuild from this procedure instead.

---

## 1. Architecture

The file is a stack of layers, in order:

1. **Core** — router, UI kit, home feed, players, Otaku bridge (script #1) plus a handful of legacy product layers.
2. **Additive layers** — every change ships as a new self-contained block appended just before `</html>`:
   - `<style id="yrcine-vXXXX-css">` for CSS
   - `<script id="yrcine-vXXXX-js">` for behaviour
   - each guards itself (`if (window.__YRCINE_VXXXX) return;`) and is named after its version (`v5250`, `v5330`, `v5380` …)

Rules that keep the stack stable:

- **Never edit a core block or an older layer.** New work goes in a new layer.
- The only sanctioned exception: surgical edits to the provider data array (add/remove a provider) — and even then every change must be verified with the full test battery.
- The file ends with `</script>` + `</html>` — there is no `</body>`.
- Each layer updates (a) the version badge, (b) the changelog line in the doc comment at the top of the file.

## 2. Making a new version (step by step)
1. Start from the latest release HTML (delivered build).
2. Write the new layer's CSS/JS in normal, readable code, then append it before `</html>`.
3. Bump the badge: `YRcine vXX.XX · <layer-name>` (note: the badge uses a literal `·` character).
4. Add one changelog line to the doc comment at the top describing what changed.
5. Run the quality gates (below). All must pass before the build is released.

## 3. Quality gates (mandatory)

- **Syntax gate** — extract every `<script>` block and run `node --check` on each (currently 79–80 blocks; zero failures allowed).
- **jsdom feature battery** — boot the app (or the individual layer) in JSDOM with stubbed `fetch`/`api()` and a fake watch page; assert the feature behaves, and assert nothing regressed (provider pills, failover chain, defaults, migrations).
- **Invariants** — every release must keep:
  - only the **public** TMDB key (`db55323b…`); no personal keys ever
  - no `overscroll-behavior-y:contain` on `body` (scroll-killer)
  - hero `touch-action:pan-y` intact
  - layer count only grows; no layer removed or edited

## 4. Behaviour notes that matter

- **Movie sources** (English embeds): VidFast, VidLink, vidsrc.pm, vidsrc.cc, **2Embed (default)**, vidsrc.to — with a 9-second load-failure failover chain: `2embed → vidlink → vidfast → vidsrc.pm → vidsrc.cc → vidsrc.to`.
- **Hindi dubs**: the backend extracts direct multi-audio HLS (`zhls` master: jpn/tel/tam/hin, 240p–1080p) from the AnimeSalt network; the frontend plays it **inline in the page player** via hls.js (hls.js is preferred over native HLS — Android's native player drops alternate audio tracks), with per-language entries on the watch page.
- **Availability hint**: `/api/hindi/have` probes the server-rendered 2Embed page; if a title exists there while the user sits on a source that doesn't have it, a one-tap chip offers the switch.
- **Anime**: search → episodes → direct HLS via `/api/hindi/streams`; English sub/dub via `/api/hindi/watch` (megaplay/animegg).
- All streams flow through `/api/hindi/media` (content-sniffing proxy that rewrites playlist segment URIs) — this is what makes it work **VPN-free**.

## 5. Deploying

- **Backend (this repo)**: push to `main`; Vercel redeploys automatically in ~2 minutes.
- **Frontend**: build the HTML per this procedure, then drop it into `public/index.html` and push — the root domain then serves it.

---

**Live app: https://yrcine.site.je**
