import { spawn } from "node:child_process";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import express from "express";

const app = express();
const appDataDir = await detectAppDataDir();
const persistedSecretPath = path.join(appDataDir, "keys", "download-token.secret");
const bundledShortcutPath = path.join(process.cwd(), "public", "save-with-almightydlp.shortcut");
const downloadTokenSecret = await loadDownloadTokenSecret();
const requestedCookieFile = (process.env.COOKIE_FILE || path.join(appDataDir, "cookies", "cookies.txt")).trim();
const cookieFile = await resolveCookieFile(requestedCookieFile);

const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "0.0.0.0",
  appTitle: process.env.APP_TITLE || "AlmightyDLP",
  baseUrl: (process.env.BASE_URL || "").trim(),
  shortcutInstallUrl: normalizeUrl(process.env.SHORTCUT_INSTALL_URL || ""),
  ytDlpBinary: process.env.YTDLP_BINARY || "yt-dlp",
  ffmpegBinary: process.env.FFMPEG_BINARY || "ffmpeg",
  allowPlaylists: String(process.env.ALLOW_PLAYLISTS || "true") !== "false",
  allowPrivateUrls: String(process.env.ALLOW_PRIVATE_URLS || "false") === "true",
  defaultProfile: process.env.DEFAULT_PROFILE || "video",
  authUsername: process.env.AUTH_USERNAME || "",
  authPassword: process.env.AUTH_PASSWORD || "",
  appDataDir,
  requestedCookieFile,
  cookieFile,
  tempDir: process.env.TEMP_DIR || path.join(appDataDir, "tmp"),
  cleanupAfterMinutes: Math.max(10, Number(process.env.CLEANUP_AFTER_MINUTES || 180)),
  downloadTokenSecret
};

const jobs = new Map();
const blockedMediaAddressRanges = createBlockedMediaAddressRanges();
const IPHONE_NATIVE_FORMAT_SELECTOR = [
  "bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a]",
  "bv*[ext=mp4][vcodec^=avc1]+ba[ext=mp4]",
  "bv*[ext=mp4][vcodec^=h264]+ba[ext=m4a]",
  "bv*[ext=mp4][vcodec^=h264]+ba[ext=mp4]",
  "bv*[ext=mp4][vcodec^=hvc1]+ba[ext=m4a]",
  "bv*[ext=mp4][vcodec^=hvc1]+ba[ext=mp4]",
  "bv*[ext=mp4][vcodec^=hev1]+ba[ext=m4a]",
  "bv*[ext=mp4][vcodec^=hev1]+ba[ext=mp4]",
  "bv*[ext=mp4][vcodec^=h265]+ba[ext=m4a]",
  "bv*[ext=mp4][vcodec^=h265]+ba[ext=mp4]",
  "b[ext=mp4][vcodec^=avc1]",
  "b[ext=mp4][vcodec^=h264]",
  "b[ext=mp4][vcodec^=hvc1]",
  "b[ext=mp4][vcodec^=hev1]",
  "b[ext=mp4][vcodec^=h265]"
].join("/");
const IPHONE_VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov"]);
const IPHONE_AUDIO_EXTENSIONS = new Set(["m4a", "mp4", "aac"]);
const IPHONE_VIDEO_CODEC_PREFIXES = ["avc1", "h264", "h.264", "hvc1", "hev1", "hevc", "h265", "h.265"];
const IPHONE_AUDIO_CODEC_PREFIXES = ["mp4a", "aac"];

await fs.mkdir(config.tempDir, { recursive: true });
await fs.mkdir(path.dirname(persistedSecretPath), { recursive: true });

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  next();
});
app.use(authGuard);

app.get("/api/config", (_req, res) => {
  res.json({
    title: config.appTitle,
    shortcutAvailable: true,
    shortcutPath: "/shortcut"
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    title: config.appTitle,
    mode: "resolver",
    allowPlaylists: config.allowPlaylists,
    cookieFileConfigured: Boolean(config.requestedCookieFile),
    cookieFileAvailable: Boolean(config.cookieFile)
  });
});

