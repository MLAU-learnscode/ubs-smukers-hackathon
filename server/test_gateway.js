const zlib = require("zlib");
const { solve } = require("./src/controllers/adaptiveGatewayController");

let totalTests = 0;
let passedTests = 0;

function test(name, body, expected, expectedStatus = 200) {
  totalTests++;
  let result;
  let status = 200;
  const req = { body };
  const res = {
    status(s) { status = s; return this; },
    json(r) { result = r; return this; }
  };
  solve(req, res, (e) => {
    result = { error: e?.message };
    status = e?.statusCode || 400;
  });

  const gotStatus = status;
  const expStatus = expectedStatus;
  const got = JSON.stringify(result);
  const exp = JSON.stringify(expected);

  const pass = gotStatus === expStatus && (exp === undefined || got === exp || (expected && expected.error && result && result.error));
  if (pass) {
    passedTests++;
    console.log(`[PASS] ${name}`);
  } else {
    console.log(`[FAIL] ${name}`);
    console.log(`  exp status: ${expStatus}, got status: ${gotStatus}`);
    console.log(`  exp: ${exp}`);
    console.log(`  got: ${got}`);
  }
}

const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64");
const encGzip = (obj) => zlib.gzipSync(Buffer.from(JSON.stringify(obj))).toString("base64");
const encDeflate = (obj) => zlib.deflateSync(Buffer.from(JSON.stringify(obj))).toString("base64");

const base = { user: { id: "U1", fullName: "A" }, action: "X", metadata: {} };
const ao = { id: "U1", name: "A", action: "x", priority: 2 };

console.log("=== Basic Tests ===");
test("no heartbeats - original format",
  { payload: enc({ adaptInput: base }) },
  { adaptOutput: ao });

test("all fail",
  { payload: enc({ adaptInput: base, heartbeats: [{ service: "s", timestamp: 10, latencyMs: 100, status: "FAIL" }], sloQuery: { service: "s", since: 5 } }) },
  { adaptOutput: ao, sloOutput: { availability: 0, p95LatencyMs: 100 } });

test("no heartbeats match filter",
  { payload: enc({ adaptInput: base, heartbeats: [{ service: "auth", timestamp: 5, latencyMs: 100, status: "OK" }], sloQuery: { service: "auth", since: 10 } }) },
  { adaptOutput: ao, sloOutput: { availability: null, p95LatencyMs: null } });

test("single OK heartbeat",
  { payload: enc({ adaptInput: base, heartbeats: [{ service: "auth", timestamp: 10, latencyMs: 50, status: "OK" }], sloQuery: { service: "auth", since: 10 } }) },
  { adaptOutput: ao, sloOutput: { availability: 1, p95LatencyMs: 50 } });

test("availability 2/3",
  { payload: enc({ adaptInput: base, heartbeats: [
    { service: "s", timestamp: 1, latencyMs: 10, status: "OK" },
    { service: "s", timestamp: 2, latencyMs: 20, status: "OK" },
    { service: "s", timestamp: 3, latencyMs: 30, status: "FAIL" },
  ], sloQuery: { service: "s", since: 1 } }) },
  { adaptOutput: ao, sloOutput: { availability: 0.6667, p95LatencyMs: 30 } });

test("empty heartbeats array",
  { payload: enc({ adaptInput: base, heartbeats: [], sloQuery: { service: "s", since: 0 } }) },
  { adaptOutput: ao, sloOutput: { availability: null, p95LatencyMs: null } });

test("spec sample",
  { payload: "ewoJImFkYXB0SW5wdXQiOiB7CgkJInVzZXIiOiB7CgkJCSJpZCI6ICJVNDIiLAoJCQkiZnVsbE5hbWUiOiAiSmFuZSBEb2UiCgkJfSwKCQkiYWN0aW9uIjogIkNSRUFURSIsCgkJIm1ldGFkYXRhIjogewoJCQkicHJpb3JpdHkiOiAiSElHSCIKCQl9Cgl9LAoJImhlYXJ0YmVhdHMiOiBbCgkJewoJCQkic2VydmljZSI6ICJhdXRoIiwKCQkJInRpbWVzdGFtcCI6IDE3MTAwMDAxMjMsCgkJCSJsYXRlbmN5TXMiOiAxMjAsCgkJCSJzdGF0dXMiOiAiT0siCgkJfSwKCQl7CgkJCSJzZXJ2aWNlIjogImF1dGgiLAoJCQkidGltZXN0YW1wIjogMTcxMDAwMDEyNSwKCQkJImxhdGVuY3lNcyI6IDE4MCwKCQkJInN0YXR1cyI6ICJGQUlMIgoJCX0sCgkJewoJCQkic2VydmljZSI6ICJhdXRoIiwKCQkJInRpbWVzdGFtcCI6IDE3MTAwMDAxMjEsCgkJCSJsYXRlbmN5TXMiOiA5NSwKCQkJInN0YXR1cyI6ICJPSyIKCQl9CgldLAoJInNsb1F1ZXJ5IjogewoJCSJzZXJ2aWNlIjogImF1dGgiLAoJCSJzaW5jZSI6IDE3MTAwMDAxMjMKCX0KfQ==" },
  { adaptOutput: { id: "U42", name: "Jane Doe", action: "create", priority: 3 }, sloOutput: { availability: 0.5, p95LatencyMs: 180 } });

console.log("\n=== Priority Variations ===");
test("priority: LOW",
  { payload: enc({ adaptInput: { user: { id: "1", fullName: "A" }, action: "ADD", metadata: { priority: "LOW" } } }) },
  { adaptOutput: { id: "1", name: "A", action: "add", priority: 1 } });

