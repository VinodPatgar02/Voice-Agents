const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

loadLocalEnv();

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DB_FILE = path.join(ROOT, "data", "store.json");

const HUNAR_BASE_URL = process.env.HUNAR_BASE_URL || "https://api.voice.hunar.ai/external/v1";
const APOLLO_BASE_URL = process.env.APOLLO_BASE_URL || "https://api.apollo.io/api/v1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const defaultStore = {
  jobs: [],
  candidates: [],
  calls: [],
  events: []
};

function loadLocalEnv() {
  const envPath = path.join(__dirname, ".env");
  try {
    const contents = require("node:fs").readFileSync(envPath, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex === -1) continue;
      const key = trimmed.slice(0, equalsIndex).trim();
      const value = trimmed.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function badRequest(res, message, details = []) {
  json(res, 400, { success: false, message, details });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Invalid JSON body");
    error.status = 400;
    throw error;
  }
}

async function readStore() {
  try {
    return JSON.parse(await fs.readFile(DB_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(defaultStore);
    throw error;
  }
}

async function writeStore(store) {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(store, null, 2));
}

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function ensureEnv(name) {
  if (!process.env[name]) {
    const error = new Error(`${name} is not configured on the server`);
    error.status = 503;
    throw error;
  }
}

async function externalJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(body?.message || `External API failed with ${response.status}`);
    error.status = response.status;
    error.details = body;
    throw error;
  }

  return body;
}

function hunarHeaders() {
  ensureEnv("HUNAR_API_KEY");
  return {
    "X-API-Key": process.env.HUNAR_API_KEY,
    "Content-Type": "application/json"
  };
}

function apolloHeaders() {
  ensureEnv("APOLLO_API_KEY");
  return {
    "x-api-key": process.env.APOLLO_API_KEY,
    "Content-Type": "application/json",
    "accept": "application/json"
  };
}

function extractJobFilters(jobDescription) {
  const text = String(jobDescription || "");
  const lower = text.toLowerCase();
  const titles = [
    "software engineer",
    "backend engineer",
    "frontend engineer",
    "full stack engineer",
    "product manager",
    "sales manager",
    "recruiter",
    "data analyst",
    "data scientist",
    "machine learning engineer",
    "devops engineer",
    "hr manager"
  ].filter((title) => lower.includes(title));

  const locationMatch = text.match(/\b(?:in|at|location:)\s+([A-Z][A-Za-z\s,.-]{2,40})/);
  const locations = locationMatch ? [locationMatch[1].replace(/[.;]$/, "").trim()] : [];

  return {
    q_keywords: text.slice(0, 900),
    person_titles: titles.length ? titles : undefined,
    person_locations: locations.length ? locations : undefined
  };
}

function normalizeApolloPerson(person) {
  const org = person.organization || person.account || {};
  return {
    source: "apollo",
    sourceId: person.id,
    name: person.name || [person.first_name, person.last_name].filter(Boolean).join(" ") || "Unknown candidate",
    title: person.title || "",
    company: org.name || person.organization_name || "",
    location: person.city || person.state || person.country ? [person.city, person.state, person.country].filter(Boolean).join(", ") : "",
    linkedinUrl: person.linkedin_url || "",
    email: person.email || person.sanitized_email || "",
    phone: person.phone_numbers?.[0]?.raw_number || person.mobile_phone || person.phone || "",
    raw: person
  };
}

function appendSearchParam(params, key, value) {
  if (value === undefined || value === null || value === "") return;
  if (Array.isArray(value)) {
    for (const item of value) appendSearchParam(params, `${key}[]`, item);
    return;
  }
  params.append(key, String(value));
}

function apolloUrl(endpoint, paramsObject = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(paramsObject)) appendSearchParam(params, key, value);
  const query = params.toString();
  return `${APOLLO_BASE_URL}${endpoint}${query ? `?${query}` : ""}`;
}

async function listHunarAgents() {
  return externalJson(`${HUNAR_BASE_URL}/agents/?page=1&page_size=50`, {
    headers: hunarHeaders()
  });
}

async function listHunarNumbers() {
  return externalJson(`${HUNAR_BASE_URL}/numbers/?page=1&page_size=50`, {
    headers: hunarHeaders()
  });
}

