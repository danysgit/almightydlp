import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "almightydlp-test-"));
process.env.APPDATA_DIR = appDataDir;
process.env.DOWNLOAD_TOKEN_SECRET = "format-planning-test-secret";

const { buildDownloadArgs, resolveEntryPlan } = await import("../server.js");

after(async () => {
  await fs.rm(appDataDir, { recursive: true, force: true });
});

test("X uses its highest-quality progressive MP4 instead of staging split HLS streams", () => {
  const progressiveUrl = "https://video.twimg.com/video/vid/avc1/3840x2160/video.mp4";
  const plan = resolveEntryPlan({
    id: "x-sample",
    title: "X sample",
    webpage_url: "https://x.com/example/status/1",
    extractor_key: "Twitter",
    formats: [
      {
        format_id: "hls-audio-128000-Audio",
        format_note: "Audio, high",
        ext: "mp4",
        protocol: "m3u8_native",
        vcodec: "none",
        acodec: null,
        audio_ext: "mp4",
        abr: 128,
        url: "https://video.twimg.com/video/pl/mp4a/128000/audio.m3u8"
      },
      {
        format_id: "http-2176",
        ext: "mp4",
        protocol: "https",
        vcodec: null,
        acodec: null,
        audio_ext: "none",
        height: 600,
        tbr: 2176,
        url: "https://video.twimg.com/video/vid/avc1/720x600/video.mp4"
      },
      {
        format_id: "http-25128",
        ext: "mp4",
        protocol: "https",
        vcodec: null,
        acodec: null,
        audio_ext: "none",
        height: 2160,
        tbr: 25128,
        url: progressiveUrl
      },
      {
        format_id: "hls-15068",
        ext: "mp4",
        protocol: "m3u8_native",
        vcodec: "avc1.64001F",
        acodec: "none",
        audio_ext: "none",
        height: 2160,
        tbr: 15068,
        url: "https://video.twimg.com/video/pl/avc1/3840x2160/video.m3u8"
      }
    ]
  }, "video", 1);

  assert.equal(plan.payload.formatSelector, "http-25128");
  assert.equal(plan.payload.directUrl, progressiveUrl);
  assert.equal(plan.payload.streamDirect, true);
  assert.equal(plan.item.status, "ready");
  assert.equal(plan.item.formatLabel, "2160p • mp4");

  const args = buildDownloadArgs(plan.payload, "/tmp/x-sample.mp4");
  assert.deepEqual(args.slice(args.indexOf("-f"), args.indexOf("-f") + 2), [
    "-f",
    "http-25128"
  ]);
});

test("Instagram unknown-codec progressive MP4 remains directly downloadable", () => {
  const progressiveUrl = "https://scontent.example/o1/reel.mp4";
  const plan = resolveEntryPlan({
    id: "instagram-sample",
    title: "Instagram sample",
    webpage_url: "https://www.instagram.com/reel/example/",
    formats: [
      {
        format_id: "dash-audio",
        format_note: "DASH audio",
        ext: "m4a",
        protocol: "https",
        vcodec: "none",
        acodec: "mp4a.40.5",
        audio_ext: "m4a",
        abr: 62,
        url: "https://scontent.example/o1/audio.mp4"
      },
      {
        format_id: "1",
        ext: "mp4",
        protocol: "https",
        vcodec: null,
        acodec: null,
        audio_ext: "none",
        http_headers: {
          Referer: "https://www.instagram.com/"
        },
        url: progressiveUrl
      },
      {
        format_id: "dash-video",
        format_note: "DASH video",
        ext: "mp4",
        protocol: "https",
        vcodec: "vp09.00.40.08",
        acodec: "none",
        audio_ext: "none",
        height: 1920,
        url: "https://scontent.example/o1/video.mp4"
      }
    ]
  }, "video", 1);

  assert.equal(plan.payload.formatSelector, "1");
  assert.equal(plan.payload.directUrl, progressiveUrl);
  assert.equal(plan.payload.streamDirect, true);
  assert.equal(plan.item.directUrl, "");
  assert.equal(plan.item.status, "ready");
});

test("TikTok media uses yt-dlp instead of direct CDN streaming", () => {
  const plan = resolveEntryPlan({
    id: "tiktok-sample",
    title: "TikTok sample",
    webpage_url: "https://www.tiktok.com/@example/video/123",
    formats: [
      {
        format_id: "h264_720p",
        ext: "mp4",
        protocol: "https",
        vcodec: "h264",
        acodec: "aac",
        height: 1280,
        http_headers: {
          "User-Agent": "TikTok browser agent",
          Referer: "https://www.tiktok.com/@example/video/123"
        },
        url: "https://v19-webapp-prime.us.tiktok.com/video/example"
      }
    ]
  }, "video", 1);

  assert.equal(plan.payload.formatSelector, "h264_720p");
  assert.equal(plan.payload.streamDirect, false);
  assert.equal(plan.item.status, "ready");
});
