import { buildCanonicalPostUrl } from "./hoyolab.js";
import type {
  ActionRowComponent,
  ComponentEmbedPayload,
  ContainerChildComponent,
  HoyolabImage,
  HoyolabPostEntry,
  LinkButtonComponent,
  MediaGalleryItem,
  ResolvedTarget,
} from "./types.js";

const MAX_COMPONENT_EMBED_BYTES = 3000;
const MAX_MEDIA_GALLERY_ITEMS = 10;
const MAX_COMPONENTS = 40;
const MAX_URL_LENGTH = 2048;
const MAX_BUTTON_URL_LENGTH = 512;
const DEFAULT_ACCENT_HEX = "#25A0E7";

const textEncoder = new TextEncoder();

export function utf8ByteLength(str: string): number {
  return textEncoder.encode(str).byteLength;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Serializes JSON safely for embedding inside an HTML <script> element.
 * Escapes `<` and `>` as `\u003c` / `\u003e` so `</script>` cannot break out.
 */
export function serializeScriptJson(payload: ComponentEmbedPayload): string {
  return JSON.stringify(payload)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

export function truncateChars(str: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  const chars = Array.from(str);
  if (chars.length <= maxChars) return str;
  if (maxChars === 1) return "…";
  return chars.slice(0, maxChars - 1).join("").trimEnd() + "…";
}

export function truncateUtf8Bytes(str: string, maxBytes: number): string {
  if (utf8ByteLength(str) <= maxBytes) return str;
  const chars = Array.from(str);
  let out = "";
  for (const ch of chars) {
    const candidate = out + ch + "…";
    if (utf8ByteLength(candidate) > maxBytes) break;
    out += ch;
  }
  return out.trimEnd() + "…";
}

function escapeDiscordLinkLabel(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/\[/g, "［")
    .replace(/\]/g, "］")
    .trim();
}

function isValidHttpUrl(raw?: string | null, maxLen = MAX_URL_LENGTH): raw is string {
  if (!raw || raw.length > maxLen) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseHexColor(hex?: string | null): { hex: string; int: number } {
  const fallback = { hex: DEFAULT_ACCENT_HEX, int: 0x25a0e7 };
  if (!hex) return fallback;
  const cleaned = hex.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return {
      hex: `#${cleaned.toUpperCase()}`,
      int: parseInt(cleaned, 16),
    };
  }
  if (/^[0-9a-fA-F]{8}$/.test(cleaned)) {
    const rgb = cleaned.slice(0, 6);
    return {
      hex: `#${cleaned.toUpperCase()}`,
      int: parseInt(rgb, 16),
    };
  }
  return fallback;
}

function formatCompactCount(n?: number): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractPostDescription(entry: HoyolabPostEntry): string {
  const rawDesc = entry.post.desc?.trim();
  if (rawDesc) return rawDesc;

  const rawContent = entry.post.content?.trim();
  if (!rawContent) return "";

  if (rawContent.startsWith("{")) {
    try {
      const parsed = JSON.parse(rawContent) as { describe?: string };
      if (typeof parsed.describe === "string" && parsed.describe.trim()) {
        return parsed.describe.trim();
      }
    } catch {
      // Fallback to HTML stripping below
    }
  }

  return stripHtml(rawContent);
}

function isDirectVideoFileUrl(url?: string | null): boolean {
  if (!isValidHttpUrl(url)) return false;
  const pathname = new URL(url).pathname.toLowerCase();
  return (
    pathname.endsWith(".mp4") ||
    pathname.endsWith(".webm") ||
    pathname.endsWith(".mov")
  );
}

function videoMimeType(url: string): string {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith(".webm")) return "video/webm";
  if (pathname.endsWith(".mov")) return "video/quicktime";
  return "video/mp4";
}

interface ExtractedMedia {
  galleryItems: MediaGalleryItem[];
  ogImages: HoyolabImage[];
  ogVideo?: {
    url: string;
    type: string;
    width?: number;
    height?: number;
    coverUrl?: string;
  };
  youtubeWatchUrl?: string;
}

