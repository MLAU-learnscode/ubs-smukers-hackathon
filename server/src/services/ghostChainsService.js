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

// Phase 2 identity weights. Applied independently per dimension (ipAddress,
// deviceId) and summed into the same raw score before the final clamp.
const W_ID_BREAK = 0.2; // mid-flow identity shift or dropped identity on a continuous flow
const W_ID_CROSS = 0.15; // same identity value reused across disconnected components
const IDENTITY_DIMENSIONS = ["ipAddress", "deviceId"];

// Phase 3 value weights. Value evidence is evaluated against a single
// inferred flow segment (the most recent inbound edge on `from`), never
// aggregated across sibling branches — see _valueSignal.
const W_VALUE_REVERSAL = 0.35; // amount grows past what fed into this leg: contradicts layering
const W_VALUE_CONFIRM = 0.1; // amount keeps shrinking, streak-scaled: confirms layering
const VALUE_REVERSAL_SENSITIVITY = 100; // scales a small % overshoot into diminish()'s useful range

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
    // Per-dimension identity value -> Set<Edge> currently carrying that value.
    this.identityIndex = { ipAddress: new Map(), deviceId: new Map() };
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

    for (const dim of IDENTITY_DIMENSIONS) {
      const value = edge[dim];
      if (value === undefined) continue;
      const set = this.identityIndex[dim].get(value);
      if (set) {
        set.delete(edge);
        if (set.size === 0) this.identityIndex[dim].delete(value);
      }
    }

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

    for (const dim of IDENTITY_DIMENSIONS) {
      const value = edge[dim];
      if (value === undefined) continue;
      let set = this.identityIndex[dim].get(value);
      if (!set) {
        set = new Set();
        this.identityIndex[dim].set(value, set);
      }
      set.add(edge);
    }
  }

  // Undirected reachability over the active graph (both in- and out-edges),
  // used only for identity's "disconnected component" check — structural
  // scoring elsewhere stays directed.
  _undirectedComponent(startId) {
    const visited = new Set([startId]);
    const queue = [startId];
    while (queue.length > 0) {
      const cur = queue.shift();
      const node = this.nodes.get(cur);
      if (!node) continue;
      for (const next of node.out.keys()) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
      for (const prev of node.in.keys()) {
        if (!visited.has(prev)) {
          visited.add(prev);
          queue.push(prev);
        }
      }
    }
    return visited;
  }

  // Identity signal for one dimension (ipAddress/deviceId) on the edge about
  // to be committed. Two independent sub-signals, both evaluated against
  // graph state *before* this edge:
  //
  //  - "break": the edges already flowing into `from` carry a single,
  //    consistent value for this dimension, and this edge either changes it
  //    (identity shift mid-flow / at a branch) or drops it entirely (a
  //    plausible way to sever the trail). Only fires when upstream is
  //    unambiguous — if upstream is already mixed, that ambiguity was
  //    already scored on the edge that caused it.
  //  - "cross": this edge's value (if present) is already in use by other
  //    active edges sitting in a different undirected component. Counts
  //    distinct external components, not raw edge count, so a burst of
  //    edges within the same disconnected cluster doesn't inflate the
  //    signal.
  _identitySignal(dim, from, to, value) {
    const fromNode = this.nodes.get(from);
    let breakSignal = 0;
    if (fromNode) {
      const upstreamValues = new Set();
      for (const arr of fromNode.in.values()) {
        for (const e of arr) {
          if (e[dim] !== undefined) upstreamValues.add(e[dim]);
        }
      }
      if (upstreamValues.size === 1) {
        const [onlyValue] = upstreamValues;
        if (value === undefined || value !== onlyValue) breakSignal = 1;
      }
    }

    let crossCount = 0;
    if (value !== undefined) {
      const sameValueEdges = this.identityIndex[dim].get(value);
      if (sameValueEdges && sameValueEdges.size > 0) {
        const localComponent = this._undirectedComponent(from);
        localComponent.add(to);
        const externalVisited = new Set();
        for (const e of sameValueEdges) {
          if (localComponent.has(e.from) || localComponent.has(e.to)) continue;
          if (externalVisited.has(e.from) || externalVisited.has(e.to)) continue;
          const otherComponent = this._undirectedComponent(e.from);
          for (const id of otherComponent) externalVisited.add(id);
          crossCount++;
        }
      }
    }

    return W_ID_BREAK * breakSignal + W_ID_CROSS * diminish(crossCount);
  }

  // Value signal for the edge about to be committed (from -> ... -> to,
  // amount). Compares `amount` against the single most recent active edge
  // feeding into `from` — the best available guess at which inbound leg this
  // outbound leg continues. Deliberately *not* aggregated across all of
  // from's inbound edges: at a branch or convergence point each inbound edge
  // represents an independent flow hypothesis, and mixing their amounts
  // would blur exactly the segmentation the briefing calls out.
  //
  //  - amount <= predecessor's amount: expected layering decay. Confirms the
  //    pattern; each additional consecutive confirming hop (tracked via
  //    edge.decayStreak) very slightly reduces risk, saturating quickly.
  //  - amount > predecessor's amount: reversal. Contradicts layering outright
  //    and is scored as a standalone strong positive signal, scaled by how
  //    far the amount overshot the predecessor.
  //
  // No inbound edge on `from` (root of a flow, or isolated) yields no value
  // evidence at all — there is nothing yet to confirm or contradict.
  _valueSignal(from, amount) {
    const node = this.nodes.get(from);
    let predecessor = null;
    if (node) {
      for (const arr of node.in.values()) {
        for (const e of arr) {
          if (!predecessor || e.createdAt > predecessor.createdAt) predecessor = e;
        }
      }
    }

    if (!predecessor || !Number.isFinite(predecessor.amount) || predecessor.amount <= 0) {
      return { raw: 0, decayStreak: 0 };
    }

    const ratio = amount / predecessor.amount;
    if (ratio > 1) {
      const excess = ratio - 1;
      return { raw: W_VALUE_REVERSAL * diminish(excess * VALUE_REVERSAL_SENSITIVITY), decayStreak: 0 };
    }

    const streak = 1 + (predecessor.decayStreak || 0);
    return { raw: -W_VALUE_CONFIRM * diminish(streak - 1), decayStreak: streak };
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

    // Self-loops are a degenerate case for *structural* analysis: repeating
    // on the same node doesn't create a new path, so extension/convergence/
    // cycle/loop signals are skipped. Identity and value evidence are still
    // meaningful on a self-loop (funds round-tripping through one node on a
    // different device, or at a wildly different amount, is itself a
    // plausible evasion pattern) so those signals still run.
    const isSelfLoop = tx.from === tx.to;

    const extensionSignal = !isSelfLoop && (this._hasActiveEdges(tx.from) || this._hasActiveEdges(tx.to)) ? 1 : 0;
    const ancestorsOfU = isSelfLoop ? new Set() : this._bfsBackwardAncestors(tx.from);
    const convergenceCount = isSelfLoop ? 0 : this._countConvergingPaths(tx.to, tx.from, ancestorsOfU);
    const { found: cycleClosed, independentPathCount } = isSelfLoop
      ? { found: false, independentPathCount: 0 }
      : this._reachesBackInfo(tx.to, tx.from);

    let identityRaw = 0;
    for (const dim of IDENTITY_DIMENSIONS) {
      identityRaw += this._identitySignal(dim, tx.from, tx.to, tx[dim]);
    }

    const valueSignal = this._valueSignal(tx.from, tx.amount);
    edge.decayStreak = valueSignal.decayStreak;

    const raw =
      BASE +
      W_EXT * extensionSignal +
      W_CONV * diminish(convergenceCount) +
      W_CYCLE * (cycleClosed ? 1 : 0) +
      W_LOOP * diminish(independentPathCount) +
      identityRaw +
      valueSignal.raw;

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
