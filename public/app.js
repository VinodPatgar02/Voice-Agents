const state = {
  job: null,
  people: [],
  dashboard: { jobs: [], candidates: [], calls: [], events: [] }
};

const $ = (id) => document.getElementById(id);

function toast(message, isError = false) {
  const box = $("toast");
  box.textContent = message;
  box.style.background = isError ? "#991b1b" : "#111827";
  box.classList.add("show");
  setTimeout(() => box.classList.remove("show"), 3600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }
  return data;
}

function selectedPeople() {
  return [...document.querySelectorAll("[data-people-select]:checked")].map((input) => {
    const index = Number(input.dataset.index);
    return state.people[index];
  });
}

function renderPeople() {
  const target = $("peopleResults");
  if (!state.people.length) {
    target.className = "cards empty";
    target.textContent = "No people found yet. Upload a CSV or add manual candidates to see results here.";
    return;
  }

  target.className = "cards";
  target.innerHTML = state.people.map((person, index) => `
    <article class="person-card">
      <label class="person-checkbox">
        <input type="checkbox" data-people-select data-index="${index}" ${person.phone ? "checked" : ""} />
        <span>Select</span>
      </label>
      <div>
        <h3>${escapeHtml(person.name)}</h3>
        <p>${escapeHtml(person.title || "No title")} ${person.company ? `· ${escapeHtml(person.company)}` : ""}</p>
        <p>${escapeHtml(person.location || "Location unavailable")}</p>
        <p>${person.email ? escapeHtml(person.email) : "Email unavailable"} · ${person.phone ? escapeHtml(person.phone) : "Phone unavailable"}</p>
        ${person.linkedinUrl ? `<a href="${escapeAttr(person.linkedinUrl)}" target="_blank" rel="noreferrer">LinkedIn</a>` : ""}
        <div class="muted">Source: ${escapeHtml(person.source || "manual")}</div>
      </div>
      <div class="person-actions">
        <button type="button" class="tiny" onclick="editCandidate(${index})">Edit</button>
        <button type="button" class="tiny danger" onclick="deleteCandidate(${index})">Delete</button>
      </div>
    </article>
  `).join("");
}

function resultForCandidate(candidate) {
  return state.dashboard.calls.find((call) => call.candidateId === candidate.id);
}

function renderDashboard() {
  const rows = $("dashboardRows");
  const { candidates, calls } = state.dashboard;
  const completed = calls.filter((call) => ["COMPLETED", "completed"].includes(call.lifecycleStatus || call.status)).length;
  const interested = calls.filter((call) => JSON.stringify(call.result || {}).toLowerCase().includes("interested")).length;

  $("statCandidates").textContent = candidates.length;
  $("statCalls").textContent = calls.length;
  $("statCompleted").textContent = completed;
  $("statInterested").textContent = interested;

  if (!candidates.length) {
    rows.innerHTML = `<tr><td colspan="6" class="muted">No candidates added yet.</td></tr>`;
    return;
  }

  rows.innerHTML = candidates.map((candidate, index) => {
    const call = resultForCandidate(candidate);
    const resultHtml = call?.result ? renderStructuredResult(call.result) : `<span class="muted">No conversation result yet.</span>`;
    return `
      <tr>
        <td>${index + 1}</td>
        <td>
          <strong>${escapeHtml(candidate.name)}</strong>
          <div class="muted">${escapeHtml(candidate.title || "")}</div>
        </td>
        <td>${escapeHtml(candidate.company || "")}</td>
        <td>${escapeHtml(candidate.phone || "Unavailable")}</td>
        <td>
          <div class="status-cell">
            <span class="pill">${escapeHtml(call?.lifecycleStatus || candidate.status || "SOURCED")}</span>
            ${call?.recordingUrl ? `<a href="${escapeAttr(call.recordingUrl)}" target="_blank" rel="noreferrer">Recording</a>` : ""}
          </div>
        </td>
        <td class="result-structure-cell">${resultHtml}</td>
      </tr>
    `;
  }).join("");
}

async function loadConfig() {
  const config = await api("/api/config");
  const configCard = $("configCard");
  if (configCard) {
    configCard.innerHTML = `
      <strong>API configuration</strong><br />
      Hunar: ${config.hunarConfigured ? "Configured" : "Missing HUNAR_API_KEY"}<br />
      Apollo: ${config.apolloConfigured ? "Configured" : "Not configured; CSV/manual workaround available"}
    `;
  }
  if (config.defaultAgentId) {
    $("agentSelect").innerHTML = `<option value="${escapeAttr(config.defaultAgentId)}">Default agent (${escapeHtml(config.defaultAgentId)})</option>`;
  }
}

async function refreshDashboard() {
  state.dashboard = await api("/api/dashboard");
  renderDashboard();
}

