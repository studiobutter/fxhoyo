import { Hono, type Context } from "hono";
import { escapeHtml, renderExternalHtml, renderPostHtml } from "./embed.js";
import {
  buildCanonicalPostUrl,
  HoyolabClient,
  normalizeLang,
} from "./hoyolab.js";
import type { ResolvedTarget } from "./types.js";

export interface AppOptions {
  client?: HoyolabClient;
}

const BOT_UA_PATTERN =
  /Discordbot|Twitterbot|Slackbot|TelegramBot|WhatsApp|facebookexternalhit|Facebot|Embedly|Applebot|Googlebot|bingbot|LinkedInBot|Pinterest|curl|Wget|HTTPie|Postman|Insomnia|python-requests|aiohttp|undici|node-fetch|Got\b/i;

const BROWSER_UA_PATTERN =
  /Mozilla\/5\.0.*(?:Chrome\/|Firefox\/|Safari\/|Edg\/|OPR\/|CriOS\/|FxiOS\/)/i;

export function shouldRedirectHumanBrowser(c: Context): boolean {
  const query = c.req.query();
  if (query.preview === "1" || query.debug === "1" || query.raw === "1") {
    return false;
  }
  const ua = c.req.header("user-agent") ?? "";
  if (!ua || BOT_UA_PATTERN.test(ua)) {
    return false;
  }
  return BROWSER_UA_PATTERN.test(ua);
}

function getRequestOrigin(c: Context): string | undefined {
  try {
    const url = new URL(c.req.url);
    return url.origin;
  } catch {
    return undefined;
  }
}

function renderErrorHtml(status: number, title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(message)}" />
    <meta name="theme-color" content="#ED4245" />
  </head>
  <body>
    <h1>${status} - ${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </body>
</html>`;
}

function renderLandingHtml(origin: string): string {
  const base = escapeHtml(origin || "https://fxhoyo.example.com");
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>fxhoyo — HoYoLAB Discord Component Embed Fixer</title>
    <meta property="og:site_name" content="fxhoyo" />
    <meta property="og:title" content="fxhoyo — HoYoLAB Embed Fixer" />
    <meta property="og:description" content="Rich Discord Component Embeds for HoYoLAB posts, videos, Genius Column levels, and hoyo.link short URLs." />
    <meta name="theme-color" content="#25A0E7" />
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; max-width: 760px; margin: 3rem auto; padding: 0 1.25rem; line-height: 1.6; color: #e5e7eb; background: #0f172a; }
      code { background: #1e293b; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.9em; color: #7dd3fc; }
      pre { background: #1e293b; padding: 1rem; border-radius: 8px; overflow-x: auto; }
      h1, h2 { color: #f8fafc; }
      li { margin: 0.4rem 0; }
    </style>
  </head>
  <body>
    <h1>fxhoyo</h1>
    <p>Discord Component Embed fixer for HoYoLAB posts, videos, Miliastra Wonderland Genius Column posts, and <code>hoyo.link</code> short URLs.</p>
    <h2>Drop-in Domain Replacement</h2>
    <ul>
      <li>Long links: <code>${base}/article/47467158</code> (replaces <code>hoyolab.com/article/...</code> or <code>m.hoyolab.com/#/article/...</code>)</li>
      <li>Pre-post links: <code>${base}/article_pre/&lt;id&gt;</code></li>
      <li>Short links (query): <code>${base}/80GCFBAL?q=2X2pRVs0rEB</code></li>
      <li>Short links (direct): <code>${base}/v1xJyPgfc</code></li>
    </ul>
    <h2>Explicit Endpoints</h2>
    <ul>
      <li><code>${base}/post?post_id=47467158&amp;lang=en-us</code></li>
      <li><code>${base}/sh?q=2X2pRVs0rEB</code></li>
      <li><code>${base}/sh?redirect=v1xJyPgfc</code></li>
      <li><code>${base}/fix?url=https://www.hoyolab.com/article/47467158</code></li>
    </ul>
    <p>Append <code>?lang=ja-jp</code> (or any HoYoLAB locale) to override language, or <code>?preview=1</code> to view raw HTML in a browser.</p>
  </body>
</html>`;
}

