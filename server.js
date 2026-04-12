import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import archiver from "archiver";
import express from "express";

const app = express();

const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "0.0.0.0",
  appTitle: process.env.APP_TITLE || "AllMightyDLP",
  baseUrl: (process.env.BASE_URL || "").trim(),
  dataDir: path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data")),
  downloadDir: path.resolve(process.env.DOWNLOAD_DIR || path.join(process.cwd(), "downloads")),
  tempDir: path.resolve(process.env.TEMP_DIR || path.join(process.cwd(), "tmp")),
  ytDlpBinary: process.env.YTDLP_BINARY || "yt-dlp",
  ffmpegBinary: process.env.FFMPEG_BINARY || "ffmpeg",
  maxConcurrentJobs: Math.max(1, Number(process.env.MAX_CONCURRENT_JOBS || 2)),
  cleanupAfterMinutes: Math.max(5, Number(process.env.CLEANUP_AFTER_MINUTES || 120)),
  allowPlaylists: String(process.env.ALLOW_PLAYLISTS || "true") !== "false",
  defaultProfile: process.env.DEFAULT_PROFILE || "video",
  authUsername: process.env.AUTH_USERNAME || "",
  authPassword: process.env.AUTH_PASSWORD || "",
  puid: process.env.PUID || "",
  pgid: process.env.PGID || "",
  umask: process.env.UMASK || ""
};

const jobs = new Map();
const queue = [];
let activeJobs = 0;

await ensureDir(config.dataDir);
await ensureDir(config.downloadDir);
await ensureDir(config.tempDir);

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
});
app.use(authGuard);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    title: config.appTitle,
    activeJobs,
    queuedJobs: queue.length,
    allowPlaylists: config.allowPlaylists
  });
});

app.post("/api/analyze", async (req, res) => {
  const url = normalizeUrl(req.body?.url);

  if (!url) {
    return res.status(400).json({ error: "A valid media URL is required." });
  }

  try {
    const metadata = await inspectUrl(url);
    return res.json({ metadata: summarizeMetadata(metadata) });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unable to inspect this URL." });
  }
});

app.post("/api/download", async (req, res) => {
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title: "Preparing download",
    log: [],
    files: [],
    archiveUrl: "",
    downloadCount: 0
  };

  jobs.set(jobId, job);
  queue.push(jobId);
  drainQueue();

  return res.status(202).json({ job });
});

app.get("/api/jobs/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found." });
  }

  return res.json({ job });
});

app.get("/api/file/:jobId", async (req, res) => {
  const job = jobs.get(req.params.jobId);
  const requestedPath = typeof req.query.path === "string" ? req.query.path : "";

  if (!job) {
    return res.status(404).send("Job not found.");
  }

  const normalizedPath = requestedPath.replace(/^\/+/, "");
  const absolutePath = path.resolve(config.downloadDir, job.id, normalizedPath);

  if (!absolutePath.startsWith(path.join(config.downloadDir, job.id))) {
    return res.status(400).send("Invalid file path.");
  }

  try {
    await fs.access(absolutePath);
    job.downloadCount += 1;
    job.updatedAt = new Date().toISOString();
    return res.download(absolutePath);
  } catch {
    return res.status(404).send("File not found.");
  }
});

app.get("/api/archive/:jobId", async (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).send("Job not found.");
  }

  const rootDir = path.join(config.downloadDir, job.id);

  try {
    await fs.access(rootDir);
  } catch {
    return res.status(404).send("Archive source not found.");
  }

  const safeName = sanitizeArchiveName(job.title || `${job.id}-download`);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}.zip"`);

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (error) => {
    if (!res.headersSent) {
      res.status(500).send(error.message);
    } else {
      res.destroy(error);
    }
  });

  archive.pipe(res);
  archive.directory(rootDir, false);
  await archive.finalize();
});

app.use(express.static(path.join(process.cwd(), "public"), {
  extensions: ["html"]
}));

