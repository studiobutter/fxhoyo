import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp } from "../src/app.js";
import {
  buildSafePostComponentEmbed,
  countComponents,
  extractPostMedia,
  renderPostHtml,
  utf8ByteLength,
} from "../src/embed.js";
import {
  HoyolabClient,
  isSafePublicUrl,
  parseHoyolabUrl,
} from "../src/hoyolab.js";
import type { ComponentEmbedPayload, HoyolabPostEntry } from "../src/types.js";

function makeSampleImagePost(overrides: Partial<HoyolabPostEntry> = {}): HoyolabPostEntry {
  return {
    post: {
      game_id: 6,
      post_id: "47467158",
      uid: "346344980",
      subject: "Seriously, this feels wrong",
      content: JSON.stringify({
        describe: "Help me, Mr. Svarog!",
        imgs: [
          "https://upload-os-bbs.hoyolab.com/upload/2026/11/16/346344980/ed7cc242ac4168333845afa4ce63a509_7996379017059274178.jpg",
          "https://upload-os-bbs.hoyolab.com/upload/2026/11/16/346344980/bc372e1656ae7e1334400a3ecc454e55_4313224786275799472.jpg",
        ],
      }),
      view_type: 2,
      created_at: 1794843491,
      is_deleted: 0,
      lang: "en-us",
      origin_lang: "en-us",
      has_cover: false,
      desc: "Help me, Mr. Svarog!",
    },
    user: {
      uid: "346344980",
      nickname: "user_346344980",
      avatar_url:
        "https://upload-os-bbs.hoyolab.com/upload/2022/09/16/074db8f69d6b4eb66139b837405416f6_2637497491200521781.png",
    },
    stat: {
      view_num: 32193,
      reply_num: 77,
      like_num: 959,
      bookmark_num: 192,
      share_num: 12,
    },
    image_list: [
      {
        url: "https://upload-os-bbs.hoyolab.com/upload/2026/11/16/346344980/ed7cc242ac4168333845afa4ce63a509_7996379017059274178.jpg",
        height: 2106,
        width: 960,
        format: "JPEG",
        spoiler: false,
      },
      {
        url: "https://upload-os-bbs.hoyolab.com/upload/2026/11/16/346344980/bc372e1656ae7e1334400a3ecc454e55_4313224786275799472.jpg",
        height: 1080,
        width: 1920,
        format: "JPEG",
        spoiler: false,
      },
    ],
    cover_list: [],
    game: {
      game_id: 6,
      game_name: "Honkai: Star Rail",
      color: "#25A0E7",
    },
    channel: {
      id: "42",
      name: "Astral Express",
    },
    ...overrides,
  };
}

function extractEmbeddedScriptJson(html: string): { raw: string; parsed: ComponentEmbedPayload } {
  const match =
    /<script id="discord:component-embed" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match?.[1], "Missing <script id=\"discord:component-embed\"> tag");
  return {
    raw: match[1],
    parsed: JSON.parse(match[1]) as ComponentEmbedPayload,
  };
}

