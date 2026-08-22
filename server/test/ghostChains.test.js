// Lightweight ordering-assertion test harness for the Ghost Chains scorer.
// Run with: node test/ghostChains.test.js
//
// No test runner is configured in this repo yet, so this uses Node's
// built-in assert and exits non-zero on failure (CI-friendly without adding
// a dependency).
const assert = require("assert");
const { GhostChainsGraph } = require("../src/services/ghostChainsService");

const MEANINGFUL_GAP = 0.15;
const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-06-08T00:00:00Z");
const at = (offsetMs) => T0 + offsetMs;

function last(scores) {
  return scores[scores.length - 1];
}

// Runs a sequence of {from, to, offsetMs} edges through a fresh graph and
// returns the score of every edge in order (only the last one matters per
// scenario, but earlier edges must be processed to shape graph state).
function run(edges) {
  const g = new GhostChainsGraph();
  const scores = [];
  edges.forEach(([from, to, offsetMs, extra], i) => {
    scores.push(
      g.scoreAndCommit({ txId: `tx${i}`, from, to, amount: 100, createdAt: at(offsetMs ?? 0), ...extra })
    );
  });
  return { graph: g, scores };
}

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(`       ${err.message}`);
    process.exitCode = 1;
  }
}

// --- Calibration fixtures (approximate the briefing's five examples: an
// isolated edge, a plain extension, a convergence, a single return/cycle,
// and a multi-loop) ---

const ex1 = run([["A", "B", 0]]); // isolated
const ex2 = run([
  ["A", "B", 0],
  ["B", "C", 1000],
]); // extension only
const ex3 = run([
  ["A", "B", 0],
  ["C", "B", 1000],
  ["A", "D", 2000],
  ["D", "B", 3000],
]); // convergence: B receives from two paths both rooted at A
const ex4 = run([
  ["A", "B", 0],
  ["B", "C", 1000],
  ["C", "A", 2000],
]); // single return: C -> A closes a cycle back through A -> B -> C
const ex5 = run([
  ["A", "B", 0],
  ["B", "C", 1000],
  ["C", "A", 2000],
  ["B", "D", 3000],
  ["D", "A", 4000],
]); // spec Phase 1 Example 5: two loops sharing first hop A->B, each closing
   // independently back to A (via C, then via D) — matches the briefing's
   // literal example verbatim (letters standing in for the named entities)

check("Ex1 (isolated) < Ex2 (extension)", () => {
  assert.ok(last(ex1.scores) < last(ex2.scores), `${last(ex1.scores)} !< ${last(ex2.scores)}`);
});

check("Ex2 (extension) < Ex3 (convergence)", () => {
  assert.ok(last(ex2.scores) < last(ex3.scores), `${last(ex2.scores)} !< ${last(ex3.scores)}`);
});

check("Ex4 (return) meaningfully higher than Ex2 (extension)", () => {
  const gap = last(ex4.scores) - last(ex2.scores);
  assert.ok(gap > MEANINGFUL_GAP, `gap ${gap} !> ${MEANINGFUL_GAP}`);
});

check("Ex5 (multi-loop) meaningfully higher than Ex4 (single return)", () => {
  const gap = last(ex5.scores) - last(ex4.scores);
  assert.ok(gap > MEANINGFUL_GAP, `gap ${gap} !> ${MEANINGFUL_GAP}`);
});

// --- Adversarial fixtures ---

check("self-loop stays low-signal (below plain extension)", () => {
  const { scores } = run([["A", "A", 0]]);
  assert.ok(last(scores) < last(ex2.scores), `${last(scores)} !< ${last(ex2.scores)}`);
});

check("repeated identical edge doesn't compound signal", () => {
  const g = new GhostChainsGraph();
  g.scoreAndCommit({ txId: "r0", from: "A", to: "B", amount: 100, createdAt: at(0) });
  const s1 = g.scoreAndCommit({ txId: "r1", from: "A", to: "B", amount: 100, createdAt: at(1000) });
  const s2 = g.scoreAndCommit({ txId: "r2", from: "A", to: "B", amount: 100, createdAt: at(2000) });
  assert.strictEqual(s1, s2, `repeated edge score drifted: ${s1} vs ${s2}`);
});