app.use((_req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

setInterval(cleanExpiredJobs, 5 * 60 * 1000).unref();

app.listen(config.port, config.host, () => {
  console.log(`${config.appTitle} listening on http://${config.host}:${config.port}`);
});

async function inspectUrl(url) {
  const stdout = await runCommand(config.ytDlpBinary, [
    "--dump-single-json",
    "--skip-download",
    "--no-warnings",
    url
  ]);

  return JSON.parse(stdout);
}

function summarizeMetadata(metadata) {
  const entries = Array.isArray(metadata.entries) ? metadata.entries : [];
  const firstEntry = entries[0] || metadata;

  return {
    id: metadata.id || firstEntry?.id || "",
    title: metadata.title || firstEntry?.title || "Untitled media",
    extractor: metadata.extractor_key || metadata.extractor || firstEntry?.extractor_key || "",
    uploader: metadata.uploader || firstEntry?.uploader || "",
    duration: metadata.duration || firstEntry?.duration || null,
    thumbnail: metadata.thumbnail || firstEntry?.thumbnail || "",
    isPlaylist: entries.length > 0,
    itemCount: entries.length || 1,
    webpageUrl: metadata.webpage_url || firstEntry?.webpage_url || ""
  };
}

async function drainQueue() {
  if (activeJobs >= config.maxConcurrentJobs || queue.length === 0) {
    return;
  }

  const jobId = queue.shift();
  const job = jobs.get(jobId);

  if (!job) {
    return drainQueue();
  }

  activeJobs += 1;
  job.status = "running";
  job.updatedAt = new Date().toISOString();

  try {
    await executeDownload(job);
    job.status = "completed";
    job.updatedAt = new Date().toISOString();
  } catch (error) {
    job.status = "failed";
    job.updatedAt = new Date().toISOString();
    job.log.push(error.message || "Download failed.");
  } finally {
    activeJobs -= 1;
    drainQueue();
  }
}

async function executeDownload(job) {
  const jobRoot = path.join(config.downloadDir, job.id);
  const tempRoot = path.join(config.tempDir, job.id);
  await ensureDir(jobRoot);
  await ensureDir(tempRoot);

  const outputTemplate = "%(playlist_index,autonumber)02d - %(title).160B [%(id)s].%(ext)s";
  const args = [
    "--no-warnings",
    "--newline",
    "--restrict-filenames",
    "--ffmpeg-location",
    config.ffmpegBinary,
    "--paths",
    jobRoot,
    "--output",
    outputTemplate,
    "--paths",
    `temp:${tempRoot}`
  ];

  if (config.allowPlaylists) {
    args.push("--yes-playlist");
  } else {
    args.push("--no-playlist");
  }

  if (job.profile === "audio") {
    args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
  } else if (job.profile === "video") {
    args.push("-f", "bv*+ba/b");
  } else {
    args.push("-f", "b");
  }

  args.push(job.url);

  await new Promise((resolve, reject) => {
    const child = spawn(config.ytDlpBinary, args, {
      env: process.env,
      cwd: process.cwd()
    });

    child.stdout.on("data", (chunk) => {
      const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        updateJobFromLog(job, line);
      }
    });

    child.stderr.on("data", (chunk) => {
      const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        updateJobFromLog(job, line);
      }
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`yt-dlp exited with code ${code}.`));
      }
    });
  });

  job.files = await listFiles(jobRoot);
  job.archiveUrl = job.files.length > 1 ? buildArchiveUrl(job.id) : "";
  job.title = job.files[0]?.name || job.title;
}

function updateJobFromLog(job, line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  job.log = [...job.log.slice(-79), trimmed];
  job.updatedAt = new Date().toISOString();

  if (trimmed.startsWith("[download]")) {
    job.title = trimmed.replace("[download]", "").trim() || job.title;
  }
}

async function listFiles(rootDir) {
  const files = [];
  await walkDir(rootDir, async (absolutePath) => {
    const relativePath = path.relative(rootDir, absolutePath);
    const stats = await fs.stat(absolutePath);
    if (!stats.isFile()) {
      return;
    }

    files.push({
      name: path.basename(absolutePath),
      relativePath,
      sizeBytes: stats.size,
      downloadUrl: buildFileUrl(path.basename(rootDir), relativePath)
    });
  });

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function buildFileUrl(jobId, relativePath) {
  const suffix = `/api/file/${jobId}?path=${encodeURIComponent(relativePath)}`;
  return config.baseUrl ? new URL(suffix, config.baseUrl).toString() : suffix;
}

function buildArchiveUrl(jobId) {
  const suffix = `/api/archive/${jobId}`;
  return config.baseUrl ? new URL(suffix, config.baseUrl).toString() : suffix;
}

async function walkDir(currentPath, visitor) {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      await walkDir(absolutePath, visitor);
    } else {
      await visitor(absolutePath);
    }
  }
}

async function cleanExpiredJobs() {
  const now = Date.now();
  const maxAgeMs = config.cleanupAfterMinutes * 60 * 1000;

  for (const [jobId, job] of jobs.entries()) {
    const ageMs = now - new Date(job.updatedAt).getTime();
    if (job.status === "running" || ageMs < maxAgeMs) {
      continue;
    }

    jobs.delete(jobId);
    await fs.rm(path.join(config.downloadDir, jobId), { recursive: true, force: true });
    await fs.rm(path.join(config.tempDir, jobId), { recursive: true, force: true });
  }
}

async function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr.trim() || `${command} exited with code ${code}.`));
      }
    });
  });
}

function authGuard(req, res, next) {
  if (!config.authUsername && !config.authPassword) {
    return next();
  }

  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="AllMightyDLP"');
    return res.status(401).send("Authentication required.");
  }

  const encoded = authHeader.slice("Basic ".length);
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");
  const username = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : "";
  const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : "";

  if (username !== config.authUsername || password !== config.authPassword) {
    res.setHeader("WWW-Authenticate", 'Basic realm="AllMightyDLP"');
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

async function ensureDir(target) {
  await fs.mkdir(target, { recursive: true });
}

function sanitizeArchiveName(value) {
  return String(value)
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "download";
}
