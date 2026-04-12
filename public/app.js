const form = document.querySelector("#resolver-form");
const mediaUrl = document.querySelector("#media-url");
const profile = document.querySelector("#profile");
const inspectButton = document.querySelector("#inspect-button");
const resolveButton = document.querySelector("#resolve-button");
const inspectionCard = document.querySelector("#inspection-card");
const inspectionType = document.querySelector("#inspection-type");
const inspectionTitle = document.querySelector("#inspection-title");
const inspectionSubtitle = document.querySelector("#inspection-subtitle");
const inspectionThumb = document.querySelector("#inspection-thumb");
const inspectionLink = document.querySelector("#inspection-link");
const resultCard = document.querySelector("#result-card");
const resultStatus = document.querySelector("#result-status");
const resultTitle = document.querySelector("#result-title");
const resultCopy = document.querySelector("#result-copy");
const resultList = document.querySelector("#result-list");
const fallbackCard = document.querySelector("#fallback-card");
const fallbackText = document.querySelector("#fallback-text");
const copyWrap = document.querySelector("#copy-wrap");
const copyField = document.querySelector("#copy-field");
const copyButton = document.querySelector("#copy-button");

inspectButton.addEventListener("click", () => inspectUrl());
copyButton.addEventListener("click", () => copyLinks());
form.addEventListener("submit", (event) => {
  event.preventDefault();
  resolveLinks();
});

async function inspectUrl() {
  const url = mediaUrl.value.trim();
  if (!url) {
    mediaUrl.focus();
    return;
  }

  setBusy(inspectButton, true, "Inspecting...");

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

async function resolveLinks() {
  const url = mediaUrl.value.trim();
  if (!url) {
    mediaUrl.focus();
    return;
  }

  setBusy(resolveButton, true, "Resolving...");
  clearResults();

  try {
    const response = await fetch("/api/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, profile: profile.value })
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Link resolution failed.");
    }

    renderResult(payload.result);
  } catch (error) {
    renderFailure(error.message);
  } finally {
    setBusy(resolveButton, false, "Resolve links");
  }
}

async function copyLinks() {
  if (!copyField.value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(copyField.value);
    copyButton.textContent = "Copied";
    window.setTimeout(() => {
      copyButton.textContent = "Copy all";
    }, 1400);
  } catch {
    copyField.focus();
    copyField.select();
  }
}

function renderInspection(metadata) {
  inspectionCard.hidden = false;
  inspectionType.textContent = metadata.isPlaylist ? `Playlist • ${metadata.itemCount} items` : "Single item";
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

function renderResult(result) {
  resultCard.hidden = false;
  resultStatus.textContent = result.unresolvedCount > 0 ? "Partial" : "Ready";
  resultStatus.dataset.state = result.unresolvedCount > 0 ? "partial" : "completed";
  resultTitle.textContent = result.source.title || "Resolved media";
  resultCopy.textContent = `${result.resolvedCount} direct link${result.resolvedCount === 1 ? "" : "s"} available${result.unresolvedCount ? `, ${result.unresolvedCount} item${result.unresolvedCount === 1 ? "" : "s"} still require backend processing.` : "."}`;

  renderItems(result.items);
  copyField.value = result.copyText || "";
  copyWrap.hidden = !result.copyText;

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
  resultTitle.textContent = "Could not resolve links";
  resultCopy.textContent = message;
  resultList.innerHTML = "";
  copyWrap.hidden = true;
  copyField.value = "";
  fallbackCard.hidden = true;
}

function clearResults() {
  resultCard.hidden = true;
  fallbackCard.hidden = true;
  resultList.innerHTML = "";
  copyField.value = "";
}

function renderItems(items) {
  resultList.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No items were returned.";
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
    meta.textContent = [item.extractor, formatDuration(item.duration), item.formatLabel].filter(Boolean).join(" • ");

    row.append(title, meta);

    if (item.status === "resolved") {
      const link = document.createElement("a");
      link.className = "result__link";
      link.href = item.directUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Open direct media link";
      row.append(link);
    } else {
      const reason = document.createElement("p");
      reason.className = "result__warning";
      reason.textContent = item.reason || "Direct link unavailable.";
      row.append(reason);
    }

    resultList.append(row);
  }
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
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