async function saveJob() {
  const payload = {
    title: $("jobTitle").value,
    location: $("jobLocation").value,
    description: $("jobDescription").value
  };
  state.job = await api("/api/jobs", { method: "POST", body: JSON.stringify(payload) });
  $("jobStatus").textContent = `Saved job: ${state.job.title}`;
  toast("Job saved.");
}

function addManualCandidate() {
  const candidate = {
    source: "manual",
    sourceId: `manual_${Date.now()}`,
    name: $("manualName").value.trim(),
    title: $("manualTitle").value.trim(),
    company: $("manualCompany").value.trim(),
    location: $("manualLocation").value.trim(),
    email: $("manualEmail").value.trim(),
    phone: $("manualPhone").value.trim(),
    linkedinUrl: $("manualLinkedIn").value.trim()
  };

  if (!candidate.name) throw new Error("Name is required for manual candidates.");
  if (!candidate.title) throw new Error("Title is required for manual candidates.");
  if (!candidate.company) throw new Error("Company is required for manual candidates.");
  if (!candidate.location) throw new Error("Location is required for manual candidates.");
  if (!candidate.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.email)) throw new Error("A valid email is required for manual candidates.");
  if (!candidate.phone || !/^[+0-9][0-9\s().-]{5,}$/.test(candidate.phone)) throw new Error("A valid phone number is required for manual candidates.");

  if (state.editingIndex !== null && state.editingIndex !== undefined) {
    state.people[state.editingIndex] = {
      ...state.people[state.editingIndex],
      ...candidate,
      source: state.people[state.editingIndex].source || "manual",
      sourceId: state.people[state.editingIndex].sourceId || `manual_${Date.now()}`
    };
    toast("Candidate updated.");
    state.editingIndex = null;
    $("addManualCandidateBtn").textContent = "Add Candidate";
    $("cancelEditCandidateBtn").classList.add("hidden");
  } else {
    state.people.unshift(candidate);
    toast("Manual candidate added to selectable results.");
  }

  renderPeople();
  clearManualForm();
}

function clearManualForm() {
  ["manualName", "manualTitle", "manualCompany", "manualLocation", "manualEmail", "manualPhone", "manualLinkedIn"]
    .forEach((id) => { $(id).value = ""; });
}

function editCandidate(index) {
  const candidate = state.people[index];
  if (!candidate) return;

  state.editingIndex = index;
  [
    ["manualName", candidate.name],
    ["manualTitle", candidate.title],
    ["manualCompany", candidate.company],
    ["manualLocation", candidate.location],
    ["manualEmail", candidate.email],
    ["manualPhone", candidate.phone],
    ["manualLinkedIn", candidate.linkedinUrl]
  ].forEach(([id, value]) => { $(id).value = value || ""; });

  $("addManualCandidateBtn").textContent = "Save candidate";
  const cancelBtn = $("cancelEditCandidateBtn");
  if (cancelBtn) cancelBtn.classList.remove("hidden");
  toast("Editing candidate. Make changes and save.");
}

function deleteCandidate(index) {
  if (index < 0 || index >= state.people.length) return;
  const removed = state.people.splice(index, 1);
  if (state.editingIndex === index) {
    state.editingIndex = null;
    clearManualForm();
    $("addManualCandidateBtn").textContent = "Add Candidate";
    const cancelBtn = $("cancelEditCandidateBtn");
    if (cancelBtn) cancelBtn.classList.add("hidden");
  }
  if (removed.length) {
    toast("Candidate removed.");
    renderPeople();
  }
}

function cancelEditCandidate() {
  state.editingIndex = null;
  clearManualForm();
  $("addManualCandidateBtn").textContent = "Add Candidate";
  const cancelBtn = $("cancelEditCandidateBtn");
  if (cancelBtn) cancelBtn.classList.add("hidden");
}

async function handleCsvUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("CSV has no rows");

  const candidates = rows.map((row, index) => ({
    source: "csv",
    sourceId: `csv_${Date.now()}_${index}`,
    name: row.name || row.full_name || row.candidate || "",
    title: row.title || row.role || "",
    company: row.company || row.organization || "",
    location: row.location || "",
    email: row.email || "",
    phone: row.phone || row.mobile || row.mobile_number || "",
    linkedinUrl: row.linkedinUrl || row.linkedin_url || row.linkedin || ""
  })).filter((candidate) => candidate.name && candidate.phone);

  if (!candidates.length) throw new Error("CSV must contain at least one row with name and phone");
  state.people = [...candidates, ...state.people];
  renderPeople();
  toast(`Imported ${candidates.length} callable candidate(s) from CSV.`);
  event.target.value = "";
}

function parseCsv(text) {
  const lines = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) lines.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim())) lines.push(row);
  if (lines.length < 2) return [];

  const headers = lines[0].map((header) => header.trim());
  return lines.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] || "").trim()])));
}

