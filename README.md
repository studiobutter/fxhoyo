# fxhoyo

A lightweight **Discord Component Embed** fixer for HoYoLAB posts, videos, Miliastra Wonderland Genius Column posts, and `hoyo.link` short URLs. Built with TypeScript and [Hono](https://hono.dev/) for both Node.js and Cloudflare Workers.

## Why fxhoyo?

HoYoLAB links—especially `hoyo.link` short URLs, `?q=` share links, `article_pre` draft links, CDN/YouTube video posts, and Genius Column level shares—often fail to produce useful previews in Discord. `fxhoyo` resolves HoYoLAB's redirect chains and internal APIs into Discord's native **Component Embeds** (`<script id="discord:component-embed">`) alongside standard Open Graph, Twitter Card, and oEmbed metadata.

## Quick Usage

Replace `hoyolab.com` or `hoyo.link` with your `fxhoyo` domain, or use one of the explicit resolver endpoints:

### Drop-in Domain Replacement

- **Article links:** `https://fxhoyo.example.com/article/47467158` (replaces `www.hoyolab.com/article/...`)
- **Pre-post links:** `https://fxhoyo.example.com/article_pre/<pre_post_id>`
- **Short links (`?q=`):** `https://fxhoyo.example.com/80GCFBAL?q=2X2pRVs0rEB`
- **Short links (direct):** `https://fxhoyo.example.com/v1xJyPgfc`

### Explicit Endpoints

- **By Post ID:** `https://fxhoyo.example.com/post?post_id=47467158`
- **By `?q=` Share Token:** `https://fxhoyo.example.com/sh?q=2X2pRVs0rEB`
- **By `hoyo.link` Short ID:** `https://fxhoyo.example.com/sh?redirect=v1xJyPgfc`
- **Any Full URL (including `m.hoyolab.com/#/article/...`):** `https://fxhoyo.example.com/fix?url=https%3A%2F%2Fm.hoyolab.com%2F%23%2Farticle%2F47467158`

### Options

- `?lang=<locale>` — Override post language via `x-rpc-language` (e.g., `?lang=ja-jp`, `?lang=zh-tw`; defaults to `en-us`).
- `?preview=1` (or `?debug=1` / `?raw=1`) — View the generated embed HTML in a browser instead of being redirected (`302`) to HoYoLAB.

For a complete breakdown of every route, upstream HoYoLAB URL, and embed behavior, see [Features.md](./Features.md).

## Key Features

- **Discord Component Embeds:** Renders Container (`17`), Section (`9`) + Author Avatar Thumbnail (`11`), Text Display (`10`), Media Gallery (`12`, up to 10 images or direct video), Separator (`14`), and Link Buttons (`2`, `style: 5`), automatically staying within Discord's **3,000-byte UTF-8** and **40-component** limits with safe `<script>` JSON escaping.
- **Open Graph & oEmbed Fallback:** Emits `og:*`, `twitter:card`, `theme-color`, `og:pubdate`, `og:video`, and `/oembed` discovery links for non-Discord clients.
- **All HoYoLAB Post Types:**
  - Regular (`view_type=1`) and Image (`view_type=2`) posts, respecting `has_cover` (`cover_list` vs. `image_list`).
  - Video posts (`view_type=5`) for both HoYoLAB CDN `.mp4`/`.webm`/`.mov` videos and YouTube embeds (`Watch on YouTube` button + cover preview).
  - Genius Column / Miliastra Wonderland (`ugc_module`) posts with `Open in Genshin` and `View Level` links (avoiding 24-hour expiring level-cover `auth_key` URLs).
- **Short-Link & External Fallback:** Unwraps `hoyo.link`, `bbs-api-os.hoyolab.com/community/misc/api/transit`, and `sg-public-api.hoyolab.com/event/social_sea_share/redirectUrl`; falls back to extracting destination metadata for non-HoYoLAB targets like Web Events.
- **Bot vs. Browser Routing & Security:** Serves embed HTML (`Cache-Control: public, max-age=300, s-maxage=300`) to crawlers/bots while redirecting human browsers (`302`), backed by in-memory TTL caching, `5.5s` upstream timeouts, and SSRF protection against private/loopback addresses.

## Development & Deployment

### Prerequisites

- Node.js 20+ (22+ recommended for `@types/node`)
- npm

### Local Development (Node.js)

```bash
npm install
npm run dev       # Start TypeScript watch server on http://0.0.0.0:3000 (configurable via PORT / HOST)
npm test          # Run unit & route tests
npm run typecheck # Run TypeScript type check
npm run build     # Compile TypeScript to dist/
npm start         # Run compiled server (dist/server.js)
```

### Cloudflare Workers

`wrangler.toml` is preconfigured with `main = "src/index.ts"` (`compatibility_date = "2025-05-01"`). Deploy with Wrangler:

```bash
npx wrangler deploy
```

## Project Structure

- [src/index.ts](./src/index.ts) — Hono app entrypoint (Cloudflare Workers default export)
- [src/server.ts](./src/server.ts) — Node.js HTTP server wrapper (`@hono/node-server`)
- [src/app.ts](./src/app.ts) — HTTP routes, bot/browser detection, and response handlers
- [src/hoyolab.ts](./src/hoyolab.ts) — HoYoLAB API client, short-link/redirect resolution, HTML meta extraction, and SSRF checks
- [src/embed.ts](./src/embed.ts) — Discord Component Embed builder, byte/component budget enforcement, and HTML/OG renderer
- [src/cache.ts](./src/cache.ts) — Bounded in-memory TTL/LRU cache
- [src/types.ts](./src/types.ts) — TypeScript types for HoYoLAB responses and Discord Component Embeds
- [tests/fxhoyo.test.ts](./tests/fxhoyo.test.ts) — Unit and route tests
- [research.md](./research.md) — Original research notes on HoYoLAB URLs, API payloads, and embed behavior
- [Features.md](./Features.md) — Detailed URL reference and feature documentation
