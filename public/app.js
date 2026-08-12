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

function selectedCandidateIds() {
  return [...document.querySelectorAll("[data-candidate-select]:checked")].map((input) => input.value);
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
    target.textContent = "No people found yet. Use Apollo search, CSV upload, or manual candidate entry.";
    return;
  }

  target.className = "cards";
  target.innerHTML = state.people.map((person, index) => `
    <article class="person-card">
      <input type="checkbox" data-people-select data-index="${index}" ${person.phone ? "checked" : ""} />
      <div>
        <h3>${escapeHtml(person.name)}</h3>
        <p>${escapeHtml(person.title || "No title")} ${person.company ? `· ${escapeHtml(person.company)}` : ""}</p>
        <p>${escapeHtml(person.location || "Location unavailable")}</p>
        <p>${person.email ? escapeHtml(person.email) : "Email unavailable"} · ${person.phone ? escapeHtml(person.phone) : "Phone unavailable"}</p>
        ${person.linkedinUrl ? `<a href="${escapeAttr(person.linkedinUrl)}" target="_blank" rel="noreferrer">LinkedIn</a>` : ""}
        <div class="muted">Source: ${escapeHtml(person.source || "manual")}</div>
      </div>
      <span class="pill">${person.phone ? "Callable" : "Needs phone"}</span>
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

  rows.innerHTML = candidates.map((candidate) => {
    const call = resultForCandidate(candidate);
    const result = call?.result ? JSON.stringify(call.result, null, 2) : "No conversation result yet.";
    return `
      <tr>
        <td><input type="checkbox" data-candidate-select value="${escapeAttr(candidate.id)}" ${candidate.phone ? "" : "disabled"} /></td>
        <td>
          <strong>${escapeHtml(candidate.name)}</strong>
          <div class="muted">${escapeHtml(candidate.title || "")}</div>
        </td>
        <td>${escapeHtml(candidate.company || "")}</td>
        <td>${escapeHtml(candidate.phone || "Unavailable")}</td>
        <td>
          <span class="pill">${escapeHtml(call?.lifecycleStatus || candidate.status || "SOURCED")}</span>
          ${call?.recordingUrl ? `<div><a href="${escapeAttr(call.recordingUrl)}" target="_blank" rel="noreferrer">Recording</a></div>` : ""}
        </td>
        <td><pre class="result-json">${escapeHtml(result)}</pre></td>
      </tr>
    `;
  }).join("");
}

async function loadConfig() {
  const config = await api("/api/config");
  $("configCard").innerHTML = `
    <strong>API configuration</strong><br />
    Hunar: ${config.hunarConfigured ? "Configured" : "Missing HUNAR_API_KEY"}<br />
    Apollo: ${config.apolloConfigured ? "Configured" : "Not configured; CSV/manual workaround available"}
  `;
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

async function searchPeople() {
  const jobDescription = $("jobDescription").value;
  const result = await api("/api/people/search", {
    method: "POST",
    body: JSON.stringify({
      jobDescription,
      location: $("locationOverride").value,
      titles: $("titlesOverride").value,
      limit: $("resultLimit").value
    })
  });
  state.people = result.people;
  renderPeople();
  toast(`Found ${result.people.length} people from Apollo.`);
}

function generateSourcingLinks() {
  const title = $("titlesOverride").value || $("jobTitle").value || "candidate";
  const location = $("locationOverride").value || $("jobLocation").value || "";
  const jd = $("jobDescription").value;
  const keywords = extractKeywords(jd).slice(0, 8).join(" ");
  const query = [title, location, keywords].filter(Boolean).join(" ");
  const encoded = encodeURIComponent(query);
  const links = [
    ["LinkedIn X-Ray", `https://www.google.com/search?q=site%3Alinkedin.com%2Fin+${encoded}`],
    ["Google profiles", `https://www.google.com/search?q=${encoded}+resume+OR+profile+OR+linkedin`],
    ["GitHub candidates", `https://www.google.com/search?q=site%3Agithub.com+${encoded}`],
    ["Naukri-style resume search", `https://www.google.com/search?q=${encoded}+resume+phone+email`]
  ];

  $("sourcingLinks").innerHTML = `
    <strong>Generated sourcing links</strong>
    <p class="muted">Use these to source profiles, then add candidates by CSV/manual intake below.</p>
    <div class="button-row">
      ${links.map(([label, href]) => `<a class="link-button" href="${escapeAttr(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`).join("")}
    </div>
  `;
  toast("Generated sourcing links from the job description.");
}

function extractKeywords(text) {
  const stop = new Set(["and", "the", "for", "with", "you", "are", "will", "our", "this", "that", "have", "from", "role", "candidate"]);
  return String(text || "")
    .toLowerCase()
    .match(/[a-z][a-z+#.-]{2,}/g)?.filter((word) => !stop.has(word)) || [];
}

async function saveCandidates() {
  const candidates = selectedPeople();
  if (!candidates.length) throw new Error("Select at least one person first");
  const result = await api("/api/candidates", {
    method: "POST",
    body: JSON.stringify({ jobId: state.job?.id, candidates })
  });
  toast(`Added ${result.created.length} candidates to dashboard.`);
  await refreshDashboard();
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
  if (!candidate.name || !candidate.phone) throw new Error("Manual candidate needs at least name and phone");
  state.people.unshift(candidate);
  renderPeople();
  clearManualForm();
  toast("Manual candidate added to selectable results.");
}

function clearManualForm() {
  ["manualName", "manualTitle", "manualCompany", "manualLocation", "manualEmail", "manualPhone", "manualLinkedIn"]
    .forEach((id) => { $(id).value = ""; });
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

  toast("Loaded Hunar agents and numbers.");
}

async function startReachout() {
  const candidateIds = selectedCandidateIds();
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

async function enrichPhones() {
  const candidateIds = selectedCandidateIds();
  const result = await api("/api/people/enrich-phones", {
    method: "POST",
    body: JSON.stringify({ candidateIds })
  });
  toast(`Requested Apollo phone enrichment for ${result.requests.length} candidate(s). Apollo will return phones by webhook.`);
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
bind("searchPeopleBtn", searchPeople);
bind("generateSourcingBtn", generateSourcingLinks);
bind("saveCandidatesBtn", saveCandidates);
bind("downloadSampleCsvBtn", downloadSampleCsv);
bind("addManualCandidateBtn", addManualCandidate);
bind("refreshHunarBtn", loadHunarOptions);
bind("startReachoutBtn", startReachout);
bind("enrichPhonesBtn", enrichPhones);
bind("refreshDashboardBtn", refreshDashboard);
bind("syncCallsBtn", syncCalls);
$("candidateCsv").addEventListener("change", (event) => handleCsvUpload(event).catch((error) => toast(error.message, true)));

loadConfig().catch((error) => toast(error.message, true));
refreshDashboard().catch((error) => toast(error.message, true));
