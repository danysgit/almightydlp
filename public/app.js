const form = document.querySelector("#download-form");
const mediaUrl = document.querySelector("#media-url");
const profile = document.querySelector("#profile");
const inspectButton = document.querySelector("#inspect-button");
const submitButton = document.querySelector("#submit-button");
const inspectionCard = document.querySelector("#inspection-card");
const inspectionType = document.querySelector("#inspection-type");
const inspectionTitle = document.querySelector("#inspection-title");
const inspectionSubtitle = document.querySelector("#inspection-subtitle");
const inspectionThumb = document.querySelector("#inspection-thumb");
const inspectionLink = document.querySelector("#inspection-link");
const jobCard = document.querySelector("#job-card");
const jobStatus = document.querySelector("#job-status");
const jobTitle = document.querySelector("#job-title");
const jobCopy = document.querySelector("#job-copy");
const resultActions = document.querySelector("#result-actions");
const results = document.querySelector("#results");
const jobLog = document.querySelector("#job-log");

let activeJobId = "";
let pollHandle = 0;

inspectButton.addEventListener("click", () => inspectUrl());
form.addEventListener("submit", (event) => {
  event.preventDefault();
  startDownload();
});

async function inspectUrl() {
  const url = mediaUrl.value.trim();
  if (!url) {
    mediaUrl.focus();
    return;
  }

  setBusy(inspectButton, true, "Inspecting…");

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Inspection failed.");
    }

    renderInspection(payload.metadata);
  } catch (error) {
    renderInspectionError(error.message);
  } finally {
    setBusy(inspectButton, false, "Inspect");
  }
}

async function startDownload() {
  const url = mediaUrl.value.trim();
  if (!url) {
    mediaUrl.focus();
    return;
  }

  setBusy(submitButton, true, "Queueing…");
  clearPolling();
  renderJobState({
    status: "queued",
    title: "Preparing download…",
    log: ["Job queued."],
    files: []
  });

  try {
    const response = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, profile: profile.value })
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Download could not be started.");
    }

    activeJobId = payload.job.id;
    renderJobState(payload.job);
    pollHandle = window.setInterval(pollJob, 1800);
    pollJob();
  } catch (error) {
    renderJobState({
      status: "failed",
      title: "Unable to start download",
      log: [error.message],
      files: []
    });
  } finally {
    setBusy(submitButton, false, "Start download");
  }
}

async function pollJob() {
  if (!activeJobId) {
    return;
  }

  try {
    const response = await fetch(`/api/jobs/${activeJobId}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Unable to load job.");
    }

    renderJobState(payload.job);

    if (["completed", "failed"].includes(payload.job.status)) {
      clearPolling();
    }
  } catch (error) {
    clearPolling();
    renderJobState({
      status: "failed",
      title: "Polling stopped",
      log: [error.message],
      files: []
    });
  }
}

function renderInspection(metadata) {
  inspectionCard.hidden = false;
  inspectionType.textContent = metadata.isPlaylist ? `Playlist • ${metadata.itemCount} items` : "Media";
  inspectionTitle.textContent = metadata.title || "Untitled media";
  inspectionSubtitle.textContent = [metadata.extractor, metadata.uploader, formatDuration(metadata.duration)]
    .filter(Boolean)
    .join(" • ");

  if (metadata.thumbnail) {
    inspectionThumb.src = metadata.thumbnail;
    inspectionThumb.hidden = false;
  } else {
    inspectionThumb.hidden = true;
    inspectionThumb.removeAttribute("src");
  }

  if (metadata.webpageUrl) {
    inspectionLink.href = metadata.webpageUrl;
    inspectionLink.hidden = false;
  } else {
    inspectionLink.hidden = true;
  }
}

function renderInspectionError(message) {
  inspectionCard.hidden = false;
  inspectionType.textContent = "Error";
  inspectionTitle.textContent = "Inspection failed";
  inspectionSubtitle.textContent = message;
  inspectionThumb.hidden = true;
  inspectionThumb.removeAttribute("src");
  inspectionLink.hidden = true;
}

function renderJobState(job) {
  jobCard.hidden = false;
  jobStatus.textContent = job.status;
  jobStatus.dataset.state = job.status;
  jobTitle.textContent = job.title || "Preparing download…";

  if (job.status === "completed" && job.files.length > 0) {
    jobCopy.textContent = `${job.files.length} downloadable file${job.files.length === 1 ? "" : "s"} ready.`;
  } else if (job.status === "failed") {
    jobCopy.textContent = "The backend returned an error for this job.";
  } else {
    jobCopy.textContent = "Your links will appear here as soon as yt-dlp finishes.";
  }

  renderActions(job);
  renderResults(job.files || []);
  jobLog.textContent = (job.log || []).join("\n");
}

function renderActions(job) {
  resultActions.innerHTML = "";

  if (!job.archiveUrl) {
    return;
  }

  const link = document.createElement("a");
  link.className = "result result--action";
  link.href = job.archiveUrl;
  link.textContent = "Download all as ZIP";
  resultActions.append(link);
}

function renderResults(files) {
  results.innerHTML = "";

  if (!files.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No downloadable files yet.";
    results.append(empty);
    return;
  }

  for (const file of files) {
    const item = document.createElement("a");
    item.className = "result";
    item.href = file.downloadUrl;
    item.textContent = `${file.name} • ${formatBytes(file.sizeBytes)}`;
    item.setAttribute("download", file.name);
    results.append(item);
  }
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}

function clearPolling() {
  if (pollHandle) {
    window.clearInterval(pollHandle);
    pollHandle = 0;
  }
}

function formatDuration(seconds) {
  if (!seconds || Number.isNaN(seconds)) {
    return "";
  }

  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  if (!bytes) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}