app.post("/api/resolve", async (req, res) => {
  let url = "";
  try {
    url = await normalizeMediaUrl(req.body?.url);
  } catch (error) {
    return res.status(400).json({ error: error.message || "A valid media URL is required." });
  }

  const requestedProfile = String(req.body?.profile || config.defaultProfile).toLowerCase();
  const profile = ["video", "audio", "original"].includes(requestedProfile)
    ? requestedProfile
    : config.defaultProfile;

  if (!url) {
    return res.status(400).json({ error: "A valid media URL is required." });
  }

  const jobId = crypto.randomUUID();
  const job = {
    id: jobId,
    url,
    profile,
    status: "queued",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    result: null,
    error: ""
  };

  jobs.set(jobId, job);
  runResolveJob(job).catch(() => {
    // The job object is updated inside runResolveJob.
  });

  return res.status(202).json({
    job: {
      id: job.id,
      status: job.status
    }
  });
});

app.get("/api/jobs/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found." });
  }

  return res.json({
    job: {
      id: job.id,
      status: job.status,
      error: job.error,
      result: job.result
    }
  });
});

app.get("/api/download", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";

  if (!token) {
    return res.status(400).send("Missing download token.");
  }

  let payload;
  try {
    payload = verifyDownloadToken(token);
  } catch (error) {
    return res.status(400).send(error.message || "Invalid download token.");
  }

  try {
    await assertAllowedMediaUrl(payload.sourceUrl);
  } catch (error) {
    return res.status(400).send(error.message || "Invalid download URL.");
  }

  try {
    return await sendDownloadPayload(res, payload);
  } catch (error) {
    return res.status(502).send(error.message || "Could not fetch this file.");
  }
});

app.get("/api/shortcut/download", async (req, res) => {
  let url = "";
  try {
    url = await normalizeMediaUrl(req.query?.url);
  } catch (error) {
    return res.status(400).send(error.message || "A valid media URL is required.");
  }

  if (!url) {
    return res.status(400).send("A valid media URL is required.");
  }

  try {
    const metadata = await inspectUrl(url);
    const plan = resolveFirstDownloadPlan(metadata, "video");

    if (!plan) {
      return res.status(502).send("No downloadable video was found for this link.");
    }

    return await sendDownloadPayload(res, plan.payload);
  } catch (error) {
    return res.status(502).send(friendlyBackendError(error.message || "Could not save this link."));
  }
});

app.get("/shortcut", (_req, res) => {
  if (config.shortcutInstallUrl) {
    return res.redirect(302, config.shortcutInstallUrl);
  }

  res.type("application/x-apple-shortcut");
  return res.download(bundledShortcutPath, "Save with AlmightyDLP.shortcut");
});

app.use(express.static(path.join(process.cwd(), "public"), {
  extensions: ["html"]
}));