test("priority: CRITICAL",
  { payload: enc({ adaptInput: { user: { id: "1", fullName: "A" }, action: "ADD", metadata: { priority: "CRITICAL" } } }) },
  { adaptOutput: { id: "1", name: "A", action: "add", priority: 4 } });

test("priority: URGENT / BLOCKER / SEVERE",
  { payload: enc({ adaptInput: { user: { id: "1", fullName: "A" }, action: "ADD", metadata: { priority: "BLOCKER" } } }) },
  { adaptOutput: { id: "1", name: "A", action: "add", priority: 4 } });

test("priority: P0",
  { payload: enc({ adaptInput: { user: { id: "1", fullName: "A" }, action: "ADD", metadata: { priority: "P0" } } }) },
  { adaptOutput: { id: "1", name: "A", action: "add", priority: 4 } });

test("priority: numeric 4",
  { payload: enc({ adaptInput: { user: { id: "1", fullName: "A" }, action: "ADD", metadata: { priority: 4 } } }) },
  { adaptOutput: { id: "1", name: "A", action: "add", priority: 4 } });

test("priority: string numeric '3'",
  { payload: enc({ adaptInput: { user: { id: "1", fullName: "A" }, action: "ADD", metadata: { priority: "3" } } }) },
  { adaptOutput: { id: "1", name: "A", action: "add", priority: 3 } });

console.log("\n=== Schema Field Variations ===");
test("firstName and lastName in user",
  { payload: enc({ adaptInput: { user: { id: "U9", firstName: "John", lastName: "Smith" }, action: "DELETE", metadata: { priority: "HIGH" } } }) },
  { adaptOutput: { id: "U9", name: "John Smith", action: "delete", priority: 3 } });

test("user_id and full_name snake_case",
  { payload: enc({ adaptInput: { user: { user_id: "U10", full_name: "Alice Bob" }, operation: "UPDATE", meta: { level: "LOW" } } }) },
  { adaptOutput: { id: "U10", name: "Alice Bob", action: "update", priority: 1 } });

test("batch adaptInput array",
  { payload: enc({ adaptInput: [
    { user: { id: "U1", fullName: "Alice" }, action: "CREATE", metadata: { priority: "HIGH" } },
    { user: { id: "U2", fullName: "Bob" }, action: "DELETE", metadata: { priority: "LOW" } }
  ] }) },
  { adaptOutput: [
    { id: "U1", name: "Alice", action: "create", priority: 3 },
    { id: "U2", name: "Bob", action: "delete", priority: 1 }
  ] });

test("V2 -> V1 reverse adaptation",
  { payload: enc({ adaptInput: { id: "U42", name: "Jane Doe", action: "create", priority: 3, targetVersion: "v1" } }) },
  { adaptOutput: { user: { id: "U42", fullName: "Jane Doe" }, action: "CREATE", metadata: { priority: "HIGH" } } });

console.log("\n=== Telemetry & Latency Variations ===");
test("status HTTP 200, 201, 500",
  { payload: enc({ heartbeats: [
    { service: "api", timestamp: 100, latencyMs: 50, status: 200 },
    { service: "api", timestamp: 101, latencyMs: 60, status: "201" },
    { service: "api", timestamp: 102, latencyMs: 200, status: 500 }
  ], sloQuery: { service: "api", since: 100 } }) },
  { sloOutput: { availability: 0.6667, p95LatencyMs: 200 } });

test("latency in string format '150ms' and '0.2s'",
  { payload: enc({ heartbeats: [
    { service: "auth", timestamp: 100, latency: "150ms", status: "HEALTHY" },
    { service: "auth", timestamp: 101, latency: "0.2s", status: "PASS" }
  ], sloQuery: { service: "auth", since: 100 } }) },
  { sloOutput: { availability: 1, p95LatencyMs: 200 } });

test("until time window filter",
  { payload: enc({ heartbeats: [
    { service: "auth", timestamp: 100, latencyMs: 50, status: "OK" },
    { service: "auth", timestamp: 150, latencyMs: 70, status: "OK" },
    { service: "auth", timestamp: 200, latencyMs: 90, status: "OK" }
  ], sloQuery: { service: "auth", since: 100, until: 160 } }) },
  { sloOutput: { availability: 1, p95LatencyMs: 70 } });

test("standalone heartbeats (no adaptInput)",
  { payload: enc({ heartbeats: [{ service: "auth", timestamp: 10, latencyMs: 80, status: "OK" }], sloQuery: { service: "auth", since: 0 } }) },
  { sloOutput: { availability: 1, p95LatencyMs: 80 } });

console.log("\n=== Robust Encodings & Payloads ===");
test("gzip compressed payload",
  { payload: encGzip({ adaptInput: base }) },
  { adaptOutput: ao });

test("deflate compressed payload",
  { payload: encDeflate({ adaptInput: base }) },
  { adaptOutput: ao });

test("URL-safe base64 payload",
  { payload: enc({ adaptInput: base }).replace(/\+/g, "-").replace(/\//g, "_") },
  { adaptOutput: ao });

test("whitespace and newlines in base64",
  { payload: "\n  " + enc({ adaptInput: base }) + "  \n" },
  { adaptOutput: ao });

test("raw object in req.body.payload",
  { payload: { adaptInput: base } },
  { adaptOutput: ao });

test("raw body without payload wrapper",
  { adaptInput: base },
  { adaptOutput: ao });

test("plain string body JSON",
  JSON.stringify({ payload: enc({ adaptInput: base }) }),
  { adaptOutput: ao });

test("empty body error 400",
  {},
  { error: "Invalid request payload. Expected base64 string 'payload' or raw JSON." },
  400);

console.log(`\nResults: ${passedTests}/${totalTests} tests passed.`);
if (passedTests !== totalTests) {
  process.exit(1);
}