function downloadSampleCsv() {
  const csv = [
    "name,title,company,location,email,phone,linkedinUrl",
    "Ananya Rao,Backend Engineer,Example SaaS,Bengaluru,ananya@example.com,+919876543210,https://linkedin.com/in/ananya-rao",
    "Rahul Mehta,Full Stack Engineer,Acme Tech,Mumbai,rahul@example.com,+919812345678,https://linkedin.com/in/rahul-mehta"
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "hunar-candidates-sample.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

async function loadHunarOptions() {
  const [agents, numbers] = await Promise.all([
    api("/api/hunar/agents"),
    api("/api/hunar/numbers")
  ]);

  const agentItems = agents.results || [];
  $("agentSelect").innerHTML = agentItems.length
    ? agentItems.map((agent) => `<option value="${escapeAttr(agent.id)}">${escapeHtml(agent.name)} · ${escapeHtml(agent.language || "")}</option>`).join("")
    : `<option value="">No agents found</option>`;

  const numberItems = numbers.results || [];
  $("numberSelect").innerHTML = `<option value="">Use Hunar default</option>` + numberItems
    .map((number) => `<option value="${escapeAttr(number.phone_number)}">${escapeHtml(number.phone_number)}</option>`)
    .join("");
}

async function startReachout() {
  const selected = selectedPeople();
  if (!selected.length) throw new Error("Select at least one candidate from Step 2 first");

  const unsavedCandidates = selected.filter((candidate) => !candidate.id);
  if (unsavedCandidates.length) {
    const result = await api("/api/candidates", {
      method: "POST",
      body: JSON.stringify({ jobId: state.job?.id, candidates: unsavedCandidates })
    });

    for (const created of result.created) {
      const existing = state.people.find((candidate) => candidate.sourceId === created.sourceId || candidate.phone === created.phone && candidate.name === created.name);
      if (existing) existing.id = created.id;
    }
  }

  const candidateIds = selected.map((candidate) => candidate.id).filter(Boolean);
  if (!candidateIds.length) throw new Error("Selected candidates must be added to the dashboard before reachout.");

  const result = await api("/api/reachout", {
    method: "POST",
    body: JSON.stringify({
      candidateIds,
      agentId: $("agentSelect").value,
      fromPhoneNumber: $("numberSelect").value,
      retry: $("retryCalls").checked,
      jobTitle: $("jobTitle").value
    })
  });

  $("reachoutStatus").textContent = `Started ${result.calls.length} call(s).`;
  toast(`Started ${result.calls.length} Hunar voice call(s).`);
  await refreshDashboard();
}

async function syncCalls() {
  const result = await api("/api/calls/sync", {
    method: "POST",
    body: JSON.stringify({})
  });
  toast(`Synced ${result.synced.length} calls from Hunar.`);
  await refreshDashboard();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function renderStructuredResult(value) {
  if (value === null || value === undefined || value === "") return `<span class="muted">No conversation result yet.</span>`;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return `<div>${escapeHtml(String(value))}</div>`;
  }
  if (Array.isArray(value)) {
    return `<ul class="result-array">${value.map((item) => `<li>${renderStructuredResult(item)}</li>`).join("")}</ul>`;
  }
  const entries = Object.entries(value)
    .filter(([key]) => key.toLowerCase() !== "interested")
    .map(([key, item]) => {
      const normalized = key.toLowerCase();
      const lightClass = normalized === "summary" || normalized === "best_time_to_call" || normalized === "besttime" || normalized === "besttime tocall" || normalized.includes("best") && normalized.includes("time") ? " result-light" : "";
      return `
        <dt>${escapeHtml(key)}</dt>
        <dd class="result-structure${lightClass}">${renderStructuredResult(item)}</dd>
      `;
    });
  return `<dl class="result-structure">${entries.join("")}</dl>`;
}

function bind(id, fn) {
  $(id).addEventListener("click", async () => {
    try {
      await fn();
    } catch (error) {
      toast(error.message, true);
    }
  });
}

bind("saveJobBtn", saveJob);
bind("downloadSampleCsvBtn", downloadSampleCsv);
bind("addManualCandidateBtn", addManualCandidate);
bind("cancelEditCandidateBtn", cancelEditCandidate);
bind("startReachoutBtn", startReachout);
bind("refreshDashboardBtn", refreshDashboard);
bind("syncCallsBtn", syncCalls);
$("candidateCsv").addEventListener("change", (event) => handleCsvUpload(event).catch((error) => toast(error.message, true)));

loadConfig().catch((error) => toast(error.message, true));
loadHunarOptions().catch((error) => toast(error.message, true));
refreshDashboard().catch((error) => toast(error.message, true));