app.use((_req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

setInterval(cleanOldJobs, 5 * 60 * 1000).unref();

app.listen(config.port, config.host, () => {
  console.log(`${config.appTitle} listening on http://${config.host}:${config.port}`);
});

async function runResolveJob(job) {
  job.status = "running";
  job.updatedAt = Date.now();

  try {
    const metadata = await inspectUrl(job.url);
    job.result = resolveMetadata(metadata, job.profile);
    job.status = "completed";
  } catch (error) {
    job.error = friendlyBackendError(error.message || "Unable to get links.");
    job.status = "failed";
  } finally {
    job.updatedAt = Date.now();
  }
}

async function inspectUrl(url) {
  const stdout = await runCommand(config.ytDlpBinary, buildInspectArgs(url));
  return JSON.parse(stdout);
}

async function sendDownloadPayload(res, payload) {
  await assertAllowedMediaUrl(payload.sourceUrl);

  let tempRoot = "";

  try {
    tempRoot = await createDownloadTempRoot();
    const outputTemplate = path.join(tempRoot, payload.filename);

    await runCommand(config.ytDlpBinary, buildDownloadArgs(payload, outputTemplate), {
      captureStdout: false
    });

    const resolvedFile = await findFirstFile(tempRoot);

    if (!resolvedFile) {
      return res.status(502).send("Could not fetch this file.");
    }

    const absolutePath = path.join(tempRoot, resolvedFile);
    res.on("finish", () => {
      fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    });
    res.on("close", () => {
      fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    });

    return res.download(absolutePath, resolvedFile);
  } catch (error) {
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
    return res.status(502).send(error.message || "Could not fetch this file.");
  }
}

async function detectAppDataDir() {
  const configured = (process.env.APPDATA_DIR || "").trim();
  if (configured) {
    await fs.mkdir(configured, { recursive: true });
    return configured;
  }

  const unraidDefault = "/config";
  try {
    await fs.mkdir(unraidDefault, { recursive: true });
    return unraidDefault;
  } catch {
    const localDefault = path.join(process.cwd(), "data");
    await fs.mkdir(localDefault, { recursive: true });
    return localDefault;
  }
}

async function loadDownloadTokenSecret() {
  const configured = (process.env.DOWNLOAD_TOKEN_SECRET || "").trim();
  if (configured) {
    return configured;
  }

  try {
    const existing = (await fs.readFile(persistedSecretPath, "utf8")).trim();
    if (existing) {
      return existing;
    }
  } catch {
    // Ignore missing file and create a new secret below.
  }

  const generated = crypto.randomBytes(32).toString("hex");
  await fs.mkdir(path.dirname(persistedSecretPath), { recursive: true });
  await fs.writeFile(persistedSecretPath, `${generated}\n`, { mode: 0o600 });
  return generated;
}

async function resolveCookieFile(cookieFilePath) {
  if (!cookieFilePath) {
    return "";
  }

  try {
    const stats = await fs.stat(cookieFilePath);
    return stats.isFile() ? cookieFilePath : "";
  } catch {
    return "";
  }
}

async function normalizeMediaUrl(value) {
  const url = normalizeUrl(value);
  if (!url) {
    return "";
  }

  await assertAllowedMediaUrl(url);
  return url;
}

async function assertAllowedMediaUrl(value) {
  const parsed = parseHttpUrl(value);
  if (!parsed) {
    throw new Error("A valid media URL is required.");
  }

  if (config.allowPrivateUrls) {
    return;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (isLocalHostname(hostname)) {
    throw new Error("Private or local network URLs are not allowed.");
  }

  const directIpVersion = net.isIP(hostname);
  if (directIpVersion) {
    if (isBlockedMediaAddress(hostname, directIpVersion)) {
      throw new Error("Private or local network URLs are not allowed.");
    }
    return;
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("This media URL could not be resolved.");
  }

  if (!addresses.length || addresses.some(({ address, family }) => isBlockedMediaAddress(address, family))) {
    throw new Error("Private or local network URLs are not allowed.");
  }
}

function parseHttpUrl(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized);
  } catch {
    return null;
  }
}

function isLocalHostname(hostname) {
  return hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local");
}

function createBlockedMediaAddressRanges() {
  const blockList = new net.BlockList();

  [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4]
  ].forEach(([address, prefix]) => blockList.addSubnet(address, prefix, "ipv4"));

  [
    ["::", 128],
    ["::1", 128],
    ["64:ff9b::", 96],
    ["100::", 64],
    ["2001::", 32],
    ["2001:db8::", 32],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8]
  ].forEach(([address, prefix]) => blockList.addSubnet(address, prefix, "ipv6"));

  return blockList;
}

function isBlockedMediaAddress(address, family) {
  const type = family === 4 ? "ipv4" : "ipv6";
  if (type === "ipv6" && address.toLowerCase().startsWith("::ffff:")) {
    const mappedAddress = address.slice("::ffff:".length);
    if (net.isIP(mappedAddress) === 4) {
      return blockedMediaAddressRanges.check(mappedAddress, "ipv4");
    }
  }

  return blockedMediaAddressRanges.check(address, type);
}