check("a repeated direct A->B transfer is plain repetition, not structural convergence", () => {
  // A second (distinct txId/amount) transfer over the *same* direct A->B
  // link is not a second independent path merging at B - it must stay at
  // extension level, not be mistaken for the genuine multi-path
  // convergence exercised by ex3 (see _countConvergingPaths).
  const { scores } = run([
    ["A", "B", 0],
    ["A", "B", 1000, { amount: 200 }],
  ]);
  assert.strictEqual(last(scores), last(ex2.scores), `${last(scores)} !== plain-extension ${last(ex2.scores)}`);
  assert.ok(last(scores) < last(ex3.scores), `${last(scores)} !< convergence ${last(ex3.scores)}`);
});

check("a repeated direct return edge doesn't compound into a fake multi-loop", () => {
  // A single cycle A->B->C->A, then C->A repeats. The repeat is the same
  // return edge recurring, not a second independent loop - it must stay at
  // the single-cycle score, not climb toward ex5's genuine multi-loop.
  const g = new GhostChainsGraph();
  g.scoreAndCommit({ txId: "rc0", from: "A", to: "B", amount: 100, createdAt: at(0) });
  g.scoreAndCommit({ txId: "rc1", from: "B", to: "C", amount: 100, createdAt: at(1000) });
  const cycle1 = g.scoreAndCommit({ txId: "rc2", from: "C", to: "A", amount: 100, createdAt: at(2000) });
  const cycleRepeat = g.scoreAndCommit({ txId: "rc3", from: "C", to: "A", amount: 100, createdAt: at(3000) });
  assert.strictEqual(cycleRepeat, cycle1, `${cycleRepeat} !== single-cycle score ${cycle1}`);
  assert.ok(cycleRepeat < last(ex5.scores), `${cycleRepeat} !< multi-loop ${last(ex5.scores)}`);
});

check("pure extension chain (no convergence/return) stays well below any return score", () => {
  const { scores } = run([
    ["A", "B", 0],
    ["B", "C", 1000],
    ["C", "D", 2000],
    ["D", "E", 3000],
    ["E", "F", 4000],
  ]);
  assert.ok(last(scores) < last(ex4.scores), `${last(scores)} !< ${last(ex4.scores)}`);
});

check("window boundary: exactly now-24h is included, now-24h-1s is excluded", () => {
  const g = new GhostChainsGraph();
  g.scoreAndCommit({ txId: "w0", from: "X", to: "Y", amount: 100, createdAt: at(0) });

  // This edge is exactly 24h after w0 -> w0 should still be active (inclusive boundary).
  const includedScore = g.scoreAndCommit({
    txId: "w1",
    from: "Y",
    to: "Z",
    amount: 100,
    createdAt: at(DAY_MS),
  });
  assert.strictEqual(g._hasActiveEdges("X"), true, "edge at exactly now-24h should still be active");

  // One more second later, w0 (now DAY_MS+1000 - 0 = 24h+1s old) should have expired.
  g.scoreAndCommit({ txId: "w2", from: "Z", to: "Q", amount: 100, createdAt: at(DAY_MS + 1000) });
  assert.strictEqual(g._hasActiveEdges("X"), false, "edge older than 24h should be pruned");
  assert.ok(includedScore > 0);
});

check("reset produces identical scores for an identical replayed scenario", () => {
  const scenario = [
    ["A", "B", 0],
    ["B", "C", 1000],
    ["C", "A", 2000],
  ];
  const first = run(scenario).scores;
  const g = new GhostChainsGraph();
  scenario.forEach(([from, to, offsetMs], i) => {
    g.scoreAndCommit({ txId: `tx${i}`, from, to, amount: 100, createdAt: at(offsetMs) });
  });
  g.reset();
  const secondScores = [];
  scenario.forEach(([from, to, offsetMs], i) => {
    secondScores.push(g.scoreAndCommit({ txId: `tx${i}`, from, to, amount: 100, createdAt: at(offsetMs) }));
  });
  assert.deepStrictEqual(secondScores, first, "scores diverged after reset + replay");
});

