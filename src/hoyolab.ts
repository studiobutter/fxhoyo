import { TtlCache } from "./cache.js";
import type {
  HoyolabGetPostIdResponse,
  HoyolabPostEntry,
  HoyolabPostFullResponse,
  ResolvedTarget,
} from "./types.js";

const HOYOLAB_API_BASE = "https://bbs-api-os.hoyolab.com";
const HOYO_LINK_BASE = "https://hoyo.link";
const DEFAULT_LANG = "en-us";
const DEFAULT_TIMEOUT_MS = 5500; // Keep well under Discord's 10s total timeout
const MAX_REDIRECT_HOPS = 6;
const MAX_EXTERNAL_HTML_BYTES = 256 * 1024;

export type FetchLike = typeof fetch;

export interface HoyolabClientOptions {
  fetchFn?: FetchLike;
  timeoutMs?: number;
}

const postCache = new TtlCache<HoyolabPostEntry>(300, 5 * 60 * 1000);
const prePostCache = new TtlCache<string>(300, 30 * 60 * 1000);
const shortLinkCache = new TtlCache<ResolvedTarget>(300, 10 * 60 * 1000);

export function normalizeLang(raw?: string | null): string {
  if (!raw) return DEFAULT_LANG;
  const trimmed = raw.trim().toLowerCase();
  if (/^[a-z]{2,3}(-[a-z0-9]{2,4})?$/.test(trimmed)) {
    return trimmed;
  }
  return DEFAULT_LANG;
}

export function buildCanonicalPostUrl(postId: string, lang?: string): string {
  const base = `https://www.hoyolab.com/article/${encodeURIComponent(postId)}`;
  if (lang && lang !== DEFAULT_LANG) {
    return `${base}?lang=${encodeURIComponent(lang)}`;
  }
  return base;
}

/**
 * Checks whether a hostname is a private/loopback/link-local address to prevent SSRF.
 */
export function isSafePublicUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return false;
  }

  // IPv4 literal checks
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    ) {
      return false;
    }
  }

  // IPv6 loopback / unique local / link-local
  if (
    host === "::1" ||
    host === "::" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80")
  ) {
    return false;
  }

  return true;
}

export interface ParsedHoyolabUrl {
  kind: "post" | "pre_post" | "transit" | "short" | "redirect_wrapper" | "external";
  id?: string;
  queryId?: string;
  lang?: string;
  wrappedUrl?: string;
  wrappedTitle?: string;
  wrappedImageUrl?: string;
  url: string;
}

/**
 * Parses a HoYoLAB, hoyo.link, or social_sea_share redirectUrl into a structured representation.
 */
export function parseHoyolabUrl(rawUrl: string): ParsedHoyolabUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;

  // Handle sg-public-api.hoyolab.com/event/social_sea_share/redirectUrl?url=...
  if (
    host === "sg-public-api.hoyolab.com" &&
    path.includes("/event/social_sea_share/redirectUrl")
  ) {
    const innerUrl = parsed.searchParams.get("url");
    const title = parsed.searchParams.get("title") ?? undefined;
    const imgUrl = parsed.searchParams.get("img_url") ?? undefined;
    if (innerUrl) {
      return {
        kind: "redirect_wrapper",
        wrappedUrl: innerUrl,
        wrappedTitle: title,
        wrappedImageUrl: imgUrl,
        url: rawUrl,
      };
    }
  }

  // Handle bbs-api-os.hoyolab.com/community/misc/api/transit?q=...
  if (
    host === "bbs-api-os.hoyolab.com" &&
    path.includes("/community/misc/api/transit")
  ) {
    const q = parsed.searchParams.get("q");
    if (q) {
      return { kind: "transit", queryId: q, url: rawUrl };
    }
  }

  // Handle hoyo.link/<shortId> or hoyo.link/<shortId>?q=...
  if (host === "hoyo.link" || host.endsWith(".hoyo.link")) {
    const q = parsed.searchParams.get("q");
    const shortId = path.replace(/^\/+|\/+$/g, "");
    if (q) {
      return { kind: "transit", queryId: q, id: shortId || undefined, url: rawUrl };
    }
    if (shortId) {
      return { kind: "short", id: shortId, url: rawUrl };
    }
  }

  // Handle hoyolab.com (www.hoyolab.com, m.hoyolab.com, hoyolab.com)
  if (host === "hoyolab.com" || host.endsWith(".hoyolab.com")) {
    // Support hash routes like https://m.hoyolab.com/#/article/47467158/?lang=en-us
    let effectivePath = path;
    let effectiveParams = parsed.searchParams;
    if (parsed.hash && parsed.hash.startsWith("#/")) {
      const hashBody = parsed.hash.slice(1); // "/article/47467158/?lang=en-us"
      const [hashPath, hashQuery] = hashBody.split("?", 2);
      if (hashPath) effectivePath = hashPath;
      if (hashQuery) effectiveParams = new URLSearchParams(hashQuery);
    }

    const langParam = effectiveParams.get("lang") ?? parsed.searchParams.get("lang") ?? undefined;

    const articleMatch = /^\/article\/(\d+)\/?$/i.exec(effectivePath);
    if (articleMatch?.[1]) {
      return {
        kind: "post",
        id: articleMatch[1],
        lang: langParam,
        url: rawUrl,
      };
    }

    const preMatch = /^\/article_pre\/([a-zA-Z0-9_-]+)\/?$/i.exec(effectivePath);
    if (preMatch?.[1]) {
      return {
        kind: "pre_post",
        id: preMatch[1],
        lang: langParam,
        url: rawUrl,
      };
    }
  }

  return { kind: "external", url: rawUrl };
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Lightweight regex-based meta tag extractor for external fallback links.
 */