async function createDownloadTempRoot() {
  await fs.mkdir(config.tempDir, { recursive: true });
  return fs.mkdtemp(path.join(config.tempDir, "download-"));
}

async function findFirstFile(dir) {
  const files = await fs.readdir(dir);

  for (const file of files) {
    const absolutePath = path.join(dir, file);
    const stats = await fs.stat(absolutePath).catch(() => null);

    if (stats?.isFile()) {
      return file;
    }
  }

  return "";
}

function resolveMetadata(metadata, profile) {
  const source = summarizeMetadata(metadata);
  const entries = normalizeEntries(metadata);
  const items = entries.map((entry, index) => resolveEntry(entry, profile, index + 1));
  const simpleLinkItems = items.filter((item) => item.directUrl);
  const downloadableItems = items.filter((item) => item.downloadUrl);
  const unresolvedItems = items.filter((item) => !item.downloadUrl);

  return {
    profile,
    source,
    items,
    readyCount: downloadableItems.length,
    simpleLinkCount: simpleLinkItems.length,
    unresolvedCount: unresolvedItems.length,
    copyText: simpleLinkItems.map((item) => item.directUrl).join("\n"),
    fallbackSummary: buildFallbackSummary(simpleLinkItems.length, downloadableItems.length, unresolvedItems.length)
  };
}

function resolveEntry(entry, profile, index) {
  return resolveEntryPlan(entry, profile, index).item;
}

function resolveFirstDownloadPlan(metadata, profile) {
  const entries = normalizeEntries(metadata);
  for (const [index, entry] of entries.entries()) {
    const plan = resolveEntryPlan(entry, profile, index + 1);
    if (plan.payload) {
      return plan;
    }
  }

  return null;
}

function resolveEntryPlan(entry, profile, index) {
  const formats = Array.isArray(entry.formats) ? entry.formats : [];
  const directSourceUrl = typeof entry.url === "string" ? entry.url : "";
  const progressiveFormats = formats.filter((format) => isUsableUrl(format.url) && hasAudioAndVideo(format));
  const audioFormats = formats.filter((format) => isUsableUrl(format.url) && isAudioOnly(format));
  const videoOnlyFormats = formats.filter((format) => isUsableUrl(format.url) && hasVideoOnly(format));
  const videoCandidate = chooseVideoDownloadCandidate({
    progressiveFormats,
    audioFormats,
    videoOnlyFormats
  });
  const directCandidate = chooseDirectCandidate({
    profile,
    entry,
    directSourceUrl,
    progressiveFormats,
    audioFormats,
    videoOnlyFormats
  });

  const sourceUrl = entry.webpage_url || entry.original_url || directSourceUrl || "";
  const title = entry.title || `Item ${index}`;
  const downloadCandidate = profile === "video" ? videoCandidate || directCandidate : directCandidate;
  const ext = downloadCandidate?.ext || defaultExtensionForProfile(profile);
  const payload = sourceUrl ? buildDownloadPayload(sourceUrl, title, ext, profile, downloadCandidate) : null;
  const downloadUrl = payload ? buildDownloadUrl(payload) : "";
  const exposedDirectUrl = canExposeDirectUrl(downloadCandidate, directCandidate) ? directCandidate.url : "";
  const needsProcessing = Boolean(downloadUrl) && (!downloadCandidate || Boolean(downloadCandidate.needsProcessing));

  return {
    payload,
    item: {
      index,
      id: entry.id || "",
      title,
      sourceUrl,
      webpageUrl: entry.webpage_url || sourceUrl,
      duration: entry.duration || null,
      extractor: entry.extractor_key || entry.extractor || "",
      directUrl: exposedDirectUrl,
      downloadUrl,
      fileExtension: ext,
      formatLabel: downloadCandidate?.label || directCandidate?.label || "",
      status: downloadUrl ? (needsProcessing ? "processing-required" : "ready") : "unavailable",
      reason: downloadUrl ? "" : explainFallback(formats, profile, directSourceUrl)
    }
  };
}