describe("URL parsing and SSRF checks", () => {
  it("parses www.hoyolab.com, m.hoyolab.com hash routes, article_pre, and redirectUrl", () => {
    assert.deepEqual(parseHoyolabUrl("https://www.hoyolab.com/article/47467158/"), {
      kind: "post",
      id: "47467158",
      lang: undefined,
      url: "https://www.hoyolab.com/article/47467158/",
    });

    assert.deepEqual(
      parseHoyolabUrl("https://m.hoyolab.com/#/article/47467158/?lang=en-us&utm_source=sns"),
      {
        kind: "post",
        id: "47467158",
        lang: "en-us",
        url: "https://m.hoyolab.com/#/article/47467158/?lang=en-us&utm_source=sns",
      }
    );

    assert.deepEqual(parseHoyolabUrl("https://www.hoyolab.com/article_pre/991122"), {
      kind: "pre_post",
      id: "991122",
      lang: undefined,
      url: "https://www.hoyolab.com/article_pre/991122",
    });

    const wrapped = parseHoyolabUrl(
      "https://sg-public-api.hoyolab.com/event/social_sea_share/redirectUrl?url=https%3A%2F%2Fm.hoyolab.com%2F%23%2Farticle%2F47467158%2F%3Flang%3Den-us&title=Seriously"
    );
    assert.equal(wrapped?.kind, "redirect_wrapper");
    assert.equal(wrapped?.wrappedUrl, "https://m.hoyolab.com/#/article/47467158/?lang=en-us");
  });

  it("rejects private/loopback URLs", () => {
    assert.equal(isSafePublicUrl("https://www.hoyolab.com/article/1"), true);
    assert.equal(isSafePublicUrl("http://127.0.0.1:8080/test"), false);
    assert.equal(isSafePublicUrl("http://localhost/test"), false);
    assert.equal(isSafePublicUrl("http://169.254.169.254/latest/meta-data"), false);
    assert.equal(isSafePublicUrl("http://192.168.1.1/"), false);
    assert.equal(isSafePublicUrl("file:///etc/passwd"), false);
  });
});

