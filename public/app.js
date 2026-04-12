const form = document.querySelector("#resolver-form");
const mediaUrl = document.querySelector("#media-url");
const profile = document.querySelector("#profile");
const resolveButton = document.querySelector("#resolve-button");
const inspectionCard = document.querySelector("#inspection-card");
const inspectionType = document.querySelector("#inspection-type");
const inspectionTitle = document.querySelector("#inspection-title");
const inspectionSubtitle = document.querySelector("#inspection-subtitle");
const inspectionThumb = document.querySelector("#inspection-thumb");
const inspectionLink = document.querySelector("#inspection-link");
const profileHint = document.querySelector("#profile-hint");
const workingState = document.querySelector("#working-state");
const workingText = document.querySelector("#working-text");
const resultCard = document.querySelector("#result-card");
const resultStatus = document.querySelector("#result-status");
const resultTitle = document.querySelector("#result-title");
const resultCopy = document.querySelector("#result-copy");
const resultList = document.querySelector("#result-list");
const fallbackCard = document.querySelector("#fallback-card");
const fallbackText = document.querySelector("#fallback-text");
const copyWrap = document.querySelector("#copy-wrap");
const copyButton = document.querySelector("#copy-button");

const ACTIVE_JOB_KEY = "allmightydlp-active-job";
let latestCopyText = "";
let workingTimer = 0;
let pollTimer = 0;
let activeJobId = "";

copyButton.addEventListener("click", () => copyLinks());
profile.addEventListener("change", () => updateProfileHint());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && activeJobId) {
    pollJob(activeJobId);
  }
});
form.addEventListener("submit", (event) => {
  event.preventDefault();
  startResolve();
});

hideWorkingState();
clearResults();
updateProfileHint();
resumeExistingJob();

async function startResolve() {
  const url = mediaUrl.value.trim();
  if (!url) {
    mediaUrl.focus();
    return;
  }

  stopPolling();
  clearResults();
  setBusy(resolveButton, true, "Getting links...");
  scheduleWorkingState("Getting your links. Playlists can take a little longer.");

  try {
    const response = await fetch("/api/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, profile: profile.value })
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Could not get links.");
    }

    activeJobId = payload.job.id;
    localStorage.setItem(ACTIVE_JOB_KEY, activeJobId);
    pollJob(activeJobId);
  } catch (error) {
    hideWorkingState();
    renderFailure(error.message || "Could not get links.");
    setBusy(resolveButton, false, "Get download links");
  }
}