function chooseVideoDownloadCandidate({ progressiveFormats, audioFormats, videoOnlyFormats }) {
  return choosePreferredNativeCandidate(
    chooseNativeIphoneMergedCandidate(videoOnlyFormats, audioFormats),
    chooseNativeIphoneProgressiveCandidate(progressiveFormats)
  );
}

function choosePreferredNativeCandidate(mergedCandidate, progressiveCandidate) {
  if (!mergedCandidate) {
    return progressiveCandidate || null;
  }

  if (!progressiveCandidate) {
    return mergedCandidate;
  }

  if (progressiveCandidate.height !== mergedCandidate.height) {
    return [mergedCandidate, progressiveCandidate].sort(compareCandidates)[0];
  }

  if (!progressiveCandidate.needsProcessing) {
    return progressiveCandidate;
  }

  return mergedCandidate;
}

function chooseNativeIphoneMergedCandidate(videoOnlyFormats, audioFormats) {
  const video = rankFormats(videoOnlyFormats.filter(isIphoneCompatibleVideoFormat))[0];
  const audio = rankFormats(audioFormats.filter(isIphoneCompatibleAudioFormat))[0];

  if (!video || !audio) {
    return null;
  }

  return {
    ext: "mp4",
    label: `${video.label} + ${audio.label || "audio"}`,
    needsProcessing: true,
    formatSelector: buildFormatPairSelector(video, audio) || IPHONE_NATIVE_FORMAT_SELECTOR,
    height: video.height,
    score: video.score + audio.score
  };
}

function chooseNativeIphoneProgressiveCandidate(progressiveFormats) {
  const format = rankFormats(progressiveFormats.filter(isIphoneCompatibleProgressiveFormat))[0];

  if (!format) {
    return null;
  }

  return {
    url: format.url,
    ext: "mp4",
    label: format.label,
    needsProcessing: !isSimpleDownloadFormat(format),
    formatSelector: buildSingleFormatSelector(format) || IPHONE_NATIVE_FORMAT_SELECTOR,
    height: format.height,
    score: format.score
  };
}

function chooseDirectCandidate({ profile, entry, directSourceUrl, progressiveFormats, audioFormats, videoOnlyFormats }) {
  if (profile === "audio") {
    return rankFormats(audioFormats.filter(isSimpleDownloadFormat))[0]
      || directEntryCandidate(entry, directSourceUrl, "audio")
      || null;
  }

  if (profile === "video") {
    return rankFormats(progressiveFormats.filter((format) => (
      isIphoneCompatibleProgressiveFormat(format) && isSimpleDownloadFormat(format)
    )))[0]
      || directEntryCandidate(entry, directSourceUrl, "video", { iphoneCompatibleOnly: true })
      || null;
  }

  if (isUsableUrl(directSourceUrl)) {
    return {
      url: directSourceUrl,
      ext: String(entry.ext || "").toLowerCase(),
      label: "Direct file"
    };
  }

  return rankFormats(progressiveFormats)[0]
    || rankFormats(audioFormats)[0]
    || rankFormats(videoOnlyFormats)[0]
    || null;
}

function canExposeDirectUrl(downloadCandidate, directCandidate) {
  return Boolean(downloadCandidate?.url && directCandidate?.url && downloadCandidate.url === directCandidate.url);
}

function directEntryCandidate(entry, directSourceUrl, profile, options = {}) {
  if (!isUsableUrl(directSourceUrl)) {
    return null;
  }

  const ext = String(entry.ext || "").toLowerCase();
  const audioExts = new Set(["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"]);
  const videoExts = new Set(["mp4", "mkv", "webm", "mov", "m4v"]);

  if (profile === "audio" && !audioExts.has(ext)) {
    return null;
  }

  if (profile === "video" && !videoExts.has(ext)) {
    return null;
  }

  if (profile === "video" && options.iphoneCompatibleOnly && !isIphoneCompatibleDirectEntry(entry, ext)) {
    return null;
  }

  return {
    url: directSourceUrl,
    ext,
    label: ext ? `Direct file • ${ext}` : "Direct file"
  };
}

