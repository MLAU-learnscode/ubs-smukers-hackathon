const PRIORITY_MAP = {
  LOW: 1,
  MEDIUM: 2,
  DEFAULT: 2,
  NORMAL: 2,
  HIGH: 3,
  CRITICAL: 4,
  URGENT: 4,
};
const DEFAULT_PRIORITY = 2;

function decodePayload(payload) {
  if (!/^[A-Za-z0-9+/=_-]+$/.test(payload)) {
    const err = new Error("payload is not valid base64");
    err.statusCode = 400;
    throw err;
  }

  let raw;
  try {
    raw = Buffer.from(payload, "base64");
  } catch {
    const err = new Error("payload is not valid base64");
    err.statusCode = 400;
    throw err;
  }

  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    const err = new Error("decoded payload is not valid JSON");
    err.statusCode = 400;
    throw err;
  }
}

function normalizePriority(rawPriority) {
  if (typeof rawPriority === "number" && Number.isFinite(rawPriority)) {
    return rawPriority;
  }

  const word = String(rawPriority ?? "").toUpperCase();
  if (PRIORITY_MAP[word] != null) return PRIORITY_MAP[word];

  const asNumber = Number(rawPriority);
  if (rawPriority !== "" && rawPriority != null && Number.isFinite(asNumber)) {
    return asNumber;
  }

  return DEFAULT_PRIORITY;
}

function transform(adaptInput) {
  const user = adaptInput.user || {};
  const action = adaptInput.action || "";
  const metadata = adaptInput.metadata || {};

  const id = user.id ?? adaptInput.userId ?? adaptInput.id ?? null;
  const name = user.fullName ?? user.name ?? adaptInput.fullName ?? adaptInput.name ?? null;
  const rawPriority = metadata.priority ?? adaptInput.priority ?? user.priority;

  return {
    id,
    name,
    action: action.toLowerCase(),
    priority: normalizePriority(rawPriority),
  };
}

function computeSlo(heartbeats, sloQuery) {
  if (!Array.isArray(heartbeats)) return { availability: null, p95LatencyMs: null };
  const service = sloQuery?.service ?? null;
  const since = sloQuery?.since != null ? Number(sloQuery.since) : 0;

  const filtered = heartbeats.filter((h) => {
    if (!h || typeof h !== "object") return false;
    if (service !== null && h.service !== service) return false;
    
    const ts = Number(h.timestamp);
    if (!Number.isFinite(ts) || ts < since) return false;

    const lat = Number(h.latencyMs);
    if (!Number.isFinite(lat)) return false;

    return true;
  });

  if (filtered.length === 0) return { availability: null, p95LatencyMs: null };

  const okCount = filtered.filter((h) => String(h.status ?? "").toUpperCase() === "OK").length;
  const availability = okCount / filtered.length;

  const latencies = filtered
    .map((h) => Number(h.latencyMs))
    .sort((a, b) => a - b);

  const p95Index = Math.max(0, Math.ceil(0.95 * latencies.length) - 1);
  const p95LatencyMs = latencies[p95Index];

  return { availability, p95LatencyMs };
}

const solve = (req, res, next) => {
  try {
    let decoded;

    if (req.body && typeof req.body.payload === "string") {
      decoded = decodePayload(req.body.payload);
    } else if (req.body && typeof req.body === "object" && (req.body.adaptInput || req.body.heartbeats)) {
      decoded = req.body;
    } else {
      const err = new Error("Invalid request payload. Expected base64 string 'payload' or raw JSON.");
      err.statusCode = 400;
      return next(err);
    }

    const response = {};

    if (decoded.adaptInput && typeof decoded.adaptInput === "object") {
      response.adaptOutput = transform(decoded.adaptInput);
    }

    if ("heartbeats" in decoded) {
      response.sloOutput = computeSlo(decoded.heartbeats, decoded.sloQuery);
    }

    if (!("adaptOutput" in response) && !("sloOutput" in response)) {
      const err = new Error("decoded payload missing both 'adaptInput' and 'heartbeats'");
      err.statusCode = 400;
      return next(err);
    }

    res.status(200).json(response);
  } catch (err) {
    next(err);
  }
};

module.exports = { solve };
