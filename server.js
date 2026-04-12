import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import express from "express";

const app = express();
const appDataDir = await detectAppDataDir();
const persistedSecretPath = path.join(appDataDir, "keys", "download-token.secret");
const downloadTokenSecret = await loadDownloadTokenSecret();

const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "0.0.0.0",
  appTitle: process.env.APP_TITLE || "AlmightyDLP",
  baseUrl: (process.env.BASE_URL || "").trim(),
  ytDlpBinary: process.env.YTDLP_BINARY || "yt-dlp",
  ffmpegBinary: process.env.FFMPEG_BINARY || "ffmpeg",
  allowPlaylists: String(process.env.ALLOW_PLAYLISTS || "true") !== "false",
  defaultProfile: process.env.DEFAULT_PROFILE || "video",
  authUsername: process.env.AUTH_USERNAME || "",
  authPassword: process.env.AUTH_PASSWORD || "",
  appDataDir,
  cookieFile: (process.env.COOKIE_FILE || path.join(appDataDir, "cookies", "cookies.txt")).trim(),
  tempDir: process.env.TEMP_DIR || path.join(appDataDir, "tmp"),
  cleanupAfterMinutes: Math.max(10, Number(process.env.CLEANUP_AFTER_MINUTES || 180)),
  downloadTokenSecret
};

const jobs = new Map();

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

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    title: config.appTitle,
    mode: "resolver",
    allowPlaylists: config.allowPlaylists,
    cookieFileConfigured: Boolean(config.cookieFile)
  });
});

app.post("/api/resolve", (req, res) => {
  const url = normalizeUrl(req.body?.url);
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

  const tempRoot = await fs.mkdtemp(path.join(config.tempDir, "download-"));
  const outputTemplate = path.join(tempRoot, payload.filename);

  try {
    await runCommand(config.ytDlpBinary, buildDownloadArgs(payload, outputTemplate), {
      captureStdout: false
    });

    const files = await fs.readdir(tempRoot);
    const resolvedFile = files.find(Boolean);

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
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    return res.status(502).send(error.message || "Could not fetch this file.");
  }
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
  const formats = Array.isArray(entry.formats) ? entry.formats : [];
  const directSourceUrl = typeof entry.url === "string" ? entry.url : "";
  const progressiveFormats = formats.filter((format) => isUsableUrl(format.url) && hasAudioAndVideo(format));
  const audioFormats = formats.filter((format) => isUsableUrl(format.url) && isAudioOnly(format));
  const videoOnlyFormats = formats.filter((format) => isUsableUrl(format.url) && hasVideoOnly(format));
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
  const ext = directCandidate?.ext || defaultExtensionForProfile(profile);
  const downloadUrl = sourceUrl ? buildDownloadUrl(sourceUrl, title, ext, profile) : "";
  const needsProcessing = !directCandidate && Boolean(downloadUrl);

  return {
    index,
    id: entry.id || "",
    title,
    sourceUrl,
    webpageUrl: entry.webpage_url || sourceUrl,
    duration: entry.duration || null,
    extractor: entry.extractor_key || entry.extractor || "",
    directUrl: directCandidate?.url || "",
    downloadUrl,
    fileExtension: ext,
    formatLabel: directCandidate?.label || "",
    status: downloadUrl ? (needsProcessing ? "processing-required" : "ready") : "unavailable",
    reason: downloadUrl ? "" : explainFallback(formats, profile, directSourceUrl)
  };
}

function chooseDirectCandidate({ profile, entry, directSourceUrl, progressiveFormats, audioFormats, videoOnlyFormats }) {
  if (profile === "audio") {
    return rankFormats(audioFormats)[0] || directEntryCandidate(entry, directSourceUrl, "audio") || null;
  }

  if (profile === "video") {
    return rankFormats(progressiveFormats)[0]
      || directEntryCandidate(entry, directSourceUrl, "video")
      || rankFormats(videoOnlyFormats)[0]
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

function directEntryCandidate(entry, directSourceUrl, profile) {
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
      ext: format.ext || "",
      label: buildFormatLabel(format),
      score: formatScore(format)
    }))
    .sort((a, b) => b.score - a.score);
}

function buildFormatLabel(format) {
  return [
    format.height ? `${format.height}p` : "",
    format.format_note || "",
    format.ext || ""
  ].filter(Boolean).join(" • ");
}

function formatScore(format) {
  const height = Number(format.height || 0);
  const abr = Number(format.abr || 0);
  const tbr = Number(format.tbr || 0);
  return height * 1000 + abr * 10 + tbr;
}

function hasAudioAndVideo(format) {
  return format.vcodec && format.vcodec !== "none" && format.acodec && format.acodec !== "none";
}

function hasVideoOnly(format) {
  return format.vcodec && format.vcodec !== "none" && (!format.acodec || format.acodec === "none");
}

function isAudioOnly(format) {
  return (!format.vcodec || format.vcodec === "none") && format.acodec && format.acodec !== "none";
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

function buildDownloadUrl(sourceUrl, title, ext, profile) {
  const filename = sanitizeFilename(title, ext);
  const token = signDownloadToken({
    sourceUrl,
    filename,
    profile
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
    "--ffmpeg-location",
    config.ffmpegBinary,
    "-o",
    outputTemplate
  ];

  if (config.cookieFile) {
    args.push("--cookies", config.cookieFile);
  }

  if (payload.profile === "audio") {
    args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
  } else if (payload.profile === "video") {
    args.push("-f", "b/bv*+ba/b");
  } else {
    args.push("-f", "b");
  }

  args.push(payload.sourceUrl);
  return args;
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

  const trimmed = value.trim();
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

function isUsableUrl(value) {
  if (typeof value !== "string" || !value) {
    return false;
  }

  return value.startsWith("http://") || value.startsWith("https://");
}