function summarizeMetadata(metadata) {
  const entries = normalizeEntries(metadata);
  const firstEntry = entries[0] || metadata;

  return {
    id: metadata.id || firstEntry?.id || "",
    title: metadata.title || firstEntry?.title || "Untitled media",
    extractor: metadata.extractor_key || metadata.extractor || firstEntry?.extractor_key || "",
    uploader: metadata.uploader || firstEntry?.uploader || "",
    duration: metadata.duration || firstEntry?.duration || null,
    thumbnail: metadata.thumbnail || firstEntry?.thumbnail || "",
    isPlaylist: entries.length > 1 || Boolean(metadata._type === "playlist"),
    itemCount: entries.length || 1,
    webpageUrl: metadata.webpage_url || firstEntry?.webpage_url || ""
  };
}

function normalizeEntries(metadata) {
  if (Array.isArray(metadata.entries) && metadata.entries.length > 0) {
    return metadata.entries.filter(Boolean);
  }

  return [metadata];
}

function rankFormats(formats) {
  return [...formats]
    .map((format) => ({
      url: format.url,
      ext: String(format.ext || "").toLowerCase(),
      formatId: String(format.format_id || ""),
      height: Number(format.height || 0),
      vcodec: String(format.vcodec || ""),
      acodec: String(format.acodec || ""),
      protocol: String(format.protocol || ""),
      label: buildFormatLabel(format),
      score: formatScore(format)
    }))
    .sort((a, b) => b.score - a.score);
}

function buildFormatLabel(format) {
  const parts = [
    format.height ? `${format.height}p` : "",
    format.format_note || "",
    format.ext || ""
  ].filter(Boolean);

  return [...new Set(parts)].join(" • ");
}

function formatScore(format) {
  const height = Number(format.height || 0);
  const abr = Number(format.abr || 0);
  const tbr = Number(format.tbr || 0);
  return height * 1000 + abr * 10 + tbr;
}

function compareCandidates(a, b) {
  return Number(b.height || 0) - Number(a.height || 0)
    || Number(b.score || 0) - Number(a.score || 0);
}

function buildSingleFormatSelector(format) {
  return format?.formatId || "";
}

function buildFormatPairSelector(video, audio) {
  if (!video?.formatId || !audio?.formatId) {
    return "";
  }

  return `${video.formatId}+${audio.formatId}`;
}

function isIphoneCompatibleProgressiveFormat(format) {
  return hasAudioAndVideo(format)
    && isIphoneCompatibleVideoFormat(format)
    && isIphoneCompatibleAudioFormat(format);
}

function isIphoneCompatibleVideoFormat(format) {
  const ext = String(format.ext || "").toLowerCase();
  const codec = normalizeCodec(format.vcodec);
  return IPHONE_VIDEO_EXTENSIONS.has(ext)
    && codec !== "none"
    && startsWithAny(codec, IPHONE_VIDEO_CODEC_PREFIXES);
}

function isIphoneCompatibleAudioFormat(format) {
  const ext = audioExtension(format);
  const codec = inferAudioCodec(format);
  return IPHONE_AUDIO_EXTENSIONS.has(ext)
    && codec !== "none"
    && (!codec || startsWithAny(codec, IPHONE_AUDIO_CODEC_PREFIXES));
}

function isIphoneCompatibleDirectEntry(entry, ext) {
  if (!IPHONE_VIDEO_EXTENSIONS.has(ext)) {
    return false;
  }

  const vcodec = normalizeCodec(entry.vcodec);
  const acodec = normalizeCodec(entry.acodec);
  const videoCompatible = !vcodec || vcodec === "none" || startsWithAny(vcodec, IPHONE_VIDEO_CODEC_PREFIXES);
  const audioCompatible = !acodec || acodec === "none" || startsWithAny(acodec, IPHONE_AUDIO_CODEC_PREFIXES);
  return videoCompatible && audioCompatible;
}

function normalizeCodec(value) {
  return String(value || "").trim().toLowerCase();
}

