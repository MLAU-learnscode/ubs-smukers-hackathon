const zlib = require("zlib");

// Priority Mapping Dictionary
const PRIORITY_MAP = {
  // Low priority
  DEBUG: 0,
  NONE: 0,
  INFO: 1,
  INFORMATIONAL: 1,
  TRIVIAL: 1,
  MINIMAL: 1,
  LOWEST: 1,
  VERY_LOW: 1,
  VERYLOW: 1,
  LOW: 1,
  P3: 1,
  P4: 1,

  // Medium / Default priority
  MEDIUM: 2,
  MED: 2,
  NORMAL: 2,
  DEFAULT: 2,
  STANDARD: 2,
  MODERATE: 2,
  P2: 2,

  // High priority
  HIGH: 3,
  MAJOR: 3,
  WARN: 3,
  WARNING: 3,
  VERY_HIGH: 4,
  VERYHIGH: 4,
  HIGHEST: 4,
  P1: 3,

  // Critical / Urgent priority
  CRITICAL: 4,
  URGENT: 4,
  BLOCKER: 4,
  SEVERE: 4,
  FATAL: 4,
  EMERGENCY: 4,
  P0: 4,
};

const DEFAULT_PRIORITY = 2;

function normalizePriority(rawPriority) {
  if (typeof rawPriority === "number" && Number.isFinite(rawPriority)) {
    return Math.round(rawPriority);
  }

  if (rawPriority == null || rawPriority === "") {
    return DEFAULT_PRIORITY;
  }

  const str = String(rawPriority).trim();
  const upper = str.toUpperCase().replace(/[\s-_]+/g, "_");
  if (PRIORITY_MAP[upper] != null) return PRIORITY_MAP[upper];

  // Try parsing as number
  const num = Number(str);
  if (Number.isFinite(num)) {
    return Math.round(num);
  }

  // Check prefix / substrings
  if (
    upper.startsWith("CRIT") ||
    upper.startsWith("URG") ||
    upper.startsWith("EMERG") ||
    upper.startsWith("BLOCK") ||
    upper.startsWith("SEVER") ||
    upper.startsWith("FATAL")
  ) {
    return 4;
  }
  if (upper.startsWith("HIGH")) return 3;
  if (
    upper.startsWith("MED") ||
    upper.startsWith("NORM") ||
    upper.startsWith("DEF") ||
    upper.startsWith("MOD")
  ) {
    return 2;
  }
  if (
    upper.startsWith("LOW") ||
    upper.startsWith("MIN") ||
    upper.startsWith("INF")
  ) {
    return 1;
  }

  return DEFAULT_PRIORITY;
}

function priorityToWord(priorityNum) {
  switch (priorityNum) {
    case 1:
      return "LOW";
    case 2:
      return "MEDIUM";
    case 3:
      return "HIGH";
    case 4:
      return "CRITICAL";
    default:
      if (priorityNum <= 1) return "LOW";
      if (priorityNum >= 4) return "CRITICAL";
      return "MEDIUM";
  }
}

function isV2ToV1Request(input, parentContext = {}) {
  if (input == null || typeof input !== "object") return false;

  const targetVer = String(
    input.targetVersion ??
      input.target_version ??
      input.to ??
      parentContext.targetVersion ??
      parentContext.to ??
      ""
  ).toLowerCase();
  if (targetVer === "v1" || targetVer === "1") return true;

  const ver = String(
    input.version ??
      parentContext.version ??
      input.from ??
      parentContext.from ??
      ""
  ).toLowerCase();
  if (ver === "v2" || ver === "2") {
    if (targetVer !== "v2" && targetVer !== "2") return true;
  }

  return false;
}

