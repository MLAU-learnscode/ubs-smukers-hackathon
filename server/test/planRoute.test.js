// Run with: node test/planRoute.test.js
const assert = require("assert");
const { dijkstra, boundedDijkstra } = require("../src/mcp/tools/planRoute");

const adjacency = {
  A: { B: 4.0, C: 2.0 },
  B: { D: 3.0 },
  C: { D: 2.0 },
};
const tolls = { A: 5.0, B: 1.0, C: 9.0, D: 2.0 };

// A->B->D = 4+1 + 3+2 = 10
// A->C->D = 2+9 + 2+2 = 15
const path = dijkstra(adjacency, tolls, "A", "D");
assert.deepStrictEqual(path, ["A", "B", "D"], "unbounded dijkstra should prefer A->B->D (cost 10)");

// Same graph, but with only 1 hop allowed — no direct A->D edge, so no route.
assert.strictEqual(
  boundedDijkstra(adjacency, tolls, "A", "D", 1),
  null,
  "1 hop should be infeasible (no direct edge)"
);

// 2 hops is exactly enough for either route; cheapest is still A->B->D.
assert.deepStrictEqual(
  boundedDijkstra(adjacency, tolls, "A", "D", 2),
  ["A", "B", "D"],
  "2-hop bounded search should still prefer the cheaper route"
);

// Zero-toll graph with a cheaper-but-longer route only reachable within budget.
const adj2 = { S: { X: 1, Y: 1 }, X: { D: 1 }, Y: { D: 100 } };
const tolls2 = { S: 0, X: 0, Y: 0, D: 0 };
assert.deepStrictEqual(dijkstra(adj2, tolls2, "S", "D"), ["S", "X", "D"]);
assert.deepStrictEqual(boundedDijkstra(adj2, tolls2, "S", "D", 5), ["S", "X", "D"]);

console.log("planRoute.test.js: all assertions passed");