function audioExtension(format) {
  const audioExt = String(format.audio_ext || "").toLowerCase();
  if (audioExt && audioExt !== "none") {
    return audioExt;
  }
  if (hasExplicitAudioCodec(format)) {
    return String(format.ext || "").toLowerCase();
  }
  if (format.vcodec && format.vcodec !== "none") {
    return "";
  }
  return String(format.ext || "").toLowerCase();
}

function inferAudioCodec(format) {
  const codec = normalizeCodec(format.acodec);
  if (codec) {
    return codec;
  }

  const url = String(format.url || "").toLowerCase();
  if (url.includes("/mp4a/") || url.includes("mp4a.")) {
    return "mp4a";
  }
  if (url.includes("/aac/") || url.includes(".aac")) {
    return "aac";
  }

  return "";
}

function startsWithAny(value, prefixes) {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function isSimpleDownloadFormat(format) {
  const protocol = String(format.protocol || "").toLowerCase();
  const url = String(format.url || "").toLowerCase();
  return !protocol.includes("m3u8")
    && !protocol.includes("dash")
    && !url.includes(".m3u8")
    && !url.includes("/manifest/hls");
}

function hasAudioAndVideo(format) {
  return format.vcodec && format.vcodec !== "none" && hasAudioTrack(format);
}

function hasVideoOnly(format) {
  return format.vcodec && format.vcodec !== "none" && !hasAudioTrack(format);
}

function isAudioOnly(format) {
  return (!format.vcodec || format.vcodec === "none") && hasAudioTrack(format);
}

function hasAudioTrack(format) {
  if (hasExplicitAudioCodec(format)) {
    return true;
  }

  const audioExt = audioExtension(format);
  return Boolean(audioExt && audioExt !== "none");
}

function hasExplicitAudioCodec(format) {
  const codec = normalizeCodec(format.acodec);
  return Boolean(codec && codec !== "none");
}

function explainFallback(formats, profile, directSourceUrl) {
  if (profile === "video" && formats.some(hasVideoOnly) && formats.some(isAudioOnly)) {
    return "This site split the video and audio into separate streams.";
  }

  if (!directSourceUrl && !formats.length) {
    return "This site did not share any usable media links.";
  }

  return "This site did not give us a simple saveable link for this item.";
}

function buildFallbackSummary(simpleLinkCount, downloadableCount, unresolvedCount) {
  if (unresolvedCount > 0) {
    return "Some items could not be prepared. Private or protected posts often need login cookies before they can be saved.";
  }

  if (downloadableCount > simpleLinkCount) {
    return "Some items need extra processing before they can be saved as a single file.";
  }

  return "";
}

function buildDownloadPayload(sourceUrl, title, ext, profile, candidate = {}) {
  return {
    sourceUrl,
    filename: sanitizeFilename(title, ext),
    profile,
    formatSelector: candidate?.formatSelector || ""
  };
}

function buildDownloadUrl(payload) {
  const token = signDownloadToken({
    sourceUrl: payload.sourceUrl,
    filename: payload.filename,
    profile: payload.profile,
    formatSelector: payload.formatSelector || ""
  });
  const suffix = `/api/download?token=${encodeURIComponent(token)}`;
  return config.baseUrl ? new URL(suffix, config.baseUrl).toString() : suffix;
}

function signDownloadToken(payload) {
  const body = Buffer.from(JSON.stringify({
    ...payload,
    exp: Date.now() + (60 * 60 * 1000)
  })).toString("base64url");
  const sig = crypto
    .createHmac("sha256", config.downloadTokenSecret)
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

function verifyDownloadToken(token) {
  const [body, sig] = token.split(".");
  if (!body || !sig) {
    throw new Error("Invalid download token.");
  }

  const expected = crypto
    .createHmac("sha256", config.downloadTokenSecret)
    .update(body)
    .digest("base64url");

  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error("Invalid download token.");
  }

  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!payload.exp || Date.now() > payload.exp) {
    throw new Error("Download link expired.");
  }
  if (!isUsableUrl(payload.sourceUrl)) {
    throw new Error("Invalid download URL.");
  }
  payload.formatSelector = typeof payload.formatSelector === "string" ? payload.formatSelector : "";

  return payload;
}

