# fxhoyo

Discord **Component Embed** fixer for HoYoLAB posts, videos, Miliastra Wonderland Genius Column posts, and `hoyo.link` short URLs. Built with TypeScript and Hono for Node.js and Cloudflare Workers.

## Features

- **Discord Component Embeds (`<script id="discord:component-embed" type="application/json">`)**:
  - Uses Container (`17`), Section (`9`) + Author Avatar Thumbnail (`11`), Text Display (`10`), Media Gallery (`12`, up to 10 images or direct video), Separator (`14`), and Link Buttons (`2`, `style: 5`).
  - Automatically enforces Discord's **3,000-byte** payload limit (including `\u003c` / `\u003e` escaping) and **40-component** limit.
- **Open Graph + oEmbed Fallback**:
  - Full `og:*`, `twitter:card`, `theme-color`, `og:pubdate`, `og:video`, and `/oembed` fallback tags.
- **All HoYoLAB Post Types**:
  - Regular posts (`view_type=1`) and Image posts (`view_type=2`), respecting `has_cover=true` (`cover_list` vs `image_list`).
  - Video posts (`view_type=5`): HoYoLAB CDN `.mp4` videos and YouTube embeds (cover image + `Watch on YouTube` button).
  - Genius Column / Miliastra Wonderland (`ugc_module`): includes `Open in Genshin` and `View Level` links without relying on expiring cover `auth_key` URLs.
- **Link Resolution & Multi-Language**:
  - Drop-in domain replacement for `hoyolab.com/article/:id`, `hoyolab.com/article_pre/:id`, `hoyo.link/:short?q=...`, and `hoyo.link/:short`.
  - Explicit routes `/post?post_id=...`, `/sh?q=...`, `/sh?redirect=...`, and `/fix?url=...`.
  - Passes `x-rpc-app_version: 4.0.0` and `x-rpc-language` (`?lang=en-us`, `?lang=ja-jp`, etc.).
  - Non-HoYoLAB `hoyo.link` destinations (e.g., Web Events) fall back to rendering the destination page's metadata.
  - Redirects human browsers (`302`) to the canonical HoYoLAB URL while serving embed HTML to Discordbot, other crawlers, `curl`, or `?preview=1`.

## Development & Running

```bash
npm install
npm run dev       # Node.js dev server (port 3000)
npm test          # Run unit & route tests
npm run typecheck # TypeScript type check
npm run build     # Compile to dist/
npm start         # Run compiled Node.js server
```

For Cloudflare Workers, `wrangler.toml` points directly to `src/index.ts`.