async function pollJob(jobId) {
  try {
    const response = await fetch(`/api/jobs/${jobId}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Could not load this job.");
    }

    const job = payload.job;

    if (job.status === "queued" || job.status === "running") {
      showWorkingState("Getting your links. Playlists can take a little longer.");
      schedulePoll(jobId);
      return;
    }

    stopPolling();
    hideWorkingState();
    clearActiveJob();
    setBusy(resolveButton, false, "Get download links");

    if (job.status === "failed") {
      renderFailure(job.error || "Could not get links.");
      return;
    }

    if (job.result?.source) {
      renderInspection(job.result.source);
    }
    renderResult(job.result);
  } catch (error) {
    if (document.hidden) {
      schedulePoll(jobId, 2500);
      return;
    }

    showWorkingState("Still working... reconnecting.");
    schedulePoll(jobId, 2500);
  }
}

function schedulePoll(jobId, delay = 1200) {
  stopPolling();
  pollTimer = window.setTimeout(() => {
    pollJob(jobId);
  }, delay);
}

function stopPolling() {
  if (pollTimer) {
    window.clearTimeout(pollTimer);
    pollTimer = 0;
  }
}

function clearActiveJob() {
  activeJobId = "";
  localStorage.removeItem(ACTIVE_JOB_KEY);
}

function resumeExistingJob() {
  const savedJobId = localStorage.getItem(ACTIVE_JOB_KEY);
  if (!savedJobId) {
    return;
  }

  activeJobId = savedJobId;
  setBusy(resolveButton, true, "Getting links...");
  showWorkingState("Finishing your last request...");
  pollJob(savedJobId);
}

async function copyLinks() {
  if (!latestCopyText) {
    return;
  }

  try {
    await navigator.clipboard.writeText(latestCopyText);
    copyButton.textContent = "Copied";
    window.setTimeout(() => {
      copyButton.textContent = "Copy all links to clipboard";
    }, 1400);
  } catch {
    copyButton.textContent = "Copy failed";
    window.setTimeout(() => {
      copyButton.textContent = "Copy all links to clipboard";
    }, 1400);
  }
}

function renderInspection(metadata) {
  inspectionCard.hidden = false;
  inspectionType.textContent = metadata.isPlaylist ? `Playlist • ${metadata.itemCount} items` : "Single post";
  inspectionTitle.textContent = metadata.title || "Untitled media";
  inspectionSubtitle.textContent = [metadata.uploader, formatDuration(metadata.duration)]
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

function renderResult(result) {
  resultCard.hidden = false;
  resultStatus.textContent = result.unresolvedCount > 0 ? "Some links ready" : "Ready";
  resultStatus.dataset.state = result.unresolvedCount > 0 ? "partial" : "completed";
  resultTitle.textContent = result.source.title || "Your media";
  resultCopy.textContent = `${result.readyCount} item${result.readyCount === 1 ? "" : "s"} ready${result.unresolvedCount ? `, and ${result.unresolvedCount} item${result.unresolvedCount === 1 ? "" : "s"} still need more access or extra processing.` : "."}`;

  renderItems(result.items || []);
  latestCopyText = result.copyText || "";
  copyWrap.hidden = !latestCopyText;

  if (result.fallbackSummary) {
    fallbackCard.hidden = false;
    fallbackText.textContent = result.fallbackSummary;
  } else {
    fallbackCard.hidden = true;
    fallbackText.textContent = "";
  }
}

function renderFailure(message) {
  resultCard.hidden = false;
  resultStatus.textContent = "Error";
  resultStatus.dataset.state = "failed";
  resultTitle.textContent = "We could not get your links";
  resultCopy.textContent = message;
  resultList.innerHTML = "";
  copyWrap.hidden = true;
  latestCopyText = "";
  fallbackCard.hidden = true;
}

function clearResults() {
  inspectionCard.hidden = true;
  resultCard.hidden = true;
  fallbackCard.hidden = true;
  resultList.innerHTML = "";
  latestCopyText = "";
  copyWrap.hidden = true;
}

function renderItems(items) {
  resultList.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Nothing was found for this link.";
    resultList.append(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "result";

    const title = document.createElement("strong");
    title.textContent = item.index ? `${item.index}. ${item.title}` : item.title;

    const meta = document.createElement("p");
    meta.className = "result__meta";
    meta.textContent = [formatDuration(item.duration), friendlyFormatLabel(item.formatLabel)].filter(Boolean).join(" • ");
    row.append(title, meta);

    if (item.downloadUrl) {
      const actions = document.createElement("div");
      actions.className = "result__actions";

      const saveLink = document.createElement("a");
      saveLink.className = "result__link";
      saveLink.href = item.downloadUrl;
      saveLink.textContent = item.fileExtension && audioExtensions().includes(item.fileExtension)
        ? "Save audio"
        : "Save video";
      actions.append(saveLink);

      if (item.directUrl) {
        const copyDirect = document.createElement("button");
        copyDirect.type = "button";
        copyDirect.className = "result__copy";
        copyDirect.textContent = "Copy direct link";
        copyDirect.addEventListener("click", async () => {
          await navigator.clipboard.writeText(item.directUrl);
          copyDirect.textContent = "Copied";
          window.setTimeout(() => {
            copyDirect.textContent = "Copy direct link";
          }, 1200);
        });
        actions.append(copyDirect);
      }

      row.append(actions);

      if (!item.directUrl) {
        const note = document.createElement("p");
        note.className = "result__note";
        note.textContent = "This one needs extra processing before it can be saved.";
        row.append(note);
      }
    } else {
      const reason = document.createElement("p");
      reason.className = "result__warning";
      reason.textContent = friendlyReason(item.reason);
      row.append(reason);
    }

    resultList.append(row);
  }
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}

function showWorkingState(message) {
  clearWorkingTimer();
  workingText.textContent = message;
  workingState.hidden = false;
}

function hideWorkingState() {
  clearWorkingTimer();
  workingState.hidden = true;
}

function scheduleWorkingState(message) {
  clearWorkingTimer();
  workingTimer = window.setTimeout(() => {
    showWorkingState(message);
  }, 350);
}

function clearWorkingTimer() {
  if (workingTimer) {
    window.clearTimeout(workingTimer);
    workingTimer = 0;
  }
}

function updateProfileHint() {
  if (profile.value === "audio") {
    profileHint.textContent = "Good for music, podcasts, and spoken audio.";
    return;
  }

  if (profile.value === "original") {
    profileHint.textContent = "Lets the app try the easiest version it can save.";
    return;
  }

  profileHint.textContent = "Best for saving the full video.";
}

function friendlyReason(reason) {
  if (!reason) {
    return "This item could not be prepared.";
  }

  if (reason.includes("split the video and audio")) {
    return "This one needs extra processing before it can be saved as a single file.";
  }

  if (reason.includes("did not share any usable media links")) {
    return "This site did not share a usable media file for this item.";
  }

  if (reason.includes("did not give us a simple saveable link")) {
    return "This site did not give us a simple saveable link for this item.";
  }

  return reason;
}

function friendlyFormatLabel(label) {
  if (!label) {
    return "";
  }

  return label
    .replace(/\b(default)\b/gi, "")
    .replace(/\s*•\s*mp4$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^\s*•\s*|\s*•\s*$/g, "")
    .trim();
}

function audioExtensions() {
  return ["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"];
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
