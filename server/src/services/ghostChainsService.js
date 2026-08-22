const crypto = require("crypto");
const MinHeap = require("../utils/minHeap");

const WINDOW_MS = 24 * 60 * 60 * 1000; // 24h lookback

// Starting weights — tune against the ordering-assertion test harness, not
// shipped as final. See roadmap section 4.3.
const BASE = 0.05;
const W_EXT = 0.15;
const W_CONV = 0.25;
const W_CYCLE = 0.35;
const W_LOOP = 0.35;

function diminish(n) {
  return 1 - 1 / (1 + n);
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function parseTime(createdAt) {
  const ms = typeof createdAt === "number" ? createdAt : Date.parse(createdAt);
  return Number.isFinite(ms) ? ms : NaN;
}

function hashPayload(tx) {
  const canonical = JSON.stringify({
    txId: tx.txId,
    from: tx.from,
    to: tx.to,
    amount: tx.amount,
    createdAt: tx.createdAt,
    ipAddress: tx.ipAddress ?? null,
    deviceId: tx.deviceId ?? null,
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

// Graph model + Phase 1 structural risk scoring.
//
// Scoring principle (checked in order of increasing structural strength —
// isolated < extension < convergence <= return < multi-loop):
//   1. Extension   - does this edge attach to something already active?
//   2. Convergence - do multiple existing paths from u's ancestry merge at v?
//   3. Return      - can v already reach u (this edge closes a cycle)?
//   4. Multi-loop  - how many independent first-hop branches out of v
//                    already lead back to u?
//
// An edge is always scored against the graph state *before* it is
// committed, then committed after, so a return edge can never "see itself".
class GhostChainsGraph {
  constructor() {
    this.reset();
  }

  reset() {
    this.nodes = new Map(); // id -> { out: Map<targetId, Edge[]>, in: Map<sourceId, Edge[]> }
    this.txStore = new Map(); // txId -> { payloadHash, riskScore }
    this.expiryHeap = new MinHeap(); // [createdAtMs, edge]
    this.latestSeenTime = 0;
  }

  _getOrCreateNode(id) {
    let node = this.nodes.get(id);
    if (!node) {
      node = { out: new Map(), in: new Map() };
      this.nodes.set(id, node);
    }
    return node;
  }

  _hasActiveEdges(id) {
    const node = this.nodes.get(id);
    return !!node && (node.out.size > 0 || node.in.size > 0);
  }

  // Pop and physically remove edges that fell out of the 24h window,
  // relative to the latest createdAt seen so far (not wall-clock time).
  // Boundary is inclusive: createdAt >= (latestSeenTime - WINDOW_MS) survives.
  _pruneExpired(nowMs) {
    const cutoff = nowMs - WINDOW_MS;
    while (this.expiryHeap.size > 0 && this.expiryHeap.heap[0][0] < cutoff) {
      const [, edge] = this.expiryHeap.pop();
      if (edge.removed) continue;
      this._removeEdge(edge);
    }
  }

  _removeEdge(edge) {
    edge.removed = true;

    const uNode = this.nodes.get(edge.from);
    if (uNode) {
      const arr = uNode.out.get(edge.to);
      if (arr) {
        const idx = arr.indexOf(edge);
        if (idx >= 0) arr.splice(idx, 1);
        if (arr.length === 0) uNode.out.delete(edge.to);
      }
      if (uNode.out.size === 0 && uNode.in.size === 0) this.nodes.delete(edge.from);
    }

    const vNode = this.nodes.get(edge.to);
    if (vNode) {
      const arr = vNode.in.get(edge.from);
      if (arr) {
        const idx = arr.indexOf(edge);
        if (idx >= 0) arr.splice(idx, 1);
        if (arr.length === 0) vNode.in.delete(edge.from);
      }
      if (vNode.out.size === 0 && vNode.in.size === 0) this.nodes.delete(edge.to);
    }
  }

  _commitEdge(edge) {
    const uNode = this._getOrCreateNode(edge.from);
    const vNode = this._getOrCreateNode(edge.to);

    if (!uNode.out.has(edge.to)) uNode.out.set(edge.to, []);
    uNode.out.get(edge.to).push(edge);

    if (!vNode.in.has(edge.from)) vNode.in.set(edge.from, []);
    vNode.in.get(edge.from).push(edge);

    this.expiryHeap.push([edge.createdAt, edge]);
  }

  // Ancestors of `id` reachable backward over active in-edges, excluding
  // `id` itself. Bounded by the (already window-pruned) active graph.
  _bfsBackwardAncestors(id) {
    const visited = new Set([id]);
    const queue = [id];
    while (queue.length > 0) {
      const cur = queue.shift();
      const node = this.nodes.get(cur);
      if (!node) continue;
      for (const src of node.in.keys()) {
        if (!visited.has(src)) {
          visited.add(src);
          queue.push(src);
        }
      }
    }
    visited.delete(id);
    return visited;
  }

  // Number of distinct existing predecessors of v that share a common
  // ancestor with u (including being u itself, an ancestor of u, or a
  // sibling descending from the same origin) — i.e. independent existing
  // paths merging at v that would, after this edge, trace back to a shared
  // origin with u. Catches sibling convergence (two branches from the same
  // ancestor meeting for the first time), not just direct lineage.
  _countConvergingPaths(v, u, ancestorsOfU) {
    const node = this.nodes.get(v);
    if (!node) return 0;
    const uOrAncestors = ancestorsOfU; // already excludes u; check separately
    let count = 0;
    for (const src of node.in.keys()) {
      if (src === u || uOrAncestors.has(src)) {
        count++;
        continue;
      }
      const srcAncestors = this._bfsBackwardAncestors(src);
      if (srcAncestors.has(u) || [...srcAncestors].some((a) => uOrAncestors.has(a))) count++;
    }
    return count;
  }

  _canReach(start, target) {
    if (start === target) return true;
    const visited = new Set([start]);
    const queue = [start];
    while (queue.length > 0) {
      const cur = queue.shift();
      const node = this.nodes.get(cur);
      if (!node) continue;
      for (const next of node.out.keys()) {
        if (next === target) return true;
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  }

  // Whether v can already reach u (this edge would close a cycle), plus how
  // many other independent loops already close through v — existing
  // predecessors of v that v can already reach (i.e. sit on a cycle with v).
  // Checking predecessors rather than v's own first-hop out-neighbors
  // catches loops that branch further downstream, not just at v itself.
  _reachesBackInfo(v, u) {
    const found = this._canReach(v, u);
    const node = this.nodes.get(v);
    if (!node) return { found, independentPathCount: 0 };
    let independentPathCount = 0;
    for (const src of node.in.keys()) {
      if (this._canReach(v, src)) independentPathCount++;
    }
    return { found, independentPathCount };
  }

  // Scores `tx` against the current active graph, then commits it. Returns
  // the risk score. `tx` must already have a numeric `createdAt` (ms epoch).
  scoreAndCommit(tx) {
    this.latestSeenTime = Math.max(this.latestSeenTime, tx.createdAt);
    this._pruneExpired(this.latestSeenTime);

    const edge = {
      txId: tx.txId,
      from: tx.from,
      to: tx.to,
      amount: tx.amount,
      createdAt: tx.createdAt,
      ipAddress: tx.ipAddress ?? undefined,
      deviceId: tx.deviceId ?? undefined,
      removed: false,
    };

    // Self-loops are a degenerate case: repeating/looping on the same node
    // doesn't create a new path, so treat as low-signal and skip structural
    // analysis entirely.
    if (tx.from === tx.to) {
      this._commitEdge(edge);
      return clamp(BASE, 0, 1);
    }

    const extensionSignal = this._hasActiveEdges(tx.from) || this._hasActiveEdges(tx.to) ? 1 : 0;
    const ancestorsOfU = this._bfsBackwardAncestors(tx.from);
    const convergenceCount = this._countConvergingPaths(tx.to, tx.from, ancestorsOfU);
    const { found: cycleClosed, independentPathCount } = this._reachesBackInfo(tx.to, tx.from);

    const raw =
      BASE +
      W_EXT * extensionSignal +
      W_CONV * diminish(convergenceCount) +
      W_CYCLE * (cycleClosed ? 1 : 0) +
      W_LOOP * diminish(independentPathCount);

    this._commitEdge(edge);
    return clamp(raw, 0, 1);
  }

  // Validates, applies idempotency, scores, and commits a raw transaction
  // payload. Throws an Error with `statusCode` set on invalid/conflicting input.
  processTransaction(txRaw) {
    if (!txRaw || typeof txRaw !== "object") {
      const err = new Error("transaction must be an object");
      err.statusCode = 400;
      throw err;
    }

    // Wire format uses fromUserId/toUserId; normalize to from/to for the
    // internal graph model (edges, hashing, scoring all speak from/to).
    const { txId, fromUserId: from, toUserId: to, amount, createdAt } = txRaw;
    if (typeof txId !== "string" || !txId) {
      const err = new Error("'txId' (non-empty string) is required");
      err.statusCode = 400;
      throw err;
    }
    if (typeof from !== "string" || !from || typeof to !== "string" || !to) {
      const err = new Error(`transaction ${txId}: 'fromUserId' and 'toUserId' (strings) are required`);
      err.statusCode = 400;
      throw err;
    }
    if (typeof amount !== "number" || !Number.isFinite(amount)) {
      const err = new Error(`transaction ${txId}: 'amount' (number) is required`);
      err.statusCode = 400;
      throw err;
    }
    const nowMs = parseTime(createdAt);
    if (!Number.isFinite(nowMs)) {
      const err = new Error(`transaction ${txId}: 'createdAt' is not a valid timestamp`);
      err.statusCode = 400;
      throw err;
    }

    const normalized = { txId, from, to, amount, createdAt: nowMs, ipAddress: txRaw.ipAddress, deviceId: txRaw.deviceId };
    const payloadHash = hashPayload(normalized);

    const existing = this.txStore.get(txId);
    if (existing) {
      if (existing.payloadHash === payloadHash) {
        return { txId, riskScore: existing.riskScore };
      }
      const err = new Error(`transaction ${txId}: duplicate txId with a different payload`);
      err.statusCode = 409;
      throw err;
    }

    const riskScore = this.scoreAndCommit({ ...normalized, createdAt: nowMs });
    this.txStore.set(txId, { payloadHash, riskScore });
    return { txId, riskScore };
  }
}

module.exports = { GhostChainsGraph, diminish, clamp };