function sanitizeFilename(title, ext) {
  const safeTitle = String(title || "media")
    .replace(/[^a-z0-9._ -]+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "media";
  const safeExt = String(ext || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return safeExt ? `${safeTitle}.${safeExt}` : safeTitle;
}

function defaultExtensionForProfile(profile) {
  if (profile === "audio") {
    return "mp3";
  }
  return "mp4";
}

function buildInspectArgs(url) {
  const args = [
    "--dump-single-json",
    "--skip-download",
    "--no-warnings"
  ];

  if (config.allowPlaylists) {
    args.push("--yes-playlist");
  } else {
    args.push("--no-playlist");
  }

  if (config.cookieFile) {
    args.push("--cookies", config.cookieFile);
  }

  args.push(url);
  return args;
}

function buildDownloadArgs(payload, outputTemplate) {
  const args = [
    "--no-warnings",
    "--no-progress",
    "--restrict-filenames",
    "--no-playlist",
    "-o",
    outputTemplate
  ];

  if (shouldPassFfmpegLocation(config.ffmpegBinary)) {
    args.push("--ffmpeg-location", config.ffmpegBinary);
  }

  if (config.cookieFile) {
    args.push("--cookies", config.cookieFile);
  }

  if (payload.profile === "audio") {
    args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
  } else if (payload.profile === "video") {
    args.push("-f", payload.formatSelector || IPHONE_NATIVE_FORMAT_SELECTOR, "--merge-output-format", "mp4");
  } else {
    args.push("-f", "b");
  }

  args.push(payload.sourceUrl);
  return args;
}

function shouldPassFfmpegLocation(value) {
  return Boolean(value && (path.isAbsolute(value) || value.includes(path.sep)));
}

async function runCommand(command, args, options = {}) {
  const { captureStdout = true } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env });
    let stdout = "";
    let stderr = "";

    if (captureStdout) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
    }

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(friendlyBackendError(stderr.trim() || `${command} exited with code ${code}.`)));
      }
    });
  });
}

function cleanOldJobs() {
  const cutoff = Date.now() - (config.cleanupAfterMinutes * 60 * 1000);

  for (const [jobId, job] of jobs.entries()) {
    if (job.updatedAt < cutoff && job.status !== "running") {
      jobs.delete(jobId);
    }
  }
}

function friendlyBackendError(message) {
  if (!message) {
    return "Could not get links.";
  }

  if (message.includes("[TikTok]") && message.includes("status code 10231")) {
    return "TikTok is blocking us from downloading this video.";
  }

  if (message.includes("Instagram sent an empty media response")) {
    return "Instagram did not share the media file. A cookie file may be required for reels or protected posts.";
  }

  if (message.includes("You are not authorized")) {
    return "This post is protected and cannot be accessed without login cookies.";
  }

  if (message.includes("Requested format is not available")) {
    return "This site did not provide the kind of file you asked for.";
  }

  return message;
}

function authGuard(req, res, next) {
  if (!config.authUsername && !config.authPassword) {
    return next();
  }

  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="AlmightyDLP"');
    return res.status(401).send("Authentication required.");
  }

  const encoded = authHeader.slice("Basic ".length);
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");
  const username = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : "";
  const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : "";

  if (username !== config.authUsername || password !== config.authPassword) {
    res.setHeader("WWW-Authenticate", 'Basic realm="AlmightyDLP"');
    return res.status(401).send("Invalid credentials.");
  }

  return next();
}

function normalizeUrl(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = extractFirstHttpUrl(value.trim());
  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

function extractFirstHttpUrl(value) {
  const match = value.match(/https?:\/\/[^\s<>"']+/i);
  const candidate = match ? match[0] : value;
  return candidate.replace(/[)\].,!?;:]+$/g, "");
}

function isUsableUrl(value) {
  if (typeof value !== "string" || !value) {
    return false;
  }

  return value.startsWith("http://") || value.startsWith("https://");
}