export function extractPostMedia(entry: HoyolabPostEntry): ExtractedMedia {
  const galleryItems: MediaGalleryItem[] = [];
  const ogImages: HoyolabImage[] = [];

  // Video Post (view_type === 5 or entry.video present)
  const video = entry.video;
  if (video && (entry.post.view_type === 5 || video.url || video.cover)) {
    const resolutions = video.resolution ?? [];
    // Pick best resolution direct video URL if available, else video.url
    const sortedRes = [...resolutions].sort((a, b) => Number(b.height ?? 0) - Number(a.height ?? 0));
    const bestRes = sortedRes.find((r) => isDirectVideoFileUrl(r.url));
    const directVideoUrl = bestRes?.url ?? (isDirectVideoFileUrl(video.url) ? video.url : undefined);

    if (directVideoUrl && isValidHttpUrl(directVideoUrl)) {
      const coverUrl = isValidHttpUrl(video.cover)
        ? video.cover
        : isValidHttpUrl(video.cover_meta?.url)
          ? video.cover_meta?.url
          : undefined;
      galleryItems.push({ media: { url: directVideoUrl } });
      if (coverUrl) {
        ogImages.push({
          url: coverUrl,
          width: video.cover_meta?.width,
          height: video.cover_meta?.height,
        });
      }
      return {
        galleryItems,
        ogImages,
        ogVideo: {
          url: directVideoUrl,
          type: videoMimeType(directVideoUrl),
          width: bestRes?.width ? Number(bestRes.width) : video.cover_meta?.width,
          height: bestRes?.height ? Number(bestRes.height) : video.cover_meta?.height,
          coverUrl,
        },
      };
    }

    // YouTube embed video -> use video.cover image and offer a Watch on YouTube button
    const isYoutube =
      Boolean(video.url?.includes("youtube.com") || video.url?.includes("youtu.be")) ||
      (video.sub_type === 0 && Boolean(video.id));
    const youtubeWatchUrl =
      isYoutube && video.id ? `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}` : undefined;

    if (isValidHttpUrl(video.cover)) {
      galleryItems.push({ media: { url: video.cover } });
      ogImages.push({ url: video.cover });
    }

    if (galleryItems.length > 0 || youtubeWatchUrl) {
      return { galleryItems, ogImages, youtubeWatchUrl };
    }
  }

  // Regular / Image / Genius Column posts:
  // If has_cover is true and cover_list is non-empty, use cover_list instead of image_list.
  const rawList =
    entry.post.has_cover && entry.cover_list && entry.cover_list.length > 0
      ? entry.cover_list
      : entry.image_list && entry.image_list.length > 0
        ? entry.image_list
        : entry.cover_list ?? [];

  for (const img of rawList) {
    if (!isValidHttpUrl(img.url)) continue;
    if (galleryItems.length < MAX_MEDIA_GALLERY_ITEMS) {
      const item: MediaGalleryItem = { media: { url: img.url } };
      if (img.spoiler) item.spoiler = true;
      galleryItems.push(item);
    }
    if (ogImages.length < 4) {
      ogImages.push(img);
    }
  }

  return { galleryItems, ogImages };
}

export function countComponents(node: unknown): number {
  if (!node || typeof node !== "object") return 0;
  const obj = node as Record<string, unknown>;
  let count = typeof obj.type === "number" ? 1 : 0;
  if (Array.isArray(obj.components)) {
    for (const child of obj.components) {
      count += countComponents(child);
    }
  }
  if (obj.accessory && typeof obj.accessory === "object") {
    count += countComponents(obj.accessory);
  }
  return count;
}

interface BuildLayoutOptions {
  maxDescChars: number;
  maxTitleChars: number;
  maxGalleryItems: number;
  includeStats: boolean;
  includeUgcText: boolean;
  includeButtons: "all" | "primary" | "none";
}

