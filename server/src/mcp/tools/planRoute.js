const { z } = require("zod");

// This host has been observed taking 20s+ to answer on a cold start (well
// past the 10s tool deadline). Unlike the study-materials corpus, a map's
// graph can't be pre-warmed — map_id isn't known until the android calls us
// with it — so the per-call timeout is set as generously as the deadline
// allows instead.
const FETCH_TIMEOUT_MS = 8800;
const CACHE_TTL_MS = 60 * 60 * 1000;
// Confirmed live via curl (returns a structured "Invalid map_id" 400 rather
// than a 404), same host as the study-materials index from the qna.
const BASE_URL =
  process.env.MAP_SERVICE_BASE_URL || "https://tool-box-2591eaa24fa3.herokuapp.com";

// mapId -> { graph, expiresAt }
const graphCache = new Map();
// mapId -> { path: string[], destination: string, expiresAt }
const pathCache = new Map();

// Fire-and-forget boot-time ping to wake the shared dyno (same host as the
// study-materials service, which recallStudyMaterial.js also warms at boot)
// before any real journey is asked of us. Errors are irrelevant here — this
// is purely to avoid being the request that pays the cold-start cost.
fetch(`${BASE_URL}/graph?map_id=__warmup__`).catch(() => {});

function pruneExpired(cache) {
  const now = Date.now();
  for (const [key, val] of cache) {
    if (val.expiresAt < now) cache.delete(key);
  }
}

