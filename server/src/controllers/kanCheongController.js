const MinHeap = require("../utils/minHeap");

function parseIso(ts) {
  return new Date(ts).getTime() / 1000;
}

function epochToIso(epoch) {
  const rounded = Math.round(epoch);
  return new Date(rounded * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function addDirection(adj, fromKey, toKey, eid, baseDur, obstructions) {
  const obsList = [];
  for (const ob of obstructions) {
    const obFrom = JSON.stringify(ob.edge.from);
    const obTo = JSON.stringify(ob.edge.to);
    if (ob.edge_id === eid && obFrom === fromKey && obTo === toKey) {
      obsList.push([parseIso(ob.start_time), parseIso(ob.end_time), parseFloat(ob.speed_factor)]);
    }
  }
  obsList.sort((a, b) => a[0] - b[0]);
  if (!adj.has(fromKey)) adj.set(fromKey, []);
  adj.get(fromKey).push([eid, toKey, baseDur, obsList]);
}

function buildGraph(nodes, edges, obstructions) {
  const adj = new Map();
  for (const n of nodes) {
    const key = JSON.stringify(n);
    if (!adj.has(key)) adj.set(key, []);
  }
  for (const e of edges) {
    const n1 = JSON.stringify(e.node1);
    const n2 = JSON.stringify(e.node2);
    const { edge_id: eid, base_duration_sec: dur } = e;
    addDirection(adj, n1, n2, eid, dur, obstructions);
    addDirection(adj, n2, n1, eid, dur, obstructions);
  }
  return adj;
}

function traverse(entryTime, baseDuration, obsList) {
  let remaining = baseDuration;
  let t = entryTime;
  if (remaining === 0) return t;

  while (true) {
    let activeFactor = 1.0;
    let activeEnd = null;

    for (const [s, e, factor] of obsList) {
      if (s <= t && t < e) {
        if (activeEnd === null || factor < activeFactor) {
          activeFactor = factor;
          activeEnd = activeEnd === null ? e : Math.min(activeEnd, e);
        }
      }
    }

    let regimeEnd, factor;
    if (activeEnd !== null) {
      regimeEnd = activeEnd;
      factor = activeFactor;
    } else {
      factor = 1.0;
      let minStart = null;
      for (const [s] of obsList) {
        if (s > t && (minStart === null || s < minStart)) minStart = s;
      }
      regimeEnd = minStart;
    }

    if (factor === 0) return null;

    if (regimeEnd === null) {
      return t + remaining / factor;
    } else {
      const available = regimeEnd - t;
      const progressPossible = available * factor;
      if (progressPossible >= remaining) {
        return t + remaining / factor;
      } else {
        remaining -= progressPossible;
        t = regimeEnd;
      }
    }
  }
}

function solveCase(caseData) {
  const startCoord = JSON.stringify(caseData.start_coordinate);
  const endCoord = JSON.stringify(caseData.end_coordinate);
  const startEpoch = parseIso(caseData.start_time);
  const obstructions = caseData.obstructions || [];

  const adj = buildGraph(caseData.nodes || [], caseData.edges || [], obstructions);

  if (startCoord === endCoord) {
    return { total_duration_sec: 0, arrival_time: epochToIso(startEpoch), path: [] };
  }

  let cutoff = startEpoch;
  for (const ob of obstructions) {
    const e = parseIso(ob.end_time);
    if (e > cutoff) cutoff = e;
  }

  const timeKey = (t) => Math.round((t - startEpoch) * 1e6) / 1e6;

  const expandedStates = new Map();
  const settledNodes = new Set();
  const heap = new MinHeap();
  let counter = 0;
  heap.push([startEpoch, counter, startCoord, []]);

  const MAX_ITER = 2_000_000;
  let iterations = 0;

  while (heap.size > 0) {
    if (++iterations > MAX_ITER) break;

    const [t, , node, path] = heap.pop();

    if (node === endCoord) {
      const duration = Math.round((t - startEpoch) * 1e6) / 1e6;
      const durationOut = duration === Math.floor(duration) ? Math.floor(duration) : duration;
      return { total_duration_sec: durationOut, arrival_time: epochToIso(t), path };
    }

    if (settledNodes.has(node)) continue;

    const tk = timeKey(t);
    if (!expandedStates.has(node)) expandedStates.set(node, new Set());
    const seen = expandedStates.get(node);
    if (seen.has(tk)) continue;
    seen.add(tk);

    if (t > cutoff) settledNodes.add(node);

    for (const [eid, neighbor, baseDur, obsList] of (adj.get(node) || [])) {
      const arrival = traverse(t, baseDur, obsList);
      if (arrival === null) continue;
      counter++;
      heap.push([arrival, counter, neighbor, path.concat(eid)]);
    }
  }

  return { total_duration_sec: null, arrival_time: null, path: [] };
}

const kanCheongDeliveryDriver = (req, res, next) => {
  try {
    const batch = req.body;
    const results = {};
    for (const [caseId, caseData] of Object.entries(batch)) {
      try {
        results[caseId] = solveCase(caseData);
      } catch {
        results[caseId] = { total_duration_sec: null, arrival_time: null, path: [] };
      }
    }
    res.status(200).json(results);
  } catch (err) {
    next(err);
  }
};

module.exports = { kanCheongDeliveryDriver };