function buildPostComponentPayload(
  entry: HoyolabPostEntry,
  canonicalUrl: string,
  media: ExtractedMedia,
  opts: BuildLayoutOptions
): ComponentEmbedPayload {
  const { post, user, game, channel, stat, ugc_module } = entry;
  const color = parseHexColor(game?.color);
  const nickname = escapeDiscordLinkLabel(user.nickname || `user_${user.uid}`);
  const authorUrl = `https://www.hoyolab.com/accountCenter/postList?id=${encodeURIComponent(user.uid)}`;
  const rawTitle = escapeDiscordLinkLabel(post.subject || "HoYoLAB Post");
  const title = truncateChars(rawTitle, opts.maxTitleChars);

  const rawDesc = extractPostDescription(entry);
  const desc = opts.maxDescChars > 0 ? truncateChars(rawDesc, opts.maxDescChars) : "";

  const metaParts: string[] = [];
  if (game?.game_name) metaParts.push(game.game_name);
  if (channel?.name) metaParts.push(channel.name);
  const contextLine = metaParts.length > 0 ? ` · *${metaParts.join(" / ")}*` : "";

  const headerLines = [
    `**[${nickname}](${authorUrl})**${contextLine}`,
    `### **[${title}](${canonicalUrl})**`,
  ];
  if (desc) {
    headerLines.push(desc);
  }

  const children: ContainerChildComponent[] = [];

  const headerText = {
    type: 10 as const,
    content: headerLines.join("\n"),
  };

  if (isValidHttpUrl(user.avatar_url)) {
    children.push({
      type: 9,
      components: [headerText],
      accessory: {
        type: 11,
        media: { url: user.avatar_url },
      },
    });
  } else {
    children.push(headerText);
  }

  // Media Gallery (up to 10 items)
  const items = media.galleryItems.slice(0, opts.maxGalleryItems);
  if (items.length > 0) {
    children.push({
      type: 12,
      items,
    });
  }

  // Genius Column / Miliastra Wonderland levels
  const ugcLevels = ugc_module?.ugc_levels ?? [];
  if (opts.includeUgcText && ugcLevels.length > 0) {
    children.push({ type: 14, spacing: 1 });
    const levelLines: string[] = [];
    for (const item of ugcLevels.slice(0, 3)) {
      const lvl = item.level;
      const levelId = lvl?.level_id || item.level_id;
      const region = lvl?.region || "os_asia";
      const levelName = escapeDiscordLinkLabel(lvl?.level_name || `Level ${levelId}`);
      const openGenshinUrl = `https://link.studiobutter.io.vn/ugc/wonderland?ugc_id=${encodeURIComponent(levelId)}&server=${encodeURIComponent(region)}`;
      const viewLevelUrl = `https://act.hoyolab.com/ys/ugc_community/mx/#/pages/level-detail/index?id=${encodeURIComponent(levelId)}&region=${encodeURIComponent(region)}`;
      const details: string[] = [];
      if (lvl?.play_type) details.push(lvl.play_type);
      if (lvl?.good_rate) details.push(`👍 ${lvl.good_rate}`);
      if (lvl?.show_limit_play_num_str) details.push(`👥 ${lvl.show_limit_play_num_str}`);
      const detailSuffix = details.length > 0 ? ` (${details.join(" · ")})` : "";
      /* levelLines.push(
        `🎮 **${levelName}**${detailSuffix}\n[Open in Genshin](${openGenshinUrl}) · [View Level](${viewLevelUrl})`
      ); */
    }
    children.push({
      type: 10,
      content: levelLines.join("\n"),
    });
  }

  // Stats footer
  if (opts.includeStats && stat) {
    const statParts = [
      `♥ ${formatCompactCount(stat.like_num)}`,
      `💬 ${formatCompactCount(stat.reply_num)}`,
      `🔖 ${formatCompactCount(stat.bookmark_num)}`,
      `👁 ${formatCompactCount(stat.view_num)}`,
    ];
    if (post.created_at && post.created_at > 0) {
      statParts.push(`<t:${post.created_at}:d>`);
    }
    children.push({
      type: 10,
      content: `-# ${statParts.join(" · ")}`,
    });
  }

  // Action row buttons
  if (opts.includeButtons !== "none") {
    const buttons: LinkButtonComponent[] = [];
    if (isValidHttpUrl(canonicalUrl, MAX_BUTTON_URL_LENGTH)) {
      buttons.push({
        type: 2,
        style: 5,
        url: canonicalUrl,
        label: "View on HoYoLAB",
      });
    }

    if (opts.includeButtons === "all") {
      if (media.youtubeWatchUrl && isValidHttpUrl(media.youtubeWatchUrl, MAX_BUTTON_URL_LENGTH)) {
        buttons.push({
          type: 2,
          style: 5,
          url: media.youtubeWatchUrl,
          label: "Watch on YouTube",
        });
      }
      if (ugcLevels.length === 1 && ugcLevels[0]) {
        const lvl = ugcLevels[0].level;
        const levelId = lvl?.level_id || ugcLevels[0].level_id;
        const region = lvl?.region || "os_asia";
        const openGenshinUrl = `https://link.studiobutter.io.vn/ugc/wonderland?ugc_id=${encodeURIComponent(levelId)}&server=${encodeURIComponent(region)}`;
        const viewLevelUrl = `https://act.hoyolab.com/ys/ugc_community/mx/#/pages/level-detail/index?id=${encodeURIComponent(levelId)}&region=${encodeURIComponent(region)}`;
        if (isValidHttpUrl(openGenshinUrl, MAX_BUTTON_URL_LENGTH)) {
          buttons.push({
            type: 2,
            style: 5,
            url: openGenshinUrl,
            label: "Open in Genshin",
          });
        }
        if (isValidHttpUrl(viewLevelUrl, MAX_BUTTON_URL_LENGTH)) {
          buttons.push({
            type: 2,
            style: 5,
            url: viewLevelUrl,
            label: "View Level",
          });
        }
      }
    }

    if (buttons.length > 0) {
      const actionRow: ActionRowComponent = {
        type: 1,
        components: buttons.slice(0, 5),
      };
      children.push(actionRow);
    }
  }

  return {
    component: {
      type: 17,
      accent_color: color.int,
      components: children,
    },
  };
}