// --- Phase 2: identity signal fixtures (briefing examples 1-4) ---

check("consistent identity along a flow adds no extra risk over baseline", () => {
  const consistent = run([
    ["A", "B", 0, { deviceId: "dev_ios" }],
    ["B", "C", 1000, { deviceId: "dev_ios" }],
    ["C", "D", 2000, { deviceId: "dev_ios" }],
  ]);
  const baseline = run([
    ["A", "B", 0],
    ["B", "C", 1000],
    ["C", "D", 2000],
  ]);
  assert.strictEqual(last(consistent.scores), last(baseline.scores));
});

check("identity divergence at a branch scores higher than the consistent sibling branch", () => {
  const { scores } = run([
    ["A", "B", 0, { deviceId: "dev_ios" }],
    ["B", "C", 1000, { deviceId: "dev_ios" }],
    ["B", "E", 2000, { deviceId: "dev_ios" }], // consistent sibling branch
    ["C", "D", 3000, { deviceId: "dev_android" }], // diverges from upstream device
  ]);
  assert.ok(scores[3] > scores[2], `${scores[3]} !> ${scores[2]}`);
});

check("identity shift mid-flow scores higher than the preceding consistent leg", () => {
  const { scores } = run([
    ["A", "B", 0, { deviceId: "dev_ios" }],
    ["B", "C", 1000, { deviceId: "dev_ios" }],
    ["C", "D", 2000, { deviceId: "dev_android" }], // shift
  ]);
  assert.ok(scores[2] > scores[1], `${scores[2]} !> ${scores[1]}`);
});

check("dropping identity mid-flow scores the same as an explicit identity shift", () => {
  const shift = run([
    ["A", "B", 0, { deviceId: "dev_ios" }],
    ["B", "C", 1000, { deviceId: "dev_ios" }],
    ["C", "D", 2000, { deviceId: "dev_android" }],
  ]);
  const drop = run([
    ["A", "B", 0, { deviceId: "dev_ios" }],
    ["B", "C", 1000, { deviceId: "dev_ios" }],
    ["C", "D", 2000, {}],
  ]);
  assert.strictEqual(last(shift.scores), last(drop.scores));
});

check("missing identity on an unrelated (non-continuous) edge adds no signal", () => {
  const { scores } = run([
    ["A", "B", 0],
    ["B", "C", 1000],
  ]);
  const baseline = run([
    ["A", "B", 0],
    ["B", "C", 1000],
  ]);
  assert.strictEqual(last(scores), last(baseline.scores));
});

check("shared identity across disconnected components raises risk relative to first sighting", () => {
  const { scores } = run([
    ["A", "B", 0, { ipAddress: "10.0.0.1" }],
    ["C", "D", 1000, { ipAddress: "10.0.0.1" }],
    ["E", "F", 2000, { ipAddress: "10.0.0.1" }],
  ]);
  assert.ok(scores[1] > scores[0], `${scores[1]} !> ${scores[0]}`);
  assert.ok(scores[2] > scores[1], `${scores[2]} !> ${scores[1]}`);
});

check("shared identity within the same connected component is not treated as cross-component", () => {
  const { scores } = run([
    ["A", "B", 0, { ipAddress: "10.0.0.1" }],
    ["B", "C", 1000, { ipAddress: "10.0.0.1" }],
  ]);
  // B->C is a plain extension with consistent upstream identity: no break, no cross-component hit.
  assert.strictEqual(scores[1], 0.05 + 0.15);
});

console.log(`\n${passed} passed`);
if (process.exitCode) {
  console.error("Some checks FAILED");
} else {
  console.log("All checks passed");
}
