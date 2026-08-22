// Phase 3 (value signal) ordering-assertion tests for the Ghost Chains scorer.
// Run with: node test/ghostChainsPhase3.test.js
const assert = require("assert");
const { GhostChainsGraph } = require("../src/services/ghostChainsService");

const T0 = Date.parse("2026-06-08T00:00:00Z");
const at = (offsetMs) => T0 + offsetMs;

function last(scores) {
  return scores[scores.length - 1];
}

// edges: [from, to, offsetMs, amount, extra?]
function run(edges) {
  const g = new GhostChainsGraph();
  const scores = [];
  edges.forEach(([from, to, offsetMs, amount, extra], i) => {
    scores.push(
      g.scoreAndCommit({ txId: `tx${i}`, from, to, amount, createdAt: at(offsetMs ?? 0), ...extra })
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

// --- Briefing Phase 3 examples 1-4 ---

const ex1 = run([
  ["Meridian", "Apex", 0, 10000],
  ["Apex", "Cascade", 1000, 9910],
  ["Cascade", "Horizon", 2000, 9820.81],
  ["Horizon", "Nimbus", 3000, 9732.42],
]); // consistent value decay

const ex2 = run([
  ["Meridian", "Apex", 0, 10000],
  ["Apex", "Cascade", 1000, 9800],
  ["Apex", "Sterling", 2000, 5000],
  ["Cascade", "Horizon", 3000, 9700],
  ["Sterling", "Oakridge", 4000, 4900],
]); // competing flow hypotheses (divergence)

const ex3 = run([
  ["Meridian", "Apex", 0, 10000],
  ["Apex", "Cascade", 1000, 9950],
  ["Cascade", "Horizon", 2000, 9800],
  ["Horizon", "Nimbus", 3000, 9950],
]); // value trajectory reversal

const ex4 = run([
  ["Meridian", "Apex", 0, 10000],
  ["Apex", "Cascade", 1000, 9800],
  ["Apex", "Sterling", 2000, 5000],
  ["Cascade", "Horizon", 3000, 9700],
  ["Sterling", "Horizon", 4000, 4950],
]); // convergence of separate value paths

check("Example 1 (consistent decay) is the lowest of the four", () => {
  const e1 = last(ex1.scores);
  assert.ok(e1 < last(ex2.scores), `ex1 ${e1} !< ex2 ${last(ex2.scores)}`);
  assert.ok(e1 < last(ex3.scores), `ex1 ${e1} !< ex3 ${last(ex3.scores)}`);
  assert.ok(e1 < last(ex4.scores), `ex1 ${e1} !< ex4 ${last(ex4.scores)}`);
});

check("Example 3 (reversal) is the highest of the four", () => {
  const e3 = last(ex3.scores);
  assert.ok(e3 > last(ex1.scores), `ex3 ${e3} !> ex1 ${last(ex1.scores)}`);
  assert.ok(e3 > last(ex2.scores), `ex3 ${e3} !> ex2 ${last(ex2.scores)}`);
  assert.ok(e3 > last(ex4.scores), `ex3 ${e3} !> ex4 ${last(ex4.scores)}`);
});

check("reversal scores strictly higher than the preceding decaying leg on the same path", () => {
  assert.ok(ex3.scores[3] > ex3.scores[2], `${ex3.scores[3]} !> ${ex3.scores[2]}`);
});

check("a root edge (no inbound predecessor) carries no value evidence", () => {
  const { scores } = run([["Meridian", "Apex", 0, 10000]]);
  const noAmountVariant = run([["Meridian", "Apex", 0, 1]]);
  assert.strictEqual(scores[0], noAmountVariant.scores[0], "value signal should be independent of amount on a root edge");
});

check("value evidence does not blindly aggregate across sibling branches", () => {
  // Two branches off the same root with very different retention ratios;
  // neither branch's score should be pulled toward the other's ratio.
  const { scores } = run([
    ["Meridian", "Apex", 0, 10000],
    ["Apex", "Cascade", 1000, 9900], // slight decay
    ["Apex", "Sterling", 2000, 200], // steep decay, unrelated branch
  ]);
  const soloSlight = run([
    ["Meridian", "Apex", 0, 10000],
    ["Apex", "Cascade", 1000, 9900],
  ]);
  assert.strictEqual(scores[1], soloSlight.scores[1], "Cascade branch score should be unaffected by the later Sterling branch");
});

console.log(`\n${passed} passed`);
if (process.exitCode) {
  console.error("Some checks FAILED");
} else {
  console.log("All checks passed");
}
