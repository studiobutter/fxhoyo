# fxhoyo Features & URL Reference

`fxhoyo` is a TypeScript + [Hono](https://hono.dev/) web service (compatible with Node.js and Cloudflare Workers) that converts HoYoLAB links and `hoyo.link` short URLs into rich **Discord Component Embeds**, along with standard Open Graph, Twitter Card, and oEmbed metadata for other platforms.

This document explains every URL handled by `fxhoyo`, what each endpoint does, how upstream HoYoLAB URLs are resolved, and the features implemented in the codebase.

---

## 1. fxhoyo Service URLs & Endpoints

Replace `fxhoyo.example.com` with your deployed `fxhoyo` domain.

### 1.1 Drop-in Domain Replacement URLs

These routes let users replace `hoyolab.com` or `hoyo.link` directly with the `fxhoyo` domain.

| URL Pattern | Example | Function |
| --- | --- | --- |
| `GET /article/:postId` | `https://fxhoyo.example.com/article/47467158` | Drop-in replacement for `https://www.hoyolab.com/article/<post_id>`. Validates that `:postId` is numeric (`^\d+$`), fetches the post from HoYoLAB, and serves embed HTML to crawlers or redirects (`302`) interactive browsers to the canonical HoYoLAB article. |
| `GET /post/:postId` | `https://fxhoyo.example.com/post/47467158` | Path alias for `/article/:postId`. Performs the same numeric validation, browser redirect, and embed rendering. |
| `GET /article_pre/:prePostId` | `https://fxhoyo.example.com/article_pre/555111` | Drop-in replacement for `https://www.hoyolab.com/article_pre/<pre_post_id>`. Resolves the pre-post ID to a numeric `post_id` via HoYoLAB's `getPostID` endpoint (cached for 30 minutes), then renders or redirects to the resolved post. |
| `GET /:shortId?q=<query_id>` | `https://fxhoyo.example.com/80GCFBAL?q=2X2pRVs0rEB` | Drop-in replacement for `hoyo.link` share links carrying a `?q=` payload (commonly HoYoLAB posts). Uses the `q` parameter to query HoYoLAB's transit API, extracts the destination URL, and renders/redirects to the post (or external metadata fallback). |
| `GET /:shortId` | `https://fxhoyo.example.com/v1xJyPgfc` | Drop-in replacement for direct `https://hoyo.link/<short_id>` links. Validates `:shortId` (`^[a-zA-Z0-9_-]+$`), follows up to 6 HTTP redirect hops starting at `https://hoyo.link/<shortId>`, and either renders a HoYoLAB post/pre-post embed if the destination is HoYoLAB, or extracts HTML metadata if the destination is an external page (such as a Web Event, Google Drive folder, or download page). |

> **Note on `m.hoyolab.com/#/article/<post_id>` links:**  
> Mobile HoYoLAB links use a URL hash fragment (`#/article/<post_id>`), which browsers and crawlers do not transmit to HTTP servers. For mobile URLs, either remove `#` to use `/article/<post_id>` or pass the full URL-encoded link to `/fix?url=...`.

---

### 1.2 Explicit Resolver Endpoints

These endpoints provide dedicated query-parameter interfaces for bots, scripts, and manual embed fixing.

| URL Pattern | Example | Function |
| --- | --- | --- |
| `GET /post?post_id=<id>` | `https://fxhoyo.example.com/post?post_id=47467158` | Explicit post embed endpoint. Requires `post_id` (returns `400` if missing or non-numeric) and fetches/renders the post or redirects browsers. |
| `GET /sh?q=<query_id>` | `https://fxhoyo.example.com/sh?q=2X2pRVs0rEB` | Explicit short-link query resolver. Calls HoYoLAB's `transit` API with `q` and resolves the redirect chain to a HoYoLAB post or external target. |
| `GET /sh?redirect=<short_id>` | `https://fxhoyo.example.com/sh?redirect=v1xJyPgfc` | Explicit `hoyo.link` short-link resolver. Resolves `https://hoyo.link/<short_id>` through redirects to a HoYoLAB post or external target. (If both `q` and `redirect` are provided, `q` takes precedence; if neither is provided, returns `400`.) |
| `GET /fix?url=<encoded_url>` | `https://fxhoyo.example.com/fix?url=https%3A%2F%2Fm.hoyolab.com%2F%23%2Farticle%2F47467158` | Universal URL fixer. Accepts any public `http://` or `https://` URL, runs SSRF safety checks, recognizes HoYoLAB desktop/mobile/pre-post URLs, `hoyo.link` short links, `transit` URLs, and `social_sea_share/redirectUrl` wrappers, or falls back to scraping Open Graph metadata for any other public URL. |

---

### 1.3 Utility, Discovery & Health Endpoints

| URL Pattern | Function |
| --- | --- |
| `GET /` | Serves an HTML landing page showing usage examples for drop-in and explicit endpoints based on the request origin, along with Open Graph metadata for the service itself. |
| `GET /health` | Health check endpoint returning HTTP `200` with JSON `{"ok":true}`. |
| `GET /oembed` | Returns oEmbed v1.0 JSON (`type: "link"`) using query parameters `title`, `author_name`, `author_url`, `provider_name`, and `provider_url`. Linked from post HTML via `<link type="application/json+oembed">` as a fallback for platforms that consume oEmbed. |
| `GET /favicon.ico` | Returns HTTP `204 No Content` so browser favicon requests are not routed into `/:shortId`. |
| `GET /robots.txt` | Returns `User-agent: *\nAllow: /\n` so crawlers are explicitly permitted and do not hit `/:shortId`. |

---

### 1.4 Supported Query Parameters

These query parameters can be appended to post and resolver routes:

| Parameter | Values | Function |
| --- | --- | --- |
| `lang` | Locale code matching `^[a-z]{2,3}(-[a-z0-9]{2,4})?$` (e.g. `en-us`, `ja-jp`, `zh-tw`, `vi-vn`, `ko-kr`) | Sets the `x-rpc-language` request header when calling HoYoLAB APIs and overrides any language embedded in a short link or mobile hash URL. Defaults to `en-us` when omitted or invalid. Non-default languages are preserved on the canonical URL (`?lang=...`). |
| `preview` | `1` | Disables the `302` human-browser redirect so you can view the generated HTML, meta tags, and `<script id="discord:component-embed">` JSON directly in a browser. |
| `debug` | `1` | Same effect as `preview=1` (disables browser redirect). |
| `raw` | `1` | Same effect as `preview=1` (disables browser redirect). |

---

## 2. Recognized HoYoLAB & Upstream URLs

Based on `research.md` and `src/hoyolab.ts`, `fxhoyo` understands and interacts with the following upstream URL patterns:

### 2.1 User-Shared Input URLs

1. **Desktop Article URLs:** `https://www.hoyolab.com/article/<post_id>` (also `hoyolab.com/article/<post_id>`)
   - Parsed directly to extract `post_id` and optional `lang`.
2. **Mobile Hash-Routed Article URLs:** `https://m.hoyolab.com/#/article/<post_id>?lang=...`
   - Parsed inside `/fix?url=...` and inside redirect wrappers (`parseHoyolabUrl` extracts the path and query string from `URL.hash`).
3. **Pre-Post URLs:** `https://www.hoyolab.com/article_pre/<pre_post_id>`
   - Resolved to a standard numeric `post_id` via `getPostID`.
4. **Short Links with `?q=`:** `https://hoyo.link/<short_id>?q=<query_id>`
   - Usually indicates a HoYoLAB post share link; routed to HoYoLAB's `transit` API.
5. **General Short Links:** `https://hoyo.link/<short_id>`
   - Issues HTTP `302` redirects to HoYoLAB posts, pre-posts, official channels, game downloads, Google Drive folders, or Web Events (which often carry event-specific invite parameters such as `?m_code=`, `itc=`, `i_code=`, `ucode=`, or `u_code=`).

### 2.2 Internal HoYoLAB Resolution & API Endpoints

| Upstream URL | Purpose & Required Headers |
| --- | --- |
| `https://bbs-api-os.hoyolab.com/community/post/wapi/getPostFull?post_id=<post_id>&read=1&scene=1` | Fetches full post payload (`subject`, `desc`, `content`, `user`, `stat`, `game`, `channel`, `image_list`, `cover_list`, `video`, `ugc_module`, `multi_language_info`). Sends `x-rpc-app_version: 4.0.0` (required so all posts resolve properly) and `x-rpc-language: <lang>`. |
| `https://bbs-api-os.hoyolab.com/community/post/wapi/getPostID?id=<pre_post_id>` | Converts a `pre_post_id` into the canonical numeric `post_id`. Sends `x-rpc-app_version: 4.0.0` and `x-rpc-language: <lang>`. |
| `https://bbs-api-os.hoyolab.com/community/misc/api/transit?q=<query_id>` | Resolves `?q=` share links, returning a `302` redirect to `social_sea_share/redirectUrl`. |
| `https://sg-public-api.hoyolab.com/event/social_sea_share/redirectUrl?url=...&img_url=...&title=...` | Share redirect wrapper. `fxhoyo` unwraps the inner `url` directly and preserves `title` and `img_url` as metadata fallbacks if the unwrapped destination ends up being an external page. |

### 2.3 Generated Outbound URLs in Embeds

| Outbound URL | Purpose |
| --- | --- |
| `https://www.hoyolab.com/article/<post_id>` (plus `?lang=<lang>` when non-default) | Canonical post link used in the title header, `og:url`, `View on HoYoLAB` link button, and browser `302` redirect target. |
| `https://www.hoyolab.com/accountCenter/postList?id=<uid>` | Author profile link used in the post header and oEmbed `author_url`. |
| `https://www.youtube.com/watch?v=<video_id>` | Clean watch link generated from YouTube embed URLs (`https://www.youtube.com/embed/<id>`) for the `Watch on YouTube` link button. |
| `https://link.studiobutter.io.vn/ugc/wonderland?ugc_id=<level_id>&server=<region>` | `Open in Genshin` deep link for Genius Column / Miliastra Wonderland levels (`region` defaults to `os_asia`; valid HoYoLAB regions include `os_usa`, `os_asia`, `os_euro`, `os_cht`). |
| `https://act.hoyolab.com/ys/ugc_community/mx/#/pages/level-detail/index?id=<level_id>&region=<region>` | `View Level` HoYoLAB web link for Genius Column / Miliastra Wonderland levels. |

---

## 3. Core Features

### 3.1 Discord Component Embeds

Every resolved page includes a `<script id="discord:component-embed" type="application/json">` block structured for Discord's Component Embeds specification:

- **Container (`type: 17`)**: Uses the game's brand hex color (`game.color`, defaulting to `#25A0E7`) as `accent_color`.
- **Header Section (`type: 9`) + Avatar Thumbnail (`type: 11`)**: Displays the author's linked nickname, game/channel context (`Game / Channel`), linked post title, and truncated description alongside the author's avatar thumbnail (falls back to a plain Text Display `type: 10` if no valid avatar URL exists).
- **Media Gallery (`type: 12`)**: Renders up to 10 images (preserving HoYoLAB `spoiler` flags) or a direct CDN video file.
- **Genius Column Section (`type: 14` Separator + `type: 10` Text Display)**: When `ugc_module.ugc_levels` is present, renders up to 3 levels with level name, play type, good rate, player count limit, and `Open in Genshin` / `View Level` links.
- **Stats Footer (`type: 10`)**: Compact subtext (`-#`) showing likes, replies, bookmarks, views, and a Discord timestamp (`<t:created_at:d>`).
- **Action Row Link Buttons (`type: 1` + `type: 2, style: 5`)**: Up to 5 link buttons (`View on HoYoLAB`, `Watch on YouTube` for YouTube video posts, and `Open in Genshin` + `View Level` when a Genius Column post references a single level).
- **Automatic Payload Budget & Escaping (`buildSafePostComponentEmbed`)**:
  - Escapes `<` as `\u003c` and `>` as `\u003e` so `</script>` inside titles or descriptions cannot break out of the HTML `<script>` tag.
  - Enforces Discord's **3,000-byte UTF-8** payload limit and **40-component** limit by progressively trimming description/title lengths, dropping buttons/stats/UGC text, or reducing gallery items, with a minimal title-only container fallback as a last resort.
  - Escapes square brackets (`[` / `]`) in link labels and enforces URL length limits (`<= 2048` chars generally, `<= 512` chars on link buttons).

### 3.2 Support for All HoYoLAB Post Types

1. **Regular Posts (`view_type = 1`) & Image Posts (`view_type = 2`)**
   - Uses `post.desc` for the description, falling back to `JSON.parse(post.content).describe` or stripped HTML from `post.content`.
   - Respects `has_cover`: when `has_cover === true` and `cover_list` is non-empty, renders `cover_list`; otherwise renders `image_list` (falling back to `cover_list`).
2. **Video Posts (`view_type = 5` or `video` present)**
   - **HoYoLAB CDN Videos** (`.mp4`, `.webm`, `.mov` in `video.resolution` sorted by highest vertical resolution, or `video.url`): Embeds the direct video URL in the Media Gallery and emits `og:type="video.other"`, `og:video`, `og:video:type`, dimensions, and cover `og:image`.
   - **YouTube Embeds** (`youtube.com` / `youtu.be` or `sub_type === 0` with `video.id`): Displays `video.cover` in the Media Gallery and adds a `Watch on YouTube` button.
   - **Other Video Sources**: As noted in `research.md`, TikTok video posts are not shareable from HoYoLAB; any other video entry with a valid `video.cover` falls back to displaying the cover thumbnail.
3. **Genius Column / Miliastra Wonderland (`ugc_module`)**
   - Extracts `level_id`, `region`, `level_name`, `play_type`, `good_rate`, and `show_limit_play_num_str` from `ugc_module.ugc_levels`.
   - Intentionally avoids `level.cover.url` because its CDN `auth_key` expires after 24 hours, relying on the post's own `image_list` / `cover_list` instead.

### 3.3 Open Graph, Twitter Card & oEmbed Fallback

For platforms or clients that do not parse `discord:component-embed`, every post page also includes:
- `og:site_name` (e.g. `HoYoLAB · Honkai: Star Rail`), `og:title` (70-byte limit), `og:description` (350-byte limit), `og:url`, `og:pubdate` (ISO 8601), `theme-color`, and `og:type` (`article` or `video.other`).
- Up to 4 `og:image` tags (with `og:image:width` / `og:image:height` when available) and `twitter:card="summary_large_image"`, or `og:video*` tags for direct videos.
- `<link type="application/json+oembed">` pointing to `/oembed`.

### 3.4 Multi-Language & Regional-Only Posts

- Passing `?lang=<locale>` sets the `x-rpc-language` header on HoYoLAB API calls.
- When a requested language is unavailable or omitted, HoYoLAB falls back to English (`en-us`) or, for regional-only posts (e.g., `zh-tw`-only official announcements), returns the post in its available language.

### 3.5 External / Non-HoYoLAB Short-Link Fallback

- When a `hoyo.link` short URL or `/fix?url=` target resolves to a non-HoYoLAB URL (such as a Web Event, Google Drive folder, or download page), `fxhoyo` reads up to 256 KB of the final HTML response (`extractMetaFromHtml`), extracts `og:*`, `twitter:*`, `description`, `theme-color`, and `<title>` (with `redirectUrl` `title`/`img_url` as fallbacks), and renders a Component Embed + Open Graph page for that destination.

### 3.6 Bot Detection vs. Human Browser Redirection

- **Crawlers & CLI Tools** (`Discordbot`, `Twitterbot`, `Slackbot`, `TelegramBot`, `WhatsApp`, `facebookexternalhit`, `curl`, `Wget`, `python-requests`, `aiohttp`, `undici`, `node-fetch`, empty `User-Agent`, etc.) receive the `200 OK` embed HTML.
- **Interactive Web Browsers** (`Chrome/`, `Firefox/`, `Safari/`, `Edg/`, `OPR/`, `CriOS/`, `FxiOS/`) receive a `302` redirect straight to the canonical HoYoLAB article or resolved destination URL unless `?preview=1`, `?debug=1`, or `?raw=1` is present.

### 3.7 Caching, Performance & SSRF Protection

- **In-Memory TTL/LRU Caching (`TtlCache`, max 300 entries per cache):**
  - Posts (`post_id:lang`): 5 minutes
  - Pre-post ID mappings (`pre_post_id`): 30 minutes
  - Resolved short links / transit queries: 10 minutes
- **HTTP Caching:** Successful embed responses include `Cache-Control: public, max-age=300, s-maxage=300`.
- **Timeouts & Redirect Bounds:** Upstream requests time out after `5,500 ms` (staying under Discord's 10-second crawler timeout) and follow at most `6` redirect hops.
- **SSRF Protection (`isSafePublicUrl`):** Rejects non-HTTP(S) schemes, `localhost`, `.localhost`, `.local`, `.internal`, private/loopback/link-local/CGNAT IPv4 ranges (`0.0.0.0/8`, `10.0.0.0/8`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`), and IPv6 loopback/ULA/link-local addresses (`::1`, `::`, `fc*`, `fd*`, `fe80*`) on both initial URLs and every redirect hop.
