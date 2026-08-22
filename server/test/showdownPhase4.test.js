// Run with: node test/showdownPhase4.test.js
const assert = require("assert");
const {
  decide,
  move,
  health,
  countLiveOpponents,
} = require("../src/controllers/showdownController");

// --- decide() generalizes past the 6-seat phase-3 table to 7 seats -------
const sevenSeatState = {
  protocol_version: 2,
  phase: 4,
  table_rule: "standard",
  your_number: 13,
  community_number: 13, // pair, top hand
  your_seat: 3,
  button_seat: 0,
  hand_number: 5,
  total_hands: 200,
  pot: 20,
  to_call: 0,
  min_raise_to: 4,
  max_raise_to: 200,
  legal_actions: ["check", "bet"],
  players: [
    { seat: 0, chip_delta: 0, folded: false, busted: false },
    { seat: 1, chip_delta: 0, folded: false, busted: false },
    { seat: 2, chip_delta: 0, folded: true, busted: false },
    { seat: 3, chip_delta: 0, folded: false, busted: false },
    { seat: 4, chip_delta: 0, folded: false, busted: false },
    { seat: 5, chip_delta: 0, folded: false, busted: false },
    { seat: 6, chip_delta: 0, folded: false, busted: false },
  ],
  recent_hands: [],
};
assert.strictEqual(countLiveOpponents(sevenSeatState), 5, "6 other seats minus 1 folded = 5 live opponents");
const sevenSeatResult = decide(sevenSeatState);
assert.strictEqual(sevenSeatResult.action, "bet", "a pair of 13s should still be bet at a 7-seat table");

// --- health() answers cheaply with no dependency on request shape --------
let healthBody = null;
health({}, { status: () => ({ json: (body) => (healthBody = body) }) });
assert.strictEqual(healthBody.status, "ok", "health check must always report ok");

// --- move() never throws or forfeits, even for an anonymized opponent's
// unfamiliar/malformed payload shape -------------------------------------
const adversarialPayloads = [
  {},
  { legal_actions: ["fold", "call"] },
  { phase: 4, legal_actions: ["check"], players: null, your_seat: 0 },
  { phase: 4, legal_actions: ["bet"], min_raise_to: "not a number", max_raise_to: null },
  { phase: 4, legal_actions: [], recent_hands: "not an array" },
];
for (const payload of adversarialPayloads) {
  let statusCode = null;
  let body = null;
  const req = { body: payload };
  const res = {
    status: (code) => {
      statusCode = code;
      return { json: (b) => (body = b) };
    },
  };
  move(req, res);
  assert.strictEqual(statusCode, 200, `move() must always answer 200, got ${statusCode} for ${JSON.stringify(payload)}`);
  assert.ok(body && typeof body.action === "string", `move() must always return an action, got ${JSON.stringify(body)}`);
}

console.log("all showdown phase 4 tests passed");
