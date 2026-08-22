const { solve } = require("./src/controllers/adaptiveGatewayController");

function test(name, body, expected) {
  let result;
  const req = { body };
  const res = { status() { return this; }, json(r) { result = r; } };
  solve(req, res, (e) => { result = { error: e?.message }; });
  const got = JSON.stringify(result);
  const exp = JSON.stringify(expected);
  console.log(got === exp ? "[PASS]" : "[FAIL]", name);
  if (got !== exp) { console.log("  exp:", exp); console.log("  got:", got); }
}

const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64");
const base = { user: { id: "U1", fullName: "A" }, action: "X", metadata: {} };
const ao = { id: "U1", name: "A", action: "x", priority: 2 };

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
  { adaptOutput: ao, sloOutput: { availability: 2/3, p95LatencyMs: 30 } });

test("empty heartbeats array",
  { payload: enc({ adaptInput: base, heartbeats: [], sloQuery: { service: "s", since: 0 } }) },
  { adaptOutput: ao, sloOutput: { availability: null, p95LatencyMs: null } });

test("spec sample",
  { payload: "ewoJImFkYXB0SW5wdXQiOiB7CgkJInVzZXIiOiB7CgkJCSJpZCI6ICJVNDIiLAoJCQkiZnVsbE5hbWUiOiAiSmFuZSBEb2UiCgkJfSwKCQkiYWN0aW9uIjogIkNSRUFURSIsCgkJIm1ldGFkYXRhIjogewoJCQkicHJpb3JpdHkiOiAiSElHSCIKCQl9Cgl9LAoJImhlYXJ0YmVhdHMiOiBbCgkJewoJCQkic2VydmljZSI6ICJhdXRoIiwKCQkJInRpbWVzdGFtcCI6IDE3MTAwMDAxMjMsCgkJCSJsYXRlbmN5TXMiOiAxMjAsCgkJCSJzdGF0dXMiOiAiT0siCgkJfSwKCQl7CgkJCSJzZXJ2aWNlIjogImF1dGgiLAoJCQkidGltZXN0YW1wIjogMTcxMDAwMDEyNSwKCQkJImxhdGVuY3lNcyI6IDE4MCwKCQkJInN0YXR1cyI6ICJGQUlMIgoJCX0sCgkJewoJCQkic2VydmljZSI6ICJhdXRoIiwKCQkJInRpbWVzdGFtcCI6IDE3MTAwMDAxMjEsCgkJCSJsYXRlbmN5TXMiOiA5NSwKCQkJInN0YXR1cyI6ICJPSyIKCQl9CgldLAoJInNsb1F1ZXJ5IjogewoJCSJzZXJ2aWNlIjogImF1dGgiLAoJCSJzaW5jZSI6IDE3MTAwMDAxMjMKCX0KfQ==" },
  { adaptOutput: { id: "U42", name: "Jane Doe", action: "create", priority: 3 }, sloOutput: { availability: 0.5, p95LatencyMs: 180 } });
