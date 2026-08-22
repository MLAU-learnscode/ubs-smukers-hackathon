const MinHeap = require("../utils/minHeap");

function parseIso(ts) {
  return new Date(ts).getTime() / 1000;
}

function epochToIso(epoch) {
  const rounded = Math.round(epoch);
  return new Date(rounded * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function buildObsIndex(obstructions) {
  const idx = new Map();
  for (const ob of obstructions) {
    const key = `${ob.edge_id}|${JSON.stringify(ob.edge.from)}|${JSON.stringify(ob.edge.to)}`;
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push([parseIso(ob.start_time), parseIso(ob.end_time), parseFloat(ob.speed_factor)]);
  }
  for (const list of idx.values()) list.sort((a, b) => a[0] - b[0]);
  return idx;
}

function addDirection(adj, fromKey, toKey, eid, baseDur, obsIndex) {
  const obsList = obsIndex.get(`${eid}|${fromKey}|${toKey}`) || [];
  if (!adj.has(fromKey)) adj.set(fromKey, []);
  adj.get(fromKey).push([eid, toKey, baseDur, obsList]);
}

function buildGraph(nodes, edges, obstructions) {
  const adj = new Map();
  for (const n of nodes) {
    const key = JSON.stringify(n);
    if (!adj.has(key)) adj.set(key, []);
  }
  const obsIndex = buildObsIndex(obstructions);
  for (const e of edges) {
    const n1 = JSON.stringify(e.node1);
    const n2 = JSON.stringify(e.node2);
    const { edge_id: eid, base_duration_sec: dur } = e;
    addDirection(adj, n1, n2, eid, dur, obsIndex);
    addDirection(adj, n2, n1, eid, dur, obsIndex);
  }
  return adj;
}

function traverse(entryTime, baseDuration, obsList) {
  let remaining = baseDuration;
  if (remaining === 0) return entryTime;
  if (obsList.length === 0) return entryTime + remaining;
  let t = entryTime;

  while (true) {
    let factor = 1.0;
    
    // Calculate current factor
    for (const [s, e, f] of obsList) {
      if (s <= t && t < e) {
        if (f < factor) factor = f;
      }
    }
    
    if (factor === 0) return null;

    // Find next event time > t
    let nextEvent = null;
    for (const [s, e] of obsList) {
      if (s > t && (nextEvent === null || s < nextEvent)) nextEvent = s;
      if (e > t && (nextEvent === null || e < nextEvent)) nextEvent = e;
    }

    if (nextEvent === null) {
      return t + remaining / factor;
    } else {
      const available = nextEvent - t;
      const progressPossible = available * factor;
      if (progressPossible >= remaining) {
        return t + remaining / factor;
      } else {
        remaining -= progressPossible;
        t = nextEvent;
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
  const startTk = 0;

  // parent[`${node}|${tk}`] = { prevNode, prevTk, eid } — reconstructed once on arrival
  const parent = new Map();
  const expandedStates = new Map();
  const settledNodes = new Set();
  const heap = new MinHeap();
  let counter = 0;
  heap.push([startEpoch, counter, startCoord]);

  const MAX_ITER = 2_000_000;
  let iterations = 0;

  while (heap.size > 0) {
    if (++iterations > MAX_ITER) break;

    const [t, , node] = heap.pop();

    if (node === endCoord) {
      // Reconstruct path by following parent pointers backwards
      const path = [];
      let curNode = endCoord;
      let curTk = timeKey(t);
      while (!(curNode === startCoord && curTk === startTk)) {
        const { prevNode, prevTk, eid } = parent.get(`${curNode}|${curTk}`);
        path.push(eid);
        curNode = prevNode;
        curTk = prevTk;
      }
      path.reverse();
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
      const arrTk = timeKey(arrival);
      const pKey = `${neighbor}|${arrTk}`;
      if (!parent.has(pKey)) {
        parent.set(pKey, { prevNode: node, prevTk: tk, eid });
      }
      counter++;
      heap.push([arrival, counter, neighbor]);
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
