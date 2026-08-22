const { kanCheongDeliveryDriver } = require("./server/src/controllers/kanCheongController");

const caseData = {
  start_coordinate: [0,0], end_coordinate: [1,0], start_time: "2026-06-10T08:30:00Z", nodes: [[0,0],[1,0]],
  edges: [
    { edge_id: "edge_0", node1: [0,0], node2: [1,0], base_duration_sec: 10 }
  ],
  obstructions: [
    { edge_id: "edge_0", edge: { from: [0,0], to: [1,0] }, start_time: "2026-06-10T08:30:00Z", end_time: "2026-06-10T08:30:10Z", speed_factor: 0.8 },
    { edge_id: "edge_0", edge: { from: [0,0], to: [1,0] }, start_time: "2026-06-10T08:30:02Z", end_time: "2026-06-10T08:30:10Z", speed_factor: 0.1 }
  ]
};

let result;
kanCheongDeliveryDriver({ body: { case_1: caseData } }, { status(){return this;}, json(r) {result = r;} }, () => {});
console.log(JSON.stringify(result, null, 2));
