const { kanCheongDeliveryDriver } = require("./src/controllers/kanCheongController");

function runTest(name, body, expected) {
  let result;
  const req = { body };
  const res = {
    status() { return this; },
    json(r) { result = r; },
  };
  kanCheongDeliveryDriver(req, res, (e) => { result = { error: e?.message }; });
  const got = JSON.stringify(result?.case_1);
  const exp = JSON.stringify(expected);
  if (got === exp) {
    console.log("[PASS]", name);
  } else {
    console.log("[FAIL]", name);
    console.log("  expected:", exp);
    console.log("  got:    ", got);
  }
}

// Example 1
runTest("ex1 basic obstructions", { case_1: { start_coordinate: [0, 0], end_coordinate: [3, 1], start_time: "2026-06-10T08:30:00Z", nodes: [[0,0],[1,0],[2,0],[2,1],[3,1]], edges: [{ edge_id: "edge_0", node1: [0,0], node2: [1,0], base_duration_sec: 60 },{ edge_id: "edge_1", node1: [1,0], node2: [2,0], base_duration_sec: 60 },{ edge_id: "edge_2", node1: [2,0], node2: [2,1], base_duration_sec: 40 },{ edge_id: "edge_3", node1: [2,1], node2: [3,1], base_duration_sec: 50 },{ edge_id: "edge_4", node1: [1,0], node2: [2,1], base_duration_sec: 120 }], obstructions: [{ edge_id: "edge_1", edge: { from: [1,0], to: [2,0] }, start_time: "2026-06-10T08:00:00Z", end_time: "2026-06-10T09:00:00Z", speed_factor: 0.5 },{ edge_id: "edge_2", edge: { from: [2,1], to: [2,0] }, start_time: "2026-06-10T08:15:00Z", end_time: "2026-06-10T08:45:00Z", speed_factor: 0.0 }] } },
  { total_duration_sec: 230, arrival_time: "2026-06-10T08:33:50Z", path: ["edge_0","edge_4","edge_3"] });

// Example 2 - unreachable node
runTest("ex2 unreachable", { case_1: { start_coordinate: [0,0], end_coordinate: [3,3], start_time: "2026-06-10T08:30:00Z", nodes: [[0,0],[1,0],[2,0],[2,1],[3,1]], edges: [{ edge_id: "edge_0", node1: [0,0], node2: [1,0], base_duration_sec: 60 },{ edge_id: "edge_1", node1: [1,0], node2: [2,0], base_duration_sec: 60 },{ edge_id: "edge_2", node1: [2,0], node2: [2,1], base_duration_sec: 40 },{ edge_id: "edge_3", node1: [2,1], node2: [3,1], base_duration_sec: 50 },{ edge_id: "edge_4", node1: [1,0], node2: [2,1], base_duration_sec: 120 }], obstructions: [{ edge_id: "edge_1", edge: { from: [1,0], to: [2,0] }, start_time: "2026-06-10T08:00:00Z", end_time: "2026-06-10T09:00:00Z", speed_factor: 0.5 },{ edge_id: "edge_2", edge: { from: [2,1], to: [2,0] }, start_time: "2026-06-10T08:15:00Z", end_time: "2026-06-10T08:45:00Z", speed_factor: 0.0 }] } },
  { total_duration_sec: null, arrival_time: null, path: [] });

// Example 3 - cycling
runTest("ex3 cycling no-wait", { case_1: { start_coordinate: [0,0], end_coordinate: [2,0], start_time: "2026-06-10T08:30:00Z", nodes: [[0,0],[1,0],[2,0]], edges: [{ edge_id: "edge_0", node1: [0,0], node2: [1,0], base_duration_sec: 10 },{ edge_id: "edge_1", node1: [1,0], node2: [2,0], base_duration_sec: 10 },{ edge_id: "edge_2", node1: [0,0], node2: [2,0], base_duration_sec: 20 }], obstructions: [{ edge_id: "edge_1", edge: { from: [1,0], to: [2,0] }, start_time: "2026-06-10T08:30:10Z", end_time: "2026-06-10T08:30:20Z", speed_factor: 0.0 },{ edge_id: "edge_1", edge: { from: [1,0], to: [2,0] }, start_time: "2026-06-10T08:30:30Z", end_time: "2026-06-10T08:30:40Z", speed_factor: 0.0 },{ edge_id: "edge_2", edge: { from: [0,0], to: [2,0] }, start_time: "2026-06-10T08:30:00Z", end_time: "2026-06-10T08:32:00Z", speed_factor: 0.2 }] } },
  { total_duration_sec: 60, arrival_time: "2026-06-10T08:31:00Z", path: ["edge_0","edge_0","edge_0","edge_0","edge_0","edge_1"] });

// Example 4 - blocked at start
runTest("ex4 blocked at start", { case_1: { start_coordinate: [0,0], end_coordinate: [1,0], start_time: "2026-06-10T08:30:00Z", nodes: [[0,0],[1,0]], edges: [{ edge_id: "edge_0", node1: [0,0], node2: [1,0], base_duration_sec: 60 }], obstructions: [{ edge_id: "edge_0", edge: { from: [0,0], to: [1,0] }, start_time: "2026-06-10T08:00:00Z", end_time: "2026-06-10T09:00:00Z", speed_factor: 0.0 }] } },
  { total_duration_sec: null, arrival_time: null, path: [] });

// Batch simple no obs
runTest("simple no obs", { case_1: { start_coordinate: [0,0], end_coordinate: [1,0], start_time: "2026-06-10T08:30:00Z", nodes: [[0,0],[1,0]], edges: [{ edge_id: "edge_0", node1: [0,0], node2: [1,0], base_duration_sec: 60 }], obstructions: [] } },
  { total_duration_sec: 60, arrival_time: "2026-06-10T08:31:00Z", path: ["edge_0"] });

// Batch simple blocked
runTest("simple blocked", { case_1: { start_coordinate: [0,0], end_coordinate: [1,0], start_time: "2026-06-10T08:30:00Z", nodes: [[0,0],[1,0]], edges: [{ edge_id: "edge_0", node1: [0,0], node2: [1,0], base_duration_sec: 60 }], obstructions: [{ edge_id: "edge_0", edge: { from: [0,0], to: [1,0] }, start_time: "2026-06-10T08:00:00Z", end_time: "2026-06-10T09:00:00Z", speed_factor: 0.0 }] } },
  { total_duration_sec: null, arrival_time: null, path: [] });