/**
 * Builds a Discord Component Embed payload guaranteed to fit within 3,000 bytes and 40 components.
 */
export function buildSafePostComponentEmbed(
  entry: HoyolabPostEntry,
  canonicalUrl: string,
  media: ExtractedMedia
): { payload: ComponentEmbedPayload; serializedJson: string } {
  const attempts: BuildLayoutOptions[] = [
    { maxDescChars: 420, maxTitleChars: 120, maxGalleryItems: 10, includeStats: true, includeUgcText: true, includeButtons: "all" },
    { maxDescChars: 240, maxTitleChars: 100, maxGalleryItems: 10, includeStats: true, includeUgcText: true, includeButtons: "all" },
    { maxDescChars: 120, maxTitleChars: 80, maxGalleryItems: 10, includeStats: true, includeUgcText: true, includeButtons: "primary" },
    { maxDescChars: 60, maxTitleChars: 80, maxGalleryItems: 10, includeStats: false, includeUgcText: true, includeButtons: "none" },
    { maxDescChars: 0, maxTitleChars: 80, maxGalleryItems: 10, includeStats: false, includeUgcText: false, includeButtons: "none" },
  ];

  // If even 10 gallery items exceed 3000 bytes (e.g. very long URLs), progressively reduce gallery items
  for (let count = Math.min(media.galleryItems.length, 10) - 1; count >= 0; count--) {
    attempts.push({
      maxDescChars: 120,
      maxTitleChars: 80,
      maxGalleryItems: count,
      includeStats: count <= 4,
      includeUgcText: count <= 4,
      includeButtons: count <= 4 ? "primary" : "none",
    });
  }

  for (const opts of attempts) {
    const payload = buildPostComponentPayload(entry, canonicalUrl, media, opts);
    if (countComponents(payload.component) > MAX_COMPONENTS) continue;
    const serializedJson = serializeScriptJson(payload);
    if (utf8ByteLength(serializedJson) <= MAX_COMPONENT_EMBED_BYTES) {
      return { payload, serializedJson };
    }
  }

  // Absolute minimal fallback guaranteed under 3000 bytes
  const minimal: ComponentEmbedPayload = {
    component: {
      type: 17,
      accent_color: parseHexColor(entry.game?.color).int,
      components: [
        {
          type: 10,
          content: `### **[${truncateChars(escapeDiscordLinkLabel(entry.post.subject || "HoYoLAB Post"), 60)}](${canonicalUrl})**`,
        },
      ],
    },
  };
  return {
    payload: minimal,
    serializedJson: serializeScriptJson(minimal),
  };
}

