const PRIORITY_MAP = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
  URGENT: 4,
};
const DEFAULT_PRIORITY = 2;

function decodePayload(payload) {
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

  return {
    id: user.id ?? null,
    name: user.fullName ?? null,
    action: action.toLowerCase(),
    priority: normalizePriority(metadata.priority),
  };
}

function computeSlo(heartbeats, sloQuery) {
  if (!Array.isArray(heartbeats)) return { availability: null, p95LatencyMs: null };
  const service = sloQuery?.service ?? null;
  const since = sloQuery?.since != null ? Number(sloQuery.since) : 0;

  const filtered = heartbeats.filter((h) => {
    if (!h) return false;
    if (service !== null && h.service !== service) return false;
    return Number(h.timestamp) >= since;
  });

  if (filtered.length === 0) return { availability: null, p95LatencyMs: null };

  const okCount = filtered.filter((h) => String(h.status ?? "").toUpperCase() === "OK").length;
  const availability = okCount / filtered.length;

  const latencies = filtered
    .map((h) => Number(h.latencyMs))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const p95LatencyMs = latencies.length > 0
    ? latencies[Math.ceil(0.95 * latencies.length) - 1]
    : null;

  return { availability, p95LatencyMs };
}

const solve = (req, res, next) => {
  try {
    const { payload } = req.body;

    if (typeof payload !== "string") {
      const err = new Error("'payload' field (base64 string) is required");
      err.statusCode = 400;
      return next(err);
    }

    const decoded = decodePayload(payload);

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
