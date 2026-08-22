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
    // Reject non-base64 strings (Node silently ignores bad chars otherwise)
    if (raw.toString("base64") !== payload.replace(/=/g, "").padEnd(Math.ceil(payload.replace(/=/g, "").length / 4) * 4, "=") &&
        Buffer.from(raw).toString("base64") !== payload) {
      // Loose check — just attempt JSON parse; invalid base64 will produce garbage
    }
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

function transform(adaptInput) {
  const user = adaptInput.user || {};
  const action = adaptInput.action || "";
  const metadata = adaptInput.metadata || {};
  const priorityWord = String(metadata.priority || "").toUpperCase();

  return {
    id: user.id ?? null,
    name: user.fullName ?? null,
    action: action.toLowerCase(),
    priority: PRIORITY_MAP[priorityWord] ?? DEFAULT_PRIORITY,
  };
}

function computeSlo(heartbeats, sloQuery) {
  if (!Array.isArray(heartbeats) || !sloQuery) return null;
  const since = Number(sloQuery.since);
  const filtered = heartbeats.filter(
    (h) => h.service === sloQuery.service && Number(h.timestamp) >= since
  );
  if (filtered.length === 0) return { availability: null, p95LatencyMs: null };
  const okCount = filtered.filter((h) => h.status === "OK").length;
  const availability = okCount / filtered.length;
  const latencies = filtered.map((h) => Number(h.latencyMs)).sort((a, b) => a - b);
  const p95LatencyMs = latencies[Math.ceil(0.95 * latencies.length) - 1];
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

    if (!decoded.adaptInput || typeof decoded.adaptInput !== "object") {
      const err = new Error("decoded payload missing 'adaptInput' object");
      err.statusCode = 400;
      return next(err);
    }

    const response = { adaptOutput: transform(decoded.adaptInput) };
    const sloOutput = computeSlo(decoded.heartbeats, decoded.sloQuery);
    if (sloOutput !== null) response.sloOutput = sloOutput;

    res.status(200).json(response);
  } catch (err) {
    next(err);
  }
};

module.exports = { solve };