async function fetchGraph(mapId, graphUrlOverride) {
  pruneExpired(graphCache);
  const cached = graphCache.get(mapId);
  if (cached) return cached.graph;

  const url = graphUrlOverride || `${BASE_URL}/graph?map_id=${encodeURIComponent(mapId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`graph fetch failed: ${res.status}`);
    const graph = await res.json();
    graphCache.set(mapId, { graph, expiresAt: Date.now() + CACHE_TTL_MS });
    return graph;
  } finally {
    clearTimeout(timer);
  }
}

// Plain Dijkstra: cost of entering v is edge weight + tolls[v]. Never a
// benefit to revisit a node since all costs are non-negative, so the result
// is always a simple path.
function dijkstra(adjacency, tolls, source, target) {
  const dist = new Map([[source, 0]]);
  const prev = new Map();
  const visited = new Set();
  const nodes = new Set(Object.keys(adjacency));
  for (const nbrs of Object.values(adjacency)) {
    for (const n of Object.keys(nbrs)) nodes.add(n);
  }

  while (visited.size < nodes.size) {
    let u = null;
    let best = Infinity;
    for (const n of nodes) {
      if (visited.has(n)) continue;
      const d = dist.has(n) ? dist.get(n) : Infinity;
      if (d < best) {
        best = d;
        u = n;
      }
    }
    if (u === null || best === Infinity) break;
    visited.add(u);
    if (u === target) break;

    const nbrs = adjacency[u] || {};
    for (const [v, w] of Object.entries(nbrs)) {
      const toll = tolls[v] || 0;
      const cand = dist.get(u) + w + toll;
      if (cand < (dist.has(v) ? dist.get(v) : Infinity)) {
        dist.set(v, cand);
        prev.set(v, u);
      }
    }
  }

  if (!dist.has(target)) return null;
  const path = [target];
  let cur = target;
  while (cur !== source) {
    cur = prev.get(cur);
    if (cur === undefined) return null;
    path.push(cur);
  }
  path.reverse();
  return path;
}

// Min-cost path from source to target using at most maxHops edges.
// dp[k][v] = min cost to reach v using exactly k edges from source.
function boundedDijkstra(adjacency, tolls, source, target, maxHops) {
  const nodes = new Set(Object.keys(adjacency));
  for (const nbrs of Object.values(adjacency)) {
    for (const n of Object.keys(nbrs)) nodes.add(n);
  }

  let dp = new Map(nodes.size ? [...nodes].map((n) => [n, Infinity]) : []);
  dp.set(source, 0);
  let prev = [new Map()]; // prev[k] : Map<node, predecessor>

  const layers = [dp];
  for (let k = 1; k <= maxHops; k++) {
    const next = new Map(dp);
    const predK = new Map();
    for (const [u, du] of dp) {
      if (du === Infinity) continue;
      const nbrs = adjacency[u] || {};
      for (const [v, w] of Object.entries(nbrs)) {
        const toll = tolls[v] || 0;
        const cand = du + w + toll;
        if (cand < next.get(v)) {
          next.set(v, cand);
          predK.set(v, u);
        }
      }
    }
    layers.push(next);
    prev.push(predK);
    dp = next;
  }

  // Best (lowest cost) hop count k (<= maxHops) at which target is reached.
  let bestK = -1;
  let bestCost = Infinity;
  for (let k = 0; k <= maxHops; k++) {
    const c = layers[k].get(target);
    if (c !== undefined && c < bestCost) {
      bestCost = c;
      bestK = k;
    }
  }
  if (bestK === -1) return null;

  // Reconstruct by walking predecessors from (bestK, target) back to (0, source).
  const path = [target];
  let node = target;
  for (let k = bestK; k > 0; k--) {
    const pred = prev[k].get(node);
    if (pred === undefined) return null;
    path.push(pred);
    node = pred;
  }
  path.reverse();

  // Safety: positive costs make cycles never optimal, but guard anyway —
  // fall back to unbounded Dijkstra if bounded reconstruction produced a
  // path with duplicates or didn't reach the source.
  if (path[0] !== source || new Set(path).size !== path.length) {
    return dijkstra(adjacency, tolls, source, target);
  }
  return path;
}

function register(server) {
  server.registerTool(
    "go",
    {
      description:
        "Returns the next node to travel to on the way from your current position (source) " +
        "to a destination, on a weighted map identified by map_id. Cost is edge weight plus " +
        "the toll of every node entered; this tool always returns the least-cost route. " +
        "If you have a limited number of hops left, pass hops_remaining (counting the hop " +
        "you're about to take) and it will find the cheapest route that still fits. " +
        "Call again after each move, passing your new current node as source.",
      inputSchema: {
        map_id: z.string().describe("Opaque handle identifying the map"),
        source: z.string().describe("The node you are currently standing at"),
        destination: z.string().describe("The node you need to reach"),
        hops_remaining: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "If this journey has a hop curfew, the number of edges you may still use, " +
              "including the one you're about to take. Omit if there is no limit."
          ),
        graph_url: z
          .string()
          .optional()
          .describe("Override: full URL to fetch the graph from, if not using the default map service"),
      },
    },
    async ({ map_id: mapId, source: current, destination, hops_remaining: hopsRemaining, graph_url: graphUrl }) => {
      let graph;
      try {
        graph = await fetchGraph(mapId, graphUrl);
      } catch (err) {
        return {
          content: [{ type: "text", text: `error: could not fetch map (${err.message})` }],
          isError: true,
        };
      }

      const { adjacency, tolls } = graph;

      if (current === destination) {
        return { content: [{ type: "text", text: destination }] };
      }

      const cacheKey = `${mapId}:${destination}`;
      pruneExpired(pathCache);
      let cached = pathCache.get(cacheKey);

      let path = cached && cached.path.includes(current) ? cached.path : null;

      if (!path) {
        path = hopsRemaining
          ? boundedDijkstra(adjacency, tolls, current, destination, hopsRemaining)
          : dijkstra(adjacency, tolls, current, destination);

        if (!path) {
          return {
            content: [{ type: "text", text: "error: no route found within constraints" }],
            isError: true,
          };
        }
        pathCache.set(cacheKey, { path, destination, expiresAt: Date.now() + CACHE_TTL_MS });
      }

      const idx = path.indexOf(current);
      const next = path[idx + 1];

      return { content: [{ type: "text", text: next }] };
    }
  );
}

module.exports = { register, dijkstra, boundedDijkstra };