export function renderPostHtml(
  entry: HoyolabPostEntry,
  options: { lang?: string; requestOrigin?: string } = {}
): string {
  const postId = entry.post.post_id;
  const canonicalUrl = buildCanonicalPostUrl(postId, options.lang);
  const media = extractPostMedia(entry);
  const { serializedJson } = buildSafePostComponentEmbed(entry, canonicalUrl, media);

  const color = parseHexColor(entry.game?.color);
  const gameName = entry.game?.game_name || "HoYoLAB";
  const siteName = truncateChars(
    entry.game?.game_name ? `HoYoLAB · ${gameName}` : "HoYoLAB",
    256
  );
  const title = truncateUtf8Bytes(entry.post.subject || "HoYoLAB Post", 70);
  const rawDesc = extractPostDescription(entry);
  const description = truncateUtf8Bytes(rawDesc, 350);
  const nickname = entry.user.nickname || `user_${entry.user.uid}`;
  const authorUrl = `https://www.hoyolab.com/accountCenter/postList?id=${encodeURIComponent(entry.user.uid)}`;

  const metaTags: string[] = [
    `<meta charset="utf-8" />`,
    `<title>${escapeHtml(entry.post.subject || "HoYoLAB Post")}</title>`,
    `<meta property="og:site_name" content="${escapeHtml(siteName)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />`,
    `<meta name="theme-color" content="${escapeHtml(color.hex)}" />`,
  ];

  if (description) {
    metaTags.push(`<meta property="og:description" content="${escapeHtml(description)}" />`);
  }

  if (entry.post.created_at && entry.post.created_at > 0) {
    const isoDate = new Date(entry.post.created_at * 1000).toISOString();
    metaTags.push(`<meta property="og:pubdate" content="${escapeHtml(isoDate)}" />`);
  }

  if (media.ogVideo) {
    metaTags.push(`<meta property="og:type" content="video.other" />`);
    metaTags.push(`<meta property="og:video" content="${escapeHtml(media.ogVideo.url)}" />`);
    metaTags.push(`<meta property="og:video:type" content="${escapeHtml(media.ogVideo.type)}" />`);
    if (media.ogVideo.width) {
      metaTags.push(`<meta property="og:video:width" content="${media.ogVideo.width}" />`);
    }
    if (media.ogVideo.height) {
      metaTags.push(`<meta property="og:video:height" content="${media.ogVideo.height}" />`);
    }
    if (media.ogVideo.coverUrl) {
      metaTags.push(`<meta property="og:image" content="${escapeHtml(media.ogVideo.coverUrl)}" />`);
    }
  } else if (media.ogImages.length > 0) {
    metaTags.push(`<meta property="og:type" content="article" />`);
    metaTags.push(`<meta name="twitter:card" content="summary_large_image" />`);
    for (const img of media.ogImages.slice(0, 4)) {
      metaTags.push(`<meta property="og:image" content="${escapeHtml(img.url)}" />`);
      if (img.width) metaTags.push(`<meta property="og:image:width" content="${img.width}" />`);
      if (img.height) metaTags.push(`<meta property="og:image:height" content="${img.height}" />`);
    }
  } else {
    metaTags.push(`<meta property="og:type" content="article" />`);
  }

  if (options.requestOrigin) {
    const oembedParams = new URLSearchParams({
      author_name: nickname,
      author_url: authorUrl,
      provider_name: siteName,
      provider_url: "https://www.hoyolab.com",
      title: entry.post.subject || "HoYoLAB Post",
    });
    const oembedUrl = `${options.requestOrigin}/oembed?${oembedParams.toString()}`;
    if (oembedUrl.length <= MAX_URL_LENGTH) {
      metaTags.push(
        `<link type="application/json+oembed" href="${escapeHtml(oembedUrl)}" />`
      );
    }
  }

  return `<!DOCTYPE html>
<html lang="${escapeHtml(entry.post.lang || "en")}">
  <head>
    ${metaTags.join("\n    ")}
    <script id="discord:component-embed" type="application/json">${serializedJson}</script>
  </head>
  <body>
    <main>
      <h1><a href="${escapeHtml(canonicalUrl)}">${escapeHtml(entry.post.subject || "HoYoLAB Post")}</a></h1>
      <p>By <a href="${escapeHtml(authorUrl)}">${escapeHtml(nickname)}</a></p>
      ${rawDesc ? `<p>${escapeHtml(rawDesc)}</p>` : ""}
    </main>
  </body>
</html>`;
}