function transformV1ToV2(item) {
  if (item == null || typeof item !== "object") return item;

  const user =
    item.user && typeof item.user === "object" ? item.user : {};
  const metadata =
    item.metadata && typeof item.metadata === "object"
      ? item.metadata
      : item.meta && typeof item.meta === "object"
      ? item.meta
      : {};

  // Extract ID
  const id =
    user.id ??
    user.userId ??
    user.user_id ??
    user.ID ??
    user.uuid ??
    user.guid ??
    item.id ??
    item.userId ??
    item.user_id ??
    item.ID ??
    item.uuid ??
    item.guid ??
    (typeof item.user === "string" && !item.user.includes(" ") ? item.user : null);

  // Extract Name
  let name =
    user.fullName ??
    user.full_name ??
    user.name ??
    user.userName ??
    user.user_name ??
    user.displayName ??
    user.display_name ??
    user.Name ??
    item.fullName ??
    item.full_name ??
    item.name ??
    item.userName ??
    item.user_name ??
    item.displayName ??
    item.display_name ??
    item.Name;

  if (!name && (user.firstName || user.first_name || user.givenName)) {
    const first = user.firstName ?? user.first_name ?? user.givenName ?? "";
    const last =
      user.lastName ?? user.last_name ?? user.familyName ?? user.surname ?? "";
    name = `${first} ${last}`.trim() || null;
  } else if (!name && (item.firstName || item.first_name || item.givenName)) {
    const first = item.firstName ?? item.first_name ?? item.givenName ?? "";
    const last =
      item.lastName ?? item.last_name ?? item.familyName ?? item.surname ?? "";
    name = `${first} ${last}`.trim() || null;
  } else if (!name && typeof item.user === "string" && item.user.includes(" ")) {
    name = item.user;
  }

  // Extract Action
  const actionRaw =
    item.action ??
    item.operation ??
    item.type ??
    item.method ??
    item.command ??
    item.verb ??
    item.event ??
    item.actionType ??
    item.action_type ??
    "";
  const action = String(actionRaw).trim().toLowerCase();

  // Extract Priority
  const rawPriority =
    metadata.priority ??
    metadata.level ??
    metadata.prio ??
    metadata.priorityLevel ??
    metadata.priority_level ??
    metadata.importance ??
    metadata.severity ??
    item.priority ??
    item.level ??
    item.prio ??
    item.priorityLevel ??
    item.priority_level ??
    user.priority;

  const priority = normalizePriority(rawPriority);

  return {
    id: id != null ? String(id) : null,
    name: name != null ? String(name) : null,
    action,
    priority,
  };
}

function transformV2ToV1(item) {
  if (item == null || typeof item !== "object") return item;

  const id = item.id ?? item.userId ?? item.user_id ?? item.user?.id ?? null;
  const fullName =
    item.name ??
    item.fullName ??
    item.full_name ??
    item.user?.fullName ??
    item.user?.name ??
    null;

  const actionRaw = item.action ?? item.operation ?? item.type ?? "";
  const action = String(actionRaw).trim().toUpperCase();

  const rawPriority = item.priority ?? item.metadata?.priority ?? item.level ?? 2;
  let priorityWord = "MEDIUM";
  if (typeof rawPriority === "number") {
    priorityWord = priorityToWord(rawPriority);
  } else {
    const norm = normalizePriority(rawPriority);
    priorityWord = priorityToWord(norm);
  }

  return {
    user: {
      id: id != null ? String(id) : null,
      fullName: fullName != null ? String(fullName) : null,
    },
    action,
    metadata: {
      priority: priorityWord,
    },
  };
}

function transformAdaptInput(adaptInput, parentContext = {}) {
  if (Array.isArray(adaptInput)) {
    return adaptInput.map((elem) => {
      if (isV2ToV1Request(elem, parentContext)) {
        return transformV2ToV1(elem);
      }
      return transformV1ToV2(elem);
    });
  }

  if (isV2ToV1Request(adaptInput, parentContext)) {
    return transformV2ToV1(adaptInput);
  }

  return transformV1ToV2(adaptInput);
}

function parseTimestamp(val) {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const trimmed = val.trim();
    const num = Number(trimmed);
    if (Number.isFinite(num)) return num;
    const parsedDate = Date.parse(trimmed);
    if (!isNaN(parsedDate)) {
      return parsedDate;
    }
  }
  return NaN;
}