export function createApp(options: AppOptions = {}): Hono {
  const client = options.client ?? new HoyolabClient();
  const app = new Hono({ strict: false });

  app.get("/", (c) => {
    const origin = getRequestOrigin(c) ?? "";
    return c.html(renderLandingHtml(origin));
  });

  app.get("/health", (c) => {
    return c.json({ ok: true });
  });

  app.get("/favicon.ico", (c) => c.body(null, 204));
  app.get("/robots.txt", (c) => c.text("User-agent: *\nAllow: /\n"));

  app.get("/oembed", (c) => {
    const title = c.req.query("title") || "HoYoLAB Post";
    const authorName = c.req.query("author_name") || "HoYoLAB User";
    const authorUrl = c.req.query("author_url") || "https://www.hoyolab.com";
    const providerName = c.req.query("provider_name") || "HoYoLAB";
    const providerUrl = c.req.query("provider_url") || "https://www.hoyolab.com";
    return c.json({
      version: "1.0",
      type: "link",
      title,
      author_name: authorName,
      author_url: authorUrl,
      provider_name: providerName,
      provider_url: providerUrl,
    });
  });

  async function respondWithPost(c: Context, postId: string, langParam?: string) {
    if (!/^\d+$/.test(postId)) {
      return c.html(
        renderErrorHtml(400, "Invalid Post ID", `Expected a numeric post_id, received "${postId}".`),
        400
      );
    }

    const lang = langParam ? normalizeLang(langParam) : undefined;
    const canonicalUrl = buildCanonicalPostUrl(postId, lang);

    if (shouldRedirectHumanBrowser(c)) {
      return c.redirect(canonicalUrl, 302);
    }

    try {
      const entry = await client.fetchPost(postId, lang);
      const html = renderPostHtml(entry, {
        lang,
        requestOrigin: getRequestOrigin(c),
      });
      c.header("Cache-Control", "public, max-age=300, s-maxage=300");
      return c.html(html);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load HoYoLAB post";
      return c.html(renderErrorHtml(502, "HoYoLAB Fetch Error", msg), 502);
    }
  }

  async function respondWithTarget(c: Context, target: ResolvedTarget, langOverride?: string) {
    if (target.kind === "post") {
      return respondWithPost(c, target.postId, langOverride ?? target.lang);
    }

    if (shouldRedirectHumanBrowser(c)) {
      return c.redirect(target.url, 302);
    }

    c.header("Cache-Control", "public, max-age=300, s-maxage=300");
    return c.html(renderExternalHtml(target));
  }

  // Long link routes: /article/:postId and /post/:postId
  app.get("/article/:postId", async (c) => {
    const postId = c.req.param("postId");
    const lang = c.req.query("lang");
    return respondWithPost(c, postId, lang);
  });

  app.get("/post/:postId", async (c) => {
    const postId = c.req.param("postId");
    const lang = c.req.query("lang");
    return respondWithPost(c, postId, lang);
  });

  // Pre-post route: /article_pre/:prePostId
  app.get("/article_pre/:prePostId", async (c) => {
    const prePostId = c.req.param("prePostId");
    const lang = c.req.query("lang");
    try {
      const postId = await client.resolvePrePostId(prePostId, lang);
      return respondWithPost(c, postId, lang);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to resolve pre-post ID";
      return c.html(renderErrorHtml(502, "Pre-Post Resolution Error", msg), 502);
    }
  });

  // Explicit route: /post?post_id=...
  app.get("/post", async (c) => {
    const postId = c.req.query("post_id");
    if (!postId) {
      return c.html(renderErrorHtml(400, "Missing post_id", "Provide ?post_id=<id>."), 400);
    }
    return respondWithPost(c, postId, c.req.query("lang"));
  });

  // Explicit short-link route: /sh?q=... or /sh?redirect=...
  app.get("/sh", async (c) => {
    const q = c.req.query("q");
    const redirectId = c.req.query("redirect");
    const lang = c.req.query("lang");

    if (!q && !redirectId) {
      return c.html(
        renderErrorHtml(400, "Missing Short Link Parameter", "Provide ?q=<query_id> or ?redirect=<short_id>."),
        400
      );
    }

    try {
      const target = q
        ? await client.resolveTransitQuery(q, lang)
        : await client.resolveShortLink(redirectId!, undefined, lang);
      return respondWithTarget(c, target, lang);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to resolve short link";
      return c.html(renderErrorHtml(502, "Short Link Resolution Error", msg), 502);
    }
  });

  // Generic URL fixer endpoint: /fix?url=...
  app.get("/fix", async (c) => {
    const url = c.req.query("url");
    const lang = c.req.query("lang");
    if (!url) {
      return c.html(renderErrorHtml(400, "Missing url", "Provide ?url=<hoyolab_or_hoyo_link_url>."), 400);
    }

    try {
      const target = await client.resolveAnyUrl(url, lang);
      return respondWithTarget(c, target, lang);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to resolve URL";
      return c.html(renderErrorHtml(400, "URL Resolution Error", msg), 400);
    }
  });

  // Drop-in hoyo.link short link route: /:shortId or /:shortId?q=...
  app.get("/:shortId", async (c) => {
    const shortId = c.req.param("shortId");
    const q = c.req.query("q");
    const lang = c.req.query("lang");

    try {
      const target = await client.resolveShortLink(shortId, q, lang);
      return respondWithTarget(c, target, lang);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to resolve short link";
      return c.html(renderErrorHtml(502, "Short Link Resolution Error", msg), 502);
    }
  });

  return app;
}