export function extractMetaFromHtml(
  html: string,
  pageUrl: string
): Omit<Extract<ResolvedTarget, { kind: "external" }>, "kind"> {
  const headMatch = /<head[\s>][\s\S]*?<\/head>/i.exec(html);
  const section = headMatch ? headMatch[0] : html.slice(0, 32768);

  const metaTags = section.match(/<meta\s+[^>]*>/gi) ?? [];
  const metaMap = new Map<string, string>();

  for (const tag of metaTags) {
    const keyMatch = /\b(?:property|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const valMatch = /\b(?:content|value)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const key = keyMatch?.[1] ?? keyMatch?.[2] ?? keyMatch?.[3];
    const val = valMatch?.[1] ?? valMatch?.[2] ?? valMatch?.[3];
    if (key && val !== undefined && !metaMap.has(key)) {
      metaMap.set(key, decodeHtmlEntities(val.trim()));
    }
  }

  const titleTagMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(section);
  const rawTitleTag = titleTagMatch?.[1] ? decodeHtmlEntities(titleTagMatch[1].trim()) : undefined;

  const title =
    metaMap.get("og:title") ||
    metaMap.get("twitter:title") ||
    rawTitleTag;
  const description =
    metaMap.get("og:description") ||
    metaMap.get("twitter:description") ||
    metaMap.get("description");
  const rawImage =
    metaMap.get("og:image") ||
    metaMap.get("og:image:url") ||
    metaMap.get("twitter:image") ||
    metaMap.get("twitter:image:src");
  const siteName = metaMap.get("og:site_name");
  const themeColor = metaMap.get("theme-color");

  let imageUrl: string | undefined;
  if (rawImage) {
    try {
      imageUrl = new URL(rawImage, pageUrl).toString();
    } catch {
      imageUrl = undefined;
    }
  }

  return {
    url: pageUrl,
    title: title || undefined,
    description: description || undefined,
    imageUrl,
    siteName: siteName || undefined,
    themeColor: themeColor || undefined,
  };
}

export class HoyolabClient {
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: HoyolabClientOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private apiHeaders(lang: string): Record<string, string> {
    return {
      Accept: "application/json",
      "x-rpc-app_version": "4.0.0",
      "x-rpc-language": lang,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    };
  }

  async resolvePrePostId(prePostId: string, lang = DEFAULT_LANG): Promise<string> {
    const cleanId = prePostId.trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(cleanId)) {
      throw new Error(`Invalid pre_post_id: ${prePostId}`);
    }

    const cached = prePostCache.get(cleanId);
    if (cached) return cached;

    const endpoint = `${HOYOLAB_API_BASE}/community/post/wapi/getPostID?id=${encodeURIComponent(cleanId)}`;
    const res = await this.fetchFn(endpoint, {
      headers: this.apiHeaders(normalizeLang(lang)),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`HoYoLAB getPostID failed with HTTP ${res.status}`);
    }

    const json = (await res.json()) as HoyolabGetPostIdResponse;
    const postId = json.data?.post_id;
    if (json.retcode !== 0 || !postId) {
      throw new Error(
        `HoYoLAB getPostID returned retcode=${json.retcode}: ${json.message || "missing post_id"}`
      );
    }

    prePostCache.set(cleanId, postId);
    return postId;
  }

  async fetchPost(postId: string, lang = DEFAULT_LANG): Promise<HoyolabPostEntry> {
    const cleanId = postId.trim();
    if (!/^\d+$/.test(cleanId)) {
      throw new Error(`Invalid post_id: ${postId}`);
    }

    const normalizedLang = normalizeLang(lang);
    const cacheKey = `${cleanId}:${normalizedLang}`;
    const cached = postCache.get(cacheKey);
    if (cached) return cached;

    const endpoint = `${HOYOLAB_API_BASE}/community/post/wapi/getPostFull?post_id=${encodeURIComponent(cleanId)}&read=1&scene=1`;
    const res = await this.fetchFn(endpoint, {
      headers: this.apiHeaders(normalizedLang),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`HoYoLAB getPostFull failed with HTTP ${res.status}`);
    }

    const json = (await res.json()) as HoyolabPostFullResponse;
    const postEntry = json.data?.post;
    if (json.retcode !== 0 || !postEntry?.post) {
      throw new Error(
        `HoYoLAB post not found or unavailable (retcode=${json.retcode}, message=${json.message})`
      );
    }

    if (postEntry.post.is_deleted === 1) {
      throw new Error(`HoYoLAB post ${cleanId} has been deleted`);
    }

    postCache.set(cacheKey, postEntry);
    return postEntry;
  }

  async resolveTransitQuery(queryId: string, langOverride?: string): Promise<ResolvedTarget> {
    const cleanQ = queryId.trim();
    if (!cleanQ) {
      throw new Error("Missing transit query parameter q");
    }

    const cacheKey = `q:${cleanQ}:${langOverride ?? ""}`;
    const cached = shortLinkCache.get(cacheKey);
    if (cached) return cached;

    const transitUrl = `${HOYOLAB_API_BASE}/community/misc/api/transit?q=${encodeURIComponent(cleanQ)}`;
    const target = await this.followUrlToTarget(transitUrl, langOverride);
    shortLinkCache.set(cacheKey, target);
    return target;
  }

  async resolveShortLink(shortId: string, queryQ?: string, langOverride?: string): Promise<ResolvedTarget> {
    const cleanShort = shortId.trim().replace(/^\/+|\/+$/g, "");
    if (queryQ) {
      return this.resolveTransitQuery(queryQ, langOverride);
    }
    if (!cleanShort || !/^[a-zA-Z0-9_-]+$/.test(cleanShort)) {
      throw new Error(`Invalid short link ID: ${shortId}`);
    }

    const cacheKey = `s:${cleanShort}:${langOverride ?? ""}`;
    const cached = shortLinkCache.get(cacheKey);
    if (cached) return cached;

    const shortUrl = `${HOYO_LINK_BASE}/${encodeURIComponent(cleanShort)}`;
    const target = await this.followUrlToTarget(shortUrl, langOverride);
    shortLinkCache.set(cacheKey, target);
    return target;
  }

  async resolveAnyUrl(rawUrl: string, langOverride?: string): Promise<ResolvedTarget> {
    if (!isSafePublicUrl(rawUrl)) {
      throw new Error("Invalid or disallowed URL");
    }
    return this.followUrlToTarget(rawUrl, langOverride);
  }

  private async followUrlToTarget(startUrl: string, langOverride?: string): Promise<ResolvedTarget> {
    let currentUrl = startUrl;
    let fallbackTitle: string | undefined;
    let fallbackImageUrl: string | undefined;

    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      const parsed = parseHoyolabUrl(currentUrl);
      if (parsed) {
        if (parsed.kind === "post" && parsed.id) {
          const lang = langOverride ?? parsed.lang;
          return {
            kind: "post",
            postId: parsed.id,
            lang: lang ? normalizeLang(lang) : undefined,
            canonicalUrl: buildCanonicalPostUrl(parsed.id, lang ? normalizeLang(lang) : undefined),
          };
        }

        if (parsed.kind === "pre_post" && parsed.id) {
          const lang = langOverride ?? parsed.lang;
          const postId = await this.resolvePrePostId(parsed.id, lang);
          return {
            kind: "post",
            postId,
            lang: lang ? normalizeLang(lang) : undefined,
            canonicalUrl: buildCanonicalPostUrl(postId, lang ? normalizeLang(lang) : undefined),
          };
        }

        if (parsed.kind === "redirect_wrapper" && parsed.wrappedUrl) {
          fallbackTitle = fallbackTitle ?? parsed.wrappedTitle;
          fallbackImageUrl = fallbackImageUrl ?? parsed.wrappedImageUrl;
          if (!isSafePublicUrl(parsed.wrappedUrl)) {
            throw new Error("Redirect wrapper points to an unsafe URL");
          }
          currentUrl = parsed.wrappedUrl;
          continue;
        }
      }

      if (!isSafePublicUrl(currentUrl)) {
        throw new Error("Unsafe redirect destination");
      }

      const res = await this.fetchFn(currentUrl, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
          Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        // Drain body if any to avoid resource leaks
        await res.body?.cancel().catch(() => undefined);
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      // Reached final non-redirect response for a non-HoYoLAB-post URL
      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (contentType.includes("text/html") || contentType.includes("application/xhtml+xml")) {
        const html = await this.readTextLimited(res, MAX_EXTERNAL_HTML_BYTES);
        const meta = extractMetaFromHtml(html, currentUrl);
        return {
          kind: "external",
          url: currentUrl,
          title: meta.title ?? fallbackTitle,
          description: meta.description,
          imageUrl: meta.imageUrl ?? fallbackImageUrl,
          siteName: meta.siteName,
          themeColor: meta.themeColor,
        };
      }

      await res.body?.cancel().catch(() => undefined);
      return {
        kind: "external",
        url: currentUrl,
        title: fallbackTitle,
        imageUrl: fallbackImageUrl,
      };
    }

    return {
      kind: "external",
      url: currentUrl,
      title: fallbackTitle,
      imageUrl: fallbackImageUrl,
    };
  }

  private async readTextLimited(res: Response, maxBytes: number): Promise<string> {
    if (!res.body) return "";
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        const remaining = maxBytes - total;
        if (value.byteLength > remaining) {
          chunks.push(value.subarray(0, remaining));
          total += remaining;
          break;
        }
        chunks.push(value);
        total += value.byteLength;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(merged);
  }
}