export function renderExternalHtml(target: Extract<ResolvedTarget, { kind: "external" }>): string {
  const title = target.title || new URL(target.url).hostname;
  const color = parseHexColor(target.themeColor);
  const safeTitle = escapeDiscordLinkLabel(truncateChars(title, 120));
  const safeDesc = target.description ? truncateChars(target.description, 320) : "";

  const children: ContainerChildComponent[] = [
    {
      type: 10,
      content: [
        target.siteName ? `**${escapeDiscordLinkLabel(target.siteName)}**` : null,
        `### **[${safeTitle}](${target.url})**`,
        safeDesc || null,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  if (isValidHttpUrl(target.imageUrl)) {
    children.push({
      type: 12,
      items: [{ media: { url: target.imageUrl } }],
    });
  }

  if (isValidHttpUrl(target.url, MAX_BUTTON_URL_LENGTH)) {
    children.push({
      type: 1,
      components: [
        {
          type: 2,
          style: 5,
          url: target.url,
          label: "Open Link",
        },
      ],
    });
  }

  let payload: ComponentEmbedPayload = {
    component: {
      type: 17,
      accent_color: color.int,
      components: children,
    },
  };
  let serializedJson = serializeScriptJson(payload);
  if (utf8ByteLength(serializedJson) > MAX_COMPONENT_EMBED_BYTES) {
    payload = {
      component: {
        type: 17,
        accent_color: color.int,
        components: [
          {
            type: 10,
            content: `### **[${truncateChars(safeTitle, 80)}](${target.url})**`,
          },
        ],
      },
    };
    serializedJson = serializeScriptJson(payload);
  }

  const metaTags: string[] = [
    `<meta charset="utf-8" />`,
    `<title>${escapeHtml(title)}</title>`,
    `<meta property="og:title" content="${escapeHtml(truncateUtf8Bytes(title, 70))}" />`,
    `<meta property="og:url" content="${escapeHtml(target.url)}" />`,
    `<meta name="theme-color" content="${escapeHtml(color.hex)}" />`,
  ];
  if (target.siteName) {
    metaTags.push(`<meta property="og:site_name" content="${escapeHtml(truncateChars(target.siteName, 256))}" />`);
  }
  if (target.description) {
    metaTags.push(
      `<meta property="og:description" content="${escapeHtml(truncateUtf8Bytes(target.description, 350))}" />`
    );
  }
  if (isValidHttpUrl(target.imageUrl)) {
    metaTags.push(`<meta property="og:image" content="${escapeHtml(target.imageUrl)}" />`);
    metaTags.push(`<meta name="twitter:card" content="summary_large_image" />`);
  }

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    ${metaTags.join("\n    ")}
    <script id="discord:component-embed" type="application/json">${serializedJson}</script>
  </head>
  <body>
    <p><a href="${escapeHtml(target.url)}">${escapeHtml(title)}</a></p>
  </body>
</html>`;
}
