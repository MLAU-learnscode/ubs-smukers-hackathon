const MinHeap = require("../utils/minHeap");

const _EPS = 1e-9;

function parseIso(ts) {
  return new Date(ts).getTime() / 1000;
}

function epochToIso(epoch) {
  const rounded = Math.round(epoch);
  return new Date(rounded * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// Port of Python's bisect.bisect_right
function bisectRight(arr, val) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= val) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function traverseEdge(entryTime, baseDuration, obstructions) {
  if (baseDuration <= 0) return entryTime;

  let remaining = baseDuration;
  let t = entryTime;
  const starts = obstructions.map((o) => o[0]);
  const n = obstructions.length;

  while (remaining > _EPS) {
    let activeFactor = 1.0;
    let activeEnd = null;

    for (const [s, e, f] of obstructions) {
      if (s <= t && t < e) {
        if (activeEnd === null || f < activeFactor) {
          activeFactor = f;
          activeEnd = e;
        } else if (e < activeEnd && f <= activeFactor) {
          activeEnd = e;
        }
      }
    }

    let segmentEnd, factor;
    if (activeEnd !== null) {
      segmentEnd = activeEnd;
      factor = activeFactor;
    } else {
      const idx = bisectRight(starts, t);
      segmentEnd = idx < n ? obstructions[idx][0] : null;
      factor = 1.0;
    }

    if (factor <= 0.0) return null;

    const segmentLength = segmentEnd !== null ? segmentEnd - t : null;
    const timeNeeded = remaining / factor;

    if (segmentLength === null || timeNeeded <= segmentLength + _EPS) {
      t = t + timeNeeded;
      remaining = 0.0;
    } else {
      remaining -= segmentLength * factor;
      t = segmentEnd;
    }
  }

  return t;
}

function buildGraph(nodes, edges, obstructions) {
  const adj = new Map();

  for (const node of nodes) {
    const key = JSON.stringify(node);
    if (!adj.has(key)) adj.set(key, []);
  }

  const edgeBase = new Map();

  for (const e of edges) {
    const n1 = JSON.stringify(e.node1);
    const n2 = JSON.stringify(e.node2);
    const { edge_id: eid, base_duration_sec: dur } = e;
    if (!adj.has(n1)) adj.set(n1, []);
    if (!adj.has(n2)) adj.set(n2, []);
    adj.get(n1).push([eid, n2]);
    adj.get(n2).push([eid, n1]);
    edgeBase.set(eid, dur);
  }

  const obsMap = new Map();

  for (const o of obstructions) {
    const { edge_id: eid, edge, start_time, end_time, speed_factor } = o;
    const frm = JSON.stringify(edge.from);
    const to = JSON.stringify(edge.to);
    const key = `${eid}|${frm}|${to}`;
    if (!obsMap.has(key)) obsMap.set(key, []);
    obsMap.get(key).push([parseIso(start_time), parseIso(end_time), parseFloat(speed_factor)]);
  }

  for (const list of obsMap.values()) {
    list.sort((a, b) => a[0] - b[0]);
  }

  return { adj, edgeBase, obsMap };
}

function solveCase(caseData) {
  const startCoord = JSON.stringify(caseData.start_coordinate);
  const endCoord = JSON.stringify(caseData.end_coordinate);
  const startEpoch = parseIso(caseData.start_time);

  const { adj, edgeBase, obsMap } = buildGraph(
    caseData.nodes || [],
    caseData.edges || [],
    caseData.obstructions || []
  );

  if (startCoord === endCoord) {
    return { total_duration_sec: 0, arrival_time: epochToIso(startEpoch), path: [] };
  }

  const allEnds = [];
  for (const list of obsMap.values()) {
    for (const [, e] of list) allEnds.push(e);
  }
  const cutoff = allEnds.length > 0
    ? allEnds.reduce((a, b) => (b > a ? b : a), -Infinity)
    : startEpoch;

  const prev = new Map();       // `${node}|${time}` -> { prevNode, prevTime, eid }
  const processed = new Map();  // node -> Set<time>
  const settledLate = new Set();
  const heap = new MinHeap();
  heap.push([startEpoch, startCoord]);
  let arrivalEpoch = null;

  while (heap.size > 0) {
    const [t, node] = heap.pop();

    if (settledLate.has(node)) continue;
    if (processed.get(node)?.has(t)) continue;
    if (!processed.has(node)) processed.set(node, new Set());
    processed.get(node).add(t);

    if (node === endCoord) {
      arrivalEpoch = t;
      break;
    }

    for (const [eid, neighbor] of (adj.get(node) || [])) {
      const baseDur = edgeBase.get(eid);
      const obsList = obsMap.get(`${eid}|${node}|${neighbor}`) || [];
      const arrival = traverseEdge(t, baseDur, obsList);
      if (arrival === null) continue;
      if (processed.get(neighbor)?.has(arrival)) continue;
      const prevKey = `${neighbor}|${arrival}`;
      if (!prev.has(prevKey)) {
        prev.set(prevKey, { prevNode: node, prevTime: t, eid });
      }
      heap.push([arrival, neighbor]);
    }

    if (t > cutoff + _EPS) settledLate.add(node);
  }

  if (arrivalEpoch === null) {
    return { total_duration_sec: null, arrival_time: null, path: [] };
  }

  // Reconstruct path by walking back through (node, time) labels
  const pathEdges = [];
  let curNode = endCoord;
  let curT = arrivalEpoch;
  while (!(curNode === startCoord && curT === startEpoch)) {
    const { prevNode, prevTime, eid } = prev.get(`${curNode}|${curT}`);
    pathEdges.push(eid);
    curNode = prevNode;
    curT = prevTime;
  }
  pathEdges.reverse();

  return {
    total_duration_sec: Math.round(arrivalEpoch - startEpoch),
    arrival_time: epochToIso(arrivalEpoch),
    path: pathEdges,
  };
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