describe("Component Embed rendering and limits", () => {
  it("renders valid Component Embed and OG tags for image post 47467158", () => {
    const entry = makeSampleImagePost();
    const html = renderPostHtml(entry, { requestOrigin: "https://fxhoyo.example.com" });
    const { raw, parsed } = extractEmbeddedScriptJson(html);

    assert.ok(utf8ByteLength(raw) <= 3000, `Payload exceeded 3000 bytes: ${utf8ByteLength(raw)}`);
    assert.ok(countComponents(parsed.component) <= 40);
    assert.equal(parsed.component.type, 17);
    assert.equal(parsed.component.accent_color, 0x25a0e7);

    const gallery = parsed.component.components.find((c) => c.type === 12);
    assert.ok(gallery && gallery.type === 12);
    assert.equal(gallery.items.length, 2);

    assert.match(html, /<meta property="og:title" content="Seriously, this feels wrong" \/>/);
    assert.match(html, /<meta name="theme-color" content="#25A0E7" \/>/);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
    assert.match(html, /<link type="application\/json\+oembed"/);
  });

  it("uses cover_list when has_cover is true", () => {
    const entry = makeSampleImagePost({
      post: {
        ...makeSampleImagePost().post,
        view_type: 1,
        has_cover: true,
      },
      image_list: [{ url: "https://upload-os-bbs.hoyolab.com/img-should-not-win.jpg" }],
      cover_list: [{ url: "https://upload-os-bbs.hoyolab.com/cover-wins.png", spoiler: true }],
    });

    const media = extractPostMedia(entry);
    assert.equal(media.galleryItems.length, 1);
    assert.equal(media.galleryItems[0]?.media.url, "https://upload-os-bbs.hoyolab.com/cover-wins.png");
    assert.equal(media.galleryItems[0]?.spoiler, true);
  });

  it("handles HoYoLAB CDN video and YouTube video posts", () => {
    const cdnVideoEntry = makeSampleImagePost({
      post: { ...makeSampleImagePost().post, view_type: 5 },
      image_list: [],
      video: {
        id: "472614",
        cover: "https://vod-static.hoyolab.com/4/2025-05-03/transcoded/cover.jpg",
        url: "https://vod-static.hoyolab.com/4/2025-05-03/transcoded/video_1080p.mp4",
        sub_type: 2,
        resolution: [
          {
            name: "default",
            height: "1080",
            width: "1920",
            url: "https://vod-static.hoyolab.com/4/2025-05-03/transcoded/video_1080p.mp4",
          },
        ],
      },
    });

    const cdnHtml = renderPostHtml(cdnVideoEntry);
    const cdnEmbed = extractEmbeddedScriptJson(cdnHtml).parsed;
    const cdnGallery = cdnEmbed.component.components.find((c) => c.type === 12);
    assert.ok(cdnGallery && cdnGallery.type === 12);
    assert.equal(
      cdnGallery.items[0]?.media.url,
      "https://vod-static.hoyolab.com/4/2025-05-03/transcoded/video_1080p.mp4"
    );
    assert.match(cdnHtml, /<meta property="og:type" content="video\.other" \/>/);
    assert.match(cdnHtml, /<meta property="og:video"/);

    const ytEntry = makeSampleImagePost({
      post: { ...makeSampleImagePost().post, view_type: 5 },
      image_list: [],
      video: {
        id: "ISGtWDLPn84",
        cover: "https://i.ytimg.com/vi/ISGtWDLPn84/hqdefault.jpg",
        url: "https://www.youtube.com/embed/ISGtWDLPn84",
        sub_type: 0,
        resolution: [],
      },
    });

    const ytHtml = renderPostHtml(ytEntry);
    const ytEmbed = extractEmbeddedScriptJson(ytHtml).parsed;
    const ytGallery = ytEmbed.component.components.find((c) => c.type === 12);
    assert.ok(ytGallery && ytGallery.type === 12);
    assert.equal(ytGallery.items[0]?.media.url, "https://i.ytimg.com/vi/ISGtWDLPn84/hqdefault.jpg");
    const row = ytEmbed.component.components.find((c) => c.type === 1);
    assert.ok(row && row.type === 1);
    assert.ok(row.components.some((b) => b.url.includes("youtube.com/watch?v=ISGtWDLPn84")));
  });

  it("handles Genius Column levels without using expiring cover auth_key", () => {
    const ugcEntry = makeSampleImagePost({
      image_list: [{ url: "https://upload-os-bbs.hoyolab.com/post-photo.png" }],
      ugc_module: {
        ugc_levels: [
          {
            level_id: "7777129670",
            level: {
              level_id: "7777129670",
              region: "os_asia",
              level_name: "Daydream",
              play_type: "Survival",
              good_rate: "99.3%",
            },
          },
        ],
      },
    });

    const html = renderPostHtml(ugcEntry);
    const { parsed } = extractEmbeddedScriptJson(html);
    const serialized = JSON.stringify(parsed);
    assert.match(serialized, /Open in Genshin/);
    assert.match(serialized, /ugc_id=7777129670&server=os_asia/);
    assert.match(serialized, /level-detail\/index\?id=7777129670&region=os_asia/);
  });

  it("enforces <= 3000 UTF-8 bytes and escapes </script> cleanly", () => {
    const hugeImages = Array.from({ length: 10 }, (_, idx) => ({
      url: `https://upload-os-bbs.hoyolab.com/upload/2026/11/16/346344980/very_long_filename_${idx}_${"a".repeat(120)}.jpg`,
    }));

    const entry = makeSampleImagePost({
      post: {
        ...makeSampleImagePost().post,
        subject: "Title with </script><script>alert(1)</script> injection test",
        desc: "Long description ".repeat(150),
      },
      image_list: hugeImages,
    });

    const media = extractPostMedia(entry);
    const { serializedJson, payload } = buildSafePostComponentEmbed(
      entry,
      "https://www.hoyolab.com/article/47467158",
      media
    );

    assert.ok(
      utf8ByteLength(serializedJson) <= 3000,
      `Expected <= 3000 bytes, got ${utf8ByteLength(serializedJson)}`
    );
    assert.ok(countComponents(payload.component) <= 40);
    assert.equal(serializedJson.includes("</script>"), false);
    assert.equal(serializedJson.includes("\\u003c/script\\u003e"), true);
  });
});

