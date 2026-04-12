import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import express from "express";

const app = express();

const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "0.0.0.0",
  appTitle: process.env.APP_TITLE || "AllMightyDLP",
  baseUrl: (process.env.BASE_URL || "").trim(),
  ytDlpBinary: process.env.YTDLP_BINARY || "yt-dlp",
  allowPlaylists: String(process.env.ALLOW_PLAYLISTS || "true") !== "false",
  defaultProfile: process.env.DEFAULT_PROFILE || "video",
  authUsername: process.env.AUTH_USERNAME || "",
  authPassword: process.env.AUTH_PASSWORD || ""
};

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

app.post("/api/resolve", async (req, res) => {
  const url = normalizeUrl(req.body?.url);
  const requestedProfile = String(req.body?.profile || config.defaultProfile).toLowerCase();
  const profile = ["video", "audio", "original"].includes(requestedProfile)
    ? requestedProfile
    : config.defaultProfile;

  if (!url) {
    return res.status(400).json({ error: "A valid media URL is required." });
  }

  try {
    const metadata = await inspectUrl(url);
    const result = resolveMetadata(metadata, profile);
    return res.json({ result });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unable to resolve media links." });
  }
});

app.use(express.static(path.join(process.cwd(), "public"), {
  extensions: ["html"]
}));

app.use((_req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

app.listen(config.port, config.host, () => {
  console.log(`${config.appTitle} listening on http://${config.host}:${config.port}`);
});

async function inspectUrl(url) {
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

  args.push(url);

  const stdout = await runCommand(config.ytDlpBinary, args);
  return JSON.parse(stdout);
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

function resolveMetadata(metadata, profile) {
  const source = summarizeMetadata(metadata);
  const entries = normalizeEntries(metadata);
  const items = entries.map((entry, index) => resolveEntry(entry, profile, index + 1));
  const resolvedItems = items.filter((item) => item.status === "resolved");
  const unresolvedItems = items.filter((item) => item.status !== "resolved");

  return {
    profile,
    source,
    items,
    resolvedCount: resolvedItems.length,
    unresolvedCount: unresolvedItems.length,
    copyText: resolvedItems.map((item) => item.directUrl).join("\n"),
    requiresBackendDownload: unresolvedItems.length > 0,
    fallbackSummary: unresolvedItems.length > 0
      ? "Some items do not expose a stable single-file direct link. Those sources would require backend downloading or merging to support them reliably."
      : ""
  };
}

function resolveEntry(entry, profile, index) {
  const formats = Array.isArray(entry.formats) ? entry.formats : [];
  const directSourceUrl = typeof entry.url === "string" ? entry.url : "";
  const progressiveFormats = formats.filter((format) => isUsableUrl(format.url) && hasAudioAndVideo(format));
  const audioFormats = formats.filter((format) => isUsableUrl(format.url) && isAudioOnly(format));
  const directCandidate = chooseDirectCandidate({
    profile,
    entry,
    directSourceUrl,
    progressiveFormats,
    audioFormats
  });

  const webpageUrl = entry.webpage_url || "";
  const title = entry.title || `Item ${index}`;
  const item = {
    index,
    id: entry.id || "",
    title,
    webpageUrl,
    duration: entry.duration || null,
    extractor: entry.extractor_key || entry.extractor || "",
    directUrl: directCandidate?.url || "",
    fileExtension: directCandidate?.ext || "",
    formatLabel: directCandidate?.label || "",
    status: directCandidate ? "resolved" : "backend-required",
    reason: directCandidate ? "" : explainFallback(formats, profile, directSourceUrl)
  };

  return item;
}

function chooseDirectCandidate({ profile, entry, directSourceUrl, progressiveFormats, audioFormats }) {
  if (profile === "audio") {
    return rankFormats(audioFormats)[0] || directEntryCandidate(entry, directSourceUrl, "audio") || null;
  }

  if (profile === "video") {
    return rankFormats(progressiveFormats)[0] || directEntryCandidate(entry, directSourceUrl, "video") || null;
  }

  if (isUsableUrl(directSourceUrl)) {
    return {
      url: directSourceUrl,
      ext: "",
      label: "Extractor URL"
    };
  }

  return rankFormats(progressiveFormats)[0] || rankFormats(audioFormats)[0] || null;
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

function explainFallback(formats, profile, directSourceUrl) {
  if (profile === "video" && formats.some(hasVideoOnly) && formats.some(isAudioOnly)) {
    return "Best quality is split into separate video and audio streams, so a server-side merge would be needed.";
  }

  if (!directSourceUrl && !formats.length) {
    return "This extractor did not expose direct media URLs through yt-dlp.";
  }

  return "This source does not appear to expose a stable direct file URL for the selected mode.";
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
    format.format_note || "",
    format.format || "",
    format.ext || ""
  ].filter(Boolean).join(" • ");
}

function formatScore(format) {
  const height = Number(format.height || 0);
  const abr = Number(format.abr || 0);
  const tbr = Number(format.tbr || 0);
  return height * 1000 + abr * 10 + tbr;
}

function normalizeEntries(metadata) {
  if (Array.isArray(metadata.entries) && metadata.entries.length > 0) {
    return metadata.entries.filter(Boolean);
  }

  return [metadata];
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

function isUsableUrl(value) {
  if (typeof value !== "string" || !value) {
    return false;
  }

  return value.startsWith("http://") || value.startsWith("https://");
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