function parseLatency(val) {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const cleaned = val.trim().toLowerCase();
    if (cleaned.endsWith("ms")) {
      const n = parseFloat(cleaned.slice(0, -2));
      return Number.isFinite(n) ? n : NaN;
    }
    if (cleaned.endsWith("s") && !cleaned.endsWith("ms")) {
      const n = parseFloat(cleaned.slice(0, -1));
      return Number.isFinite(n) ? n * 1000 : NaN;
    }
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

function isHeartbeatOk(h) {
  if (h.status === true || h.ok === true || h.success === true) return true;
  if (h.status === false || h.ok === false || h.success === false) return false;

  if (typeof h.status === "number") return h.status >= 200 && h.status < 400;
  if (typeof h.statusCode === "number") return h.statusCode >= 200 && h.statusCode < 400;
  if (typeof h.code === "number") return h.code >= 200 && h.code < 400;

  const rawStatus = h.status ?? h.state ?? h.result ?? h.health ?? "";
  const s = String(rawStatus).trim().toUpperCase();

  if (
    s === "OK" ||
    s === "SUCCESS" ||
    s === "PASS" ||
    s === "UP" ||
    s === "HEALTHY" ||
    s === "TRUE" ||
    s === "200" ||
    s === "SUCCESSFUL"
  ) {
    return true;
  }
  if (/^2\d\d$/.test(s)) return true;

  return false;
}

// In-memory heartbeat storage for stateful streaming / multi-request evaluation
const inMemoryHeartbeats = [];

function addHeartbeats(hbs) {
  if (!Array.isArray(hbs)) return;
  for (const h of hbs) {
    if (h && typeof h === "object") {
      inMemoryHeartbeats.push(h);
    }
  }
}

function getStoredHeartbeats() {
  return inMemoryHeartbeats;
}

function resetHeartbeats() {
  inMemoryHeartbeats.length = 0;
}

function computeSingleSlo(heartbeats, query = {}) {
  const list = Array.isArray(heartbeats) ? heartbeats : inMemoryHeartbeats;
  if (!Array.isArray(list) || list.length === 0) {
    return { availability: null, p95LatencyMs: null };
  }

  const queryService =
    query?.service ??
    query?.serviceName ??
    query?.service_name ??
    query?.name ??
    query?.svc ??
    null;
  const sinceRaw =
    query?.since ??
    query?.from ??
    query?.start ??
    query?.startTime ??
    query?.start_time ??
    query?.minTimestamp ??
    query?.min_timestamp ??
    null;
  const untilRaw =
    query?.until ??
    query?.to ??
    query?.end ??
    query?.endTime ??
    query?.end_time ??
    query?.maxTimestamp ??
    query?.max_timestamp ??
    null;

  const since = sinceRaw != null ? parseTimestamp(sinceRaw) : -Infinity;
  const until = untilRaw != null ? parseTimestamp(untilRaw) : Infinity;

  const isQueryMs = Number.isFinite(since) && since > 1e11;
  const isQuerySec = Number.isFinite(since) && since > 0 && since < 1e11;

  const filtered = list.filter((h) => {
    if (!h || typeof h !== "object") return false;

    // Service matching (case-insensitive)
    if (
      queryService !== null &&
      queryService !== "" &&
      queryService !== "*" &&
      String(queryService).toLowerCase() !== "all"
    ) {
      const hService =
        h.service ?? h.serviceName ?? h.service_name ?? h.name ?? h.svc ?? null;
      if (hService == null) return false;

      if (Array.isArray(queryService)) {
        const lowerList = queryService.map((s) => String(s).trim().toLowerCase());
        if (!lowerList.includes(String(hService).trim().toLowerCase())) return false;
      } else {
        if (String(hService).trim().toLowerCase() !== String(queryService).trim().toLowerCase()) {
          return false;
        }
      }
    }

    // Timestamp matching
    const rawTs =
      h.timestamp ??
      h.time ??
      h.ts ??
      h.timestampMs ??
      h.timestamp_ms ??
      h.created_at ??
      h.createdAt;
    if (rawTs != null) {
      let ts = parseTimestamp(rawTs);
      if (!Number.isFinite(ts)) return false;

      // Normalize if query is in seconds but ts is in ms or vice-versa
      if (isQuerySec && ts > 1e11) ts = Math.floor(ts / 1000);
      if (isQueryMs && ts < 1e11) ts = ts * 1000;

      if (Number.isFinite(since) && ts < since) return false;
      if (Number.isFinite(until) && ts > until) return false;
    } else if (Number.isFinite(since) && since > -Infinity) {
      return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    return { availability: null, p95LatencyMs: null };
  }

  const okCount = filtered.filter(isHeartbeatOk).length;
  const availability = okCount / filtered.length;

  const latencies = filtered
    .map((h) => {
      const rawLat =
        h.latencyMs ??
        h.latency_ms ??
        h.latency ??
        h.durationMs ??
        h.duration_ms ??
        h.duration ??
        h.responseTimeMs ??
        h.response_time_ms ??
        h.responseTime;
      return parseLatency(rawLat);
    })
    .filter((lat) => Number.isFinite(lat) && lat >= 0)
    .sort((a, b) => a - b);

  let p95LatencyMs = null;
  if (latencies.length > 0) {
    const p95Index = Math.max(0, Math.ceil(0.95 * latencies.length) - 1);
    p95LatencyMs = latencies[p95Index];
  }

  return { availability, p95LatencyMs };
}

function computeSlo(heartbeats, sloQuery) {
  if (Array.isArray(sloQuery)) {
    return sloQuery.map((q) => computeSingleSlo(heartbeats, q));
  }
  return computeSingleSlo(heartbeats, sloQuery);
}

function decodeBase64String(str) {
  let cleaned = str.trim();
  if (cleaned.startsWith("\"") && cleaned.endsWith("\"")) {
    try {
      cleaned = JSON.parse(cleaned);
    } catch {}
  }

  if (cleaned.includes("%")) {
    try {
      cleaned = decodeURIComponent(cleaned);
    } catch {}
  }

  if (
    (cleaned.startsWith("{") && cleaned.endsWith("}")) ||
    (cleaned.startsWith("[") && cleaned.endsWith("]"))
  ) {
    try {
      return JSON.parse(cleaned);
    } catch {}
  }

  cleaned = cleaned.replace(/\s+/g, "");

  let stdB64 = cleaned.replace(/-/g, "+").replace(/_/g, "/");
  while (stdB64.length % 4 !== 0) {
    stdB64 += "=";
  }

  let buf;
  try {
    buf = Buffer.from(stdB64, "base64");
  } catch {
    throw new Error("payload is not valid base64");
  }

  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      buf = zlib.gunzipSync(buf);
    } catch {}
  } else if (
    buf.length >= 2 &&
    buf[0] === 0x78 &&
    (buf[1] === 0x9c || buf[1] === 0x01 || buf[1] === 0xda || buf[1] === 0x5e)
  ) {
    try {
      buf = zlib.inflateSync(buf);
    } catch {}
  }

  const utf8 = buf.toString("utf8");

  try {
    return JSON.parse(utf8);
  } catch {}

  try {
    const nested = decodeBase64String(utf8);
    if (nested && typeof nested === "object") return nested;
  } catch {}

  throw new Error("decoded payload is not valid JSON");
}

function extractPayload(req) {
  let body = req.body;

  if (typeof body === "string") {
    body = body.trim();
    if (body.startsWith("{") || body.startsWith("[")) {
      try {
        body = JSON.parse(body);
      } catch {
        return decodeBase64String(body);
      }
    } else {
      return decodeBase64String(body);
    }
  }

  if (body && typeof body === "object" && !Array.isArray(body)) {
    const keys = Object.keys(body);
    if (
      keys.length === 1 &&
      body[keys[0]] === "" &&
      (keys[0].startsWith("{") || keys[0].startsWith("["))
    ) {
      try {
        body = JSON.parse(keys[0]);
      } catch {}
    }
  }

  if (body && typeof body === "object") {
    if ("payload" in body) {
      if (typeof body.payload === "string") {
        return decodeBase64String(body.payload);
      }
      if (typeof body.payload === "object" && body.payload !== null) {
        return body.payload;
      }
    }
    if (
      body.adaptInput ||
      body.adapt_input ||
      body.adaptInputs ||
      body.adapt_inputs ||
      body.heartbeats ||
      body.heartbeat ||
      body.heart_beats ||
      body.sloQuery ||
      body.slo_query ||
      body.sloQueries ||
      body.slo_queries ||
      body.action ||
      body.user
    ) {
      return body;
    }
  }

  throw new Error("Invalid request payload. Expected base64 string 'payload' or raw JSON.");
}

const solve = (req, res, next) => {
  try {
    const decoded = extractPayload(req);

    if (decoded.reset === true || decoded.clear === true) {
      resetHeartbeats();
    }

    const response = {};

    const hasAdaptInput =
      ("adaptInput" in decoded && decoded.adaptInput != null) ||
      ("adapt_input" in decoded && decoded.adapt_input != null) ||
      ("adaptInputs" in decoded && decoded.adaptInputs != null) ||
      ("adapt_inputs" in decoded && decoded.adapt_inputs != null) ||
      Boolean(decoded.user || decoded.action || (decoded.id && decoded.name));

    if (hasAdaptInput) {
      const input =
        decoded.adaptInput ??
        decoded.adapt_input ??
        decoded.adaptInputs ??
        decoded.adapt_inputs ??
        decoded;
      response.adaptOutput = transformAdaptInput(input, decoded);
    }

    const hasHeartbeats =
      ("heartbeats" in decoded && Array.isArray(decoded.heartbeats)) ||
      ("heartbeat" in decoded && Array.isArray(decoded.heartbeat)) ||
      ("heart_beats" in decoded && Array.isArray(decoded.heart_beats));

    const hasSloQuery =
      ("sloQuery" in decoded && decoded.sloQuery != null) ||
      ("slo_query" in decoded && decoded.slo_query != null) ||
      ("sloQueries" in decoded && decoded.sloQueries != null) ||
      ("slo_queries" in decoded && decoded.slo_queries != null);

    if (hasHeartbeats) {
      const hbs =
        decoded.heartbeats ?? decoded.heartbeat ?? decoded.heart_beats;
      addHeartbeats(hbs);
    }

    if (hasSloQuery) {
      const query =
        decoded.sloQuery ??
        decoded.slo_query ??
        decoded.sloQueries ??
        decoded.slo_queries;
      const hbs = hasHeartbeats
        ? (decoded.heartbeats ?? decoded.heartbeat ?? decoded.heart_beats)
        : getStoredHeartbeats();
      response.sloOutput = computeSlo(hbs, query);
    } else if (hasHeartbeats) {
      const hbs =
        decoded.heartbeats ?? decoded.heartbeat ?? decoded.heart_beats;
      response.sloOutput = computeSlo(hbs, null);
    }

    if (!("adaptOutput" in response) && !("sloOutput" in response)) {
      console.warn("[SOLVE 400] decoded payload missing both 'adaptInput' and 'heartbeats'", decoded);
      return res.status(400).json({
        error: "decoded payload missing both 'adaptInput' and 'heartbeats'",
      });
    }

    console.log("[BOT_INPUT]", JSON.stringify(decoded));
    console.log("[BOT_OUTPUT]", JSON.stringify(response));
    return res.status(200).json(response);
  } catch (err) {
    console.error("[SOLVE 400 ERROR]", err.message);
    return res.status(400).json({ error: err.message || "Bad Request" });
  }
};

const reset = (req, res) => {
  resetHeartbeats();
  return res.status(200).json({ reset: true });
};

module.exports = {
  solve,
  reset,
  transformAdaptInput,
  computeSlo,
  decodeBase64String,
  extractPayload,
  normalizePriority,
  addHeartbeats,
  getStoredHeartbeats,
  resetHeartbeats,
};