describe("Hono app routes and short-link resolution", () => {
  function createMockClient() {
    const requestedLangs: string[] = [];
    const sample = makeSampleImagePost();

    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const headers = new Headers(init?.headers);

      if (url.includes("/community/misc/api/transit")) {
        return new Response(null, {
          status: 302,
          headers: {
            location:
              "https://sg-public-api.hoyolab.com/event/social_sea_share/redirectUrl?url=https%3A%2F%2Fm.hoyolab.com%2F%23%2Farticle%2F47467158%2F%3Flang%3Den-us%26utm_source%3Dsns&title=Seriously",
          },
        });
      }

      if (url === "https://hoyo.link/v1xJyPgfc") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://www.hoyolab.com/article_pre/555111" },
        });
      }

      if (url === "https://hoyo.link/webevent123") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://act.hoyoverse.com/ys/event/demo/index.html" },
        });
      }

      if (url === "https://act.hoyoverse.com/ys/event/demo/index.html") {
        return new Response(
          `<html><head>
            <meta property="og:title" content="Web Event Demo" />
            <meta property="og:description" content="Join the event!" />
            <meta property="og:image" content="https://act.hoyoverse.com/banner.jpg" />
          </head></html>`,
          { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
        );
      }

      if (url.includes("/community/post/wapi/getPostID")) {
        return Response.json({ retcode: 0, message: "OK", data: { post_id: "47467158" } });
      }

      if (url.includes("/community/post/wapi/getPostFull")) {
        const lang = headers.get("x-rpc-language") ?? "en-us";
        requestedLangs.push(lang);
        assert.equal(headers.get("x-rpc-app_version"), "4.0.0");
        return Response.json({ retcode: 0, message: "OK", data: { post: sample } });
      }

      return new Response("Not Found", { status: 404 });
    };

    const client = new HoyolabClient({ fetchFn: mockFetch });
    return { app: createApp({ client }), requestedLangs };
  }

  it("serves component embed on /article/:postId and /post?post_id=... for Discordbot", async () => {
    const { app, requestedLangs } = createMockClient();

    const res1 = await app.request("/article/47467158/?lang=ja-jp", {
      headers: { "user-agent": "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)" },
    });
    assert.equal(res1.status, 200);
    const html1 = await res1.text();
    assert.ok(html1.includes('id="discord:component-embed"'));
    assert.equal(requestedLangs[0], "ja-jp");

    const res2 = await app.request("/post?post_id=47467158", {
      headers: { "user-agent": "curl/8.5.0" },
    });
    assert.equal(res2.status, 200);
    assert.ok((await res2.text()).includes("Seriously, this feels wrong"));
  });

  it("resolves ?q= short links via /:shortId?q= and /sh?q=", async () => {
    const { app } = createMockClient();

    const res1 = await app.request("/80GCFBAL?q=2X2pRVs0rEB", {
      headers: { "user-agent": "Discordbot/2.0" },
    });
    assert.equal(res1.status, 200);
    const html1 = await res1.text();
    assert.ok(html1.includes("Seriously, this feels wrong"));

    const res2 = await app.request("/sh?q=2X2pRVs0rEB", {
      headers: { "user-agent": "Discordbot/2.0" },
    });
    assert.equal(res2.status, 200);
    assert.ok((await res2.text()).includes('id="discord:component-embed"'));
  });

  it("resolves regular hoyo.link short links to article_pre and external pages", async () => {
    const { app } = createMockClient();

    const preRes = await app.request("/v1xJyPgfc", {
      headers: { "user-agent": "Discordbot/2.0" },
    });
    assert.equal(preRes.status, 200);
    assert.ok((await preRes.text()).includes("Seriously, this feels wrong"));

    const extRes = await app.request("/sh?redirect=webevent123", {
      headers: { "user-agent": "Discordbot/2.0" },
    });
    assert.equal(extRes.status, 200);
    const extHtml = await extRes.text();
    assert.ok(extHtml.includes("Web Event Demo"));
    assert.ok(extHtml.includes('id="discord:component-embed"'));
  });

  it("redirects interactive human browsers unless ?preview=1 is set", async () => {
    const { app } = createMockClient();
    const chromeUa =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

    const redirectRes = await app.request("/article/47467158", {
      headers: { "user-agent": chromeUa },
    });
    assert.equal(redirectRes.status, 302);
    assert.equal(redirectRes.headers.get("location"), "https://www.hoyolab.com/article/47467158");

    const previewRes = await app.request("/article/47467158?preview=1", {
      headers: { "user-agent": chromeUa },
    });
    assert.equal(previewRes.status, 200);
    assert.ok((await previewRes.text()).includes('id="discord:component-embed"'));
  });
});