async function createHunarCall(payload) {
  return externalJson(`${HUNAR_BASE_URL}/calls/`, {
    method: "POST",
    headers: hunarHeaders(),
    body: JSON.stringify(payload)
  });
}

async function createBulkHunarCalls(payload) {
  return externalJson(`${HUNAR_BASE_URL}/calls/bulk/`, {
    method: "POST",
    headers: hunarHeaders(),
    body: JSON.stringify(payload)
  });
}

async function getHunarCall(callId) {
  return externalJson(`${HUNAR_BASE_URL}/calls/${encodeURIComponent(callId)}/`, {
    headers: hunarHeaders()
  });
}

function verifyHunarWebhook(req, rawBody) {
  const secret = process.env.HUNAR_WEBHOOK_SECRET;
  if (!secret) return true;

  const signature = req.headers["x-hunar-signature"] || req.headers["x-signature"];
  if (!signature) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(String(signature)), Buffer.from(expected));
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/config") {
    return json(res, 200, {
      hunarConfigured: Boolean(process.env.HUNAR_API_KEY),
      apolloConfigured: Boolean(process.env.APOLLO_API_KEY),
      defaultAgentId: process.env.HUNAR_DEFAULT_AGENT_ID || "",
      defaultFromPhoneNumber: process.env.HUNAR_DEFAULT_FROM_PHONE_NUMBER || ""
    });
  }

  if (req.method === "GET" && url.pathname === "/api/hunar/agents") {
    return json(res, 200, await listHunarAgents());
  }

  if (req.method === "GET" && url.pathname === "/api/hunar/numbers") {
    return json(res, 200, await listHunarNumbers());
  }

  if (req.method === "POST" && url.pathname === "/api/jobs") {
    const body = await readBody(req);
    if (!body.title || !body.description) return badRequest(res, "Job title and description are required");

    const store = await readStore();
    const job = {
      id: id("job"),
      title: String(body.title).trim(),
      description: String(body.description).trim(),
      location: String(body.location || "").trim(),
      createdAt: now()
    };
    store.jobs.unshift(job);
    await writeStore(store);
    return json(res, 200, job);
  }

  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    const store = await readStore();
    return json(res, 200, store);
  }

  if (req.method === "POST" && url.pathname === "/api/people/search") {
    const body = await readBody(req);
    const description = String(body.jobDescription || "");
    if (!description.trim()) return badRequest(res, "Job description is required");

    const filters = {
      ...extractJobFilters(description),
      page: Number(body.page || 1),
      per_page: Math.min(Number(body.limit || 10), 100)
    };

    if (body.location) filters.person_locations = [String(body.location)];
    if (body.titles) filters.person_titles = String(body.titles).split(",").map((t) => t.trim()).filter(Boolean);

    const result = await externalJson(apolloUrl("/mixed_people/api_search", filters), {
      method: "POST",
      headers: apolloHeaders(),
      body: JSON.stringify({})
    });

    const people = (result.people || result.contacts || []).map(normalizeApolloPerson);
    return json(res, 200, { filters, people, rawCount: result.pagination?.total_entries || people.length });
  }

  if (req.method === "POST" && url.pathname === "/api/people/enrich-phones") {
    const body = await readBody(req);
    const candidateIds = Array.isArray(body.candidateIds) ? body.candidateIds : [];
    if (!candidateIds.length) return badRequest(res, "Select at least one candidate to enrich");
    if (!process.env.APP_BASE_URL) return badRequest(res, "APP_BASE_URL is required for Apollo phone enrichment webhooks");

    const store = await readStore();
    const candidates = store.candidates.filter((candidate) => candidateIds.includes(candidate.id));
    if (!candidates.length) return badRequest(res, "No matching candidates found");

    const webhookUrl = `${process.env.APP_BASE_URL.replace(/\/$/, "")}/api/webhooks/apollo`;
    const requests = [];
    for (const candidate of candidates) {
      const [firstName, ...rest] = String(candidate.name || "").split(/\s+/);
      const params = {
        id: candidate.sourceId || undefined,
        first_name: firstName || undefined,
        last_name: rest.join(" ") || undefined,
        linkedin_url: candidate.linkedinUrl || undefined,
        reveal_personal_emails: false,
        reveal_phone_number: true,
        webhook_url: webhookUrl
      };
      const response = await externalJson(apolloUrl("/people/match", params), {
        method: "POST",
        headers: apolloHeaders(),
        body: JSON.stringify({})
      });
      requests.push({ candidateId: candidate.id, response });
    }

    store.candidates = store.candidates.map((candidate) =>
      candidateIds.includes(candidate.id)
        ? { ...candidate, status: candidate.phone ? candidate.status : "PHONE_ENRICHMENT_REQUESTED", updatedAt: now() }
        : candidate
    );
    await writeStore(store);
    return json(res, 200, { requests });
  }

  if (req.method === "POST" && url.pathname === "/api/candidates") {
    const body = await readBody(req);
    if (!Array.isArray(body.candidates)) return badRequest(res, "candidates must be an array");

    const store = await readStore();
    const created = body.candidates.map((candidate) => ({
      id: id("cand"),
      jobId: body.jobId || null,
      status: "SOURCED",
      addedAt: now(),
      ...candidate
    }));
    store.candidates.unshift(...created);
    await writeStore(store);
    return json(res, 200, { created });
  }

  if (req.method === "POST" && url.pathname === "/api/reachout") {
    const body = await readBody(req);
    const candidateIds = Array.isArray(body.candidateIds) ? body.candidateIds : [];
    if (!candidateIds.length) return badRequest(res, "Select at least one candidate");

    const agentId = body.agentId || process.env.HUNAR_DEFAULT_AGENT_ID;
    if (!agentId) return badRequest(res, "Hunar agent_id is required");

    const store = await readStore();
    const selected = store.candidates.filter((candidate) => candidateIds.includes(candidate.id));
    const callable = selected.filter((candidate) => candidate.phone || candidate.mobile_number);
    if (!callable.length) return badRequest(res, "Selected candidates do not have phone numbers");

    const callbackUrl = process.env.APP_BASE_URL
      ? `${process.env.APP_BASE_URL.replace(/\/$/, "")}/api/webhooks/hunar`
      : undefined;

    const shared = {
      agent_id: agentId,
      request_id: id("batch"),
      from_phone_number: body.fromPhoneNumber || process.env.HUNAR_DEFAULT_FROM_PHONE_NUMBER || undefined,
      callback_config: callbackConfig
    };

    const callbackConfig = callbackUrl ? {
      call_status_callback_url: callbackUrl,
      call_result_callback_url: callbackUrl,
      call_summary_callback_url: callbackUrl,
      call_recording_callback_url: callbackUrl
    } : undefined;

    let createdCalls = [];
    if (callable.length === 1) {
      const candidate = callable[0];
      const call = await createHunarCall({
        ...shared,
        request_id: id("call"),
        callee_name: candidate.name,
        mobile_number: candidate.phone || candidate.mobile_number,
        custom_data: {
          job_title: body.jobTitle || "",
          candidate_title: candidate.title || "",
          candidate_company: candidate.company || "",
          source: candidate.source || "dashboard"
        }
      });
      createdCalls = [call];
    } else {
      const result = await createBulkHunarCalls({
        ...shared,
        data: callable.map((candidate) => ({
          callee_name: candidate.name,
          mobile_number: candidate.phone || candidate.mobile_number,
          custom_data: {
            job_title: body.jobTitle || "",
            candidate_title: candidate.title || "",
            candidate_company: candidate.company || "",
            source: candidate.source || "dashboard"
          }
        }))
      });
      createdCalls = Array.isArray(result) ? result : result.results || result.calls || [];
    }

    const callRows = createdCalls.map((call, index) => {
      const candidate = callable[index] || callable.find((item) => item.name === call.callee_name) || {};
      return {
        id: id("row"),
        hunarCallId: call.id,
        candidateId: candidate.id,
        candidateName: call.callee_name || candidate.name,
        mobileNumber: call.mobile_number || candidate.phone,
        agentId,
        status: call.status || "CREATED",
        lifecycleStatus: call.lifecycle_status || call.status || "CREATED",
        result: call.result || null,
        recordingUrl: call.recording_url || "",
        durationSeconds: call.duration_seconds || 0,
        requestId: call.request_id || shared.request_id,
        createdAt: now(),
        updatedAt: now(),
        raw: call
      };
    });

    store.calls.unshift(...callRows);
    store.candidates = store.candidates.map((candidate) =>
      candidateIds.includes(candidate.id) ? { ...candidate, status: "REACHOUT_STARTED", updatedAt: now() } : candidate
    );
    await writeStore(store);
    return json(res, 200, { calls: callRows });
  }

  if (req.method === "POST" && url.pathname === "/api/calls/sync") {
    const body = await readBody(req);
    const store = await readStore();
    const ids = Array.isArray(body.callIds) && body.callIds.length
      ? body.callIds
      : store.calls.map((call) => call.hunarCallId).filter(Boolean);

    const synced = [];
    for (const callId of ids) {
      const fresh = await getHunarCall(callId);
      synced.push(fresh);
      store.calls = store.calls.map((row) =>
        row.hunarCallId === callId
          ? {
              ...row,
              status: fresh.status || row.status,
              lifecycleStatus: fresh.lifecycle_status || row.lifecycleStatus,
              result: fresh.result || row.result,
              recordingUrl: fresh.recording_url || row.recordingUrl,
              durationSeconds: fresh.duration_seconds || row.durationSeconds,
              updatedAt: now(),
              raw: fresh
            }
          : row
      );
    }
    await writeStore(store);
    return json(res, 200, { synced });
  }

  if (req.method === "POST" && url.pathname === "/api/webhooks/hunar") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks);
    if (!verifyHunarWebhook(req, rawBody)) return json(res, 401, { success: false, message: "Invalid webhook signature" });

    const event = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {};
    const call = event.call || event.data || event;
    const callId = call.id || call.call_id || call.hunarCallId;

    const store = await readStore();
    store.events.unshift({ id: id("evt"), receivedAt: now(), event });
    if (callId) {
      store.calls = store.calls.map((row) =>
        row.hunarCallId === callId
          ? {
              ...row,
              status: call.status || row.status,
              lifecycleStatus: call.lifecycle_status || row.lifecycleStatus,
              result: call.result || row.result,
              recordingUrl: call.recording_url || row.recordingUrl,
              durationSeconds: call.duration_seconds || row.durationSeconds,
              updatedAt: now(),
              raw: call
            }
          : row
      );
    }
    await writeStore(store);
    return json(res, 200, { success: true });
  }

  if (req.method === "POST" && url.pathname === "/api/webhooks/apollo") {
    const event = await readBody(req);
    const people = event.people || event.matches || [];
    const store = await readStore();
    store.events.unshift({ id: id("evt"), receivedAt: now(), source: "apollo", event });

    for (const person of people) {
      const phone = person.phone_numbers?.[0]?.sanitized_number || person.phone_numbers?.[0]?.raw_number;
      if (!phone) continue;
      store.candidates = store.candidates.map((candidate) =>
        candidate.sourceId === person.id || candidate.linkedinUrl === person.linkedin_url
          ? { ...candidate, phone, status: "PHONE_ENRICHED", updatedAt: now(), apolloPhoneEnrichment: person }
          : candidate
      );
    }

    await writeStore(store);
    return json(res, 200, { success: true });
  }

  json(res, 404, { success: false, message: "API route not found" });
}

async function serveStatic(req, res, url) {
  const requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const target = path.normalize(path.join(PUBLIC_DIR, requestPath));
  if (!target.startsWith(PUBLIC_DIR)) return json(res, 403, { success: false, message: "Forbidden" });

  try {
    const data = await fs.readFile(target);
    const ext = path.extname(target);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      const data = await fs.readFile(path.join(PUBLIC_DIR, "index.html"));
      res.writeHead(200, { "Content-Type": MIME[".html"] });
      res.end(data);
      return;
    }
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else await serveStatic(req, res, url);
  } catch (error) {
    const status = error.status || 500;
    json(res, status, {
      success: false,
      message: error.message || "Server error",
      details: error.details || []
    });
  }
});

server.listen(PORT, () => {
  console.log(`Hunar AI Hiring Assistant running on http://localhost:${PORT}`);
});
