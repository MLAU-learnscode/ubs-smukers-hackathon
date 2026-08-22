// Run with: node test/showdownPhase3.test.js
const assert = require("assert");
const {
  decide,
  equity,
  buildRatingModel,
  countLiveOpponents,
  multiwayEquityFromHeadsUp,
  isLeadingTable,
  legRemainingFrac,
} = require("../src/controllers/showdownController");

// --- countLiveOpponents: filters folded/busted seats other than us -------
assert.strictEqual(
  countLiveOpponents({
    your_seat: 3,
    players: [
      { seat: 0, folded: false, busted: false },
      { seat: 1, folded: true, busted: false },
      { seat: 2, folded: false, busted: true },
      { seat: 3, folded: false, busted: false },
      { seat: 4, folded: false, busted: false },
      { seat: 5, folded: false, busted: false },
    ],
  }),
  3,
  "should count only live, non-us seats"
);

// --- multiway derating is monotonic and bounded ---------------------------
assert.strictEqual(multiwayEquityFromHeadsUp(0.8, 1), 0.8);
assert.ok(multiwayEquityFromHeadsUp(0.8, 5) < multiwayEquityFromHeadsUp(0.8, 2));
assert.ok(multiwayEquityFromHeadsUp(0.8, 5) >= 0 && multiwayEquityFromHeadsUp(0.8, 5) <= 1);

// --- buildRatingModel learns from opponent-vs-opponent pairs too ---------
const model = buildRatingModel([
  {
    community_number: 7,
    winners: [2],
    shown_numbers: { 0: 3, 1: 5, 2: 9 }, // seat 2 (highest, no pair) wins
  },
]);
assert.ok(model.rating[9] > model.rating[3], "winner's number should outrank a lower shown number");
assert.ok(model.rating[9] > model.rating[5], "winner's number should outrank another lower shown number");

// --- isLeadingTable requires strictly ahead of every other seat ---------
assert.strictEqual(
  isLeadingTable({
    your_seat: 0,
    players: [
      { seat: 0, chip_delta: 20 },
      { seat: 1, chip_delta: 10 },
      { seat: 2, chip_delta: 20 }, // tie -> not strictly leading
    ],
  }),
  false,
  "a tie for best chip_delta should not count as leading"
);
assert.strictEqual(
  isLeadingTable({
    your_seat: 0,
    players: [
      { seat: 0, chip_delta: 21 },
      { seat: 1, chip_delta: 10 },
      { seat: 2, chip_delta: 20 },
    ],
  }),
  true,
  "strictly highest chip_delta should count as leading"
);

// --- legRemainingFrac -----------------------------------------------------
assert.strictEqual(legRemainingFrac({ total_hands: 60, hand_number: 60 }), 0);
assert.strictEqual(legRemainingFrac({ total_hands: 60, hand_number: 0 }), 1);
assert.strictEqual(legRemainingFrac({ total_hands: 0, hand_number: 5 }), 0.5);

// --- decide() still returns a legal action at a 6-seat table -------------
const sixSeatState = {
  protocol_version: 2,
  phase: 3,
  table_rule: "standard",
  your_number: 13,
  community_number: 13, // pair, top hand
  your_seat: 3,
  button_seat: 0,
  hand_number: 5,
  total_hands: 60,
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
  ],
  recent_hands: [],
};
const result = decide(sixSeatState);
assert.ok(["check", "bet"].includes(result.action), "must return a legal action");
assert.strictEqual(result.action, "bet", "a pair of 13s should be bet, not checked, even multiway");

console.log("all showdown phase 3 tests passed");
