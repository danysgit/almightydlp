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

test("X split streams pair the actual audio rendition with video", () => {
  const plan = resolveEntryPlan({
    id: "x-sample",
    title: "X sample",
    webpage_url: "https://x.com/example/status/1",
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
        format_id: "hls-588",
        ext: "mp4",
        protocol: "m3u8_native",
        vcodec: "avc1.64001F",
        acodec: "none",
        audio_ext: "none",
        height: 600,
        tbr: 588,
        url: "https://video.twimg.com/video/pl/avc1/720x600/video.m3u8"
      }
    ]
  }, "video", 1);

  assert.equal(plan.payload.formatSelector, "hls-588+hls-audio-128000-Audio");
  assert.equal(plan.payload.streamDirect, false);
  assert.equal(plan.item.status, "processing-required");

  const args = buildDownloadArgs(plan.payload, "/tmp/x-sample.mp4");
  assert.deepEqual(args.slice(args.indexOf("-f"), args.indexOf("-f") + 2), [
    "-f",
    "hls-588+hls-audio-128000-Audio"
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
