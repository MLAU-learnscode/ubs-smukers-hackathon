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
  isShortStacked,
  survivalCallMargin,
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

// --- isShortStacked ---------------------------------------------------
assert.strictEqual(isShortStacked({ big_blind: 2, your_stack: 100 }), false, "50 big blinds is deep");
assert.strictEqual(isShortStacked({ big_blind: 2, your_stack: 20 }), true, "10 big blinds is short");

// --- survivalCallMargin: only bites on big, stack-threatening calls -----
assert.strictEqual(
  survivalCallMargin({ big_blind: 2, your_stack: 100 }, 40),
  0,
  "a deep stack gets no survival penalty regardless of call size"
);
assert.strictEqual(
  survivalCallMargin({ big_blind: 2, your_stack: 20 }, 2),
  0,
  "a small call relative to a short stack gets no survival penalty"
);
assert.ok(
  survivalCallMargin({ big_blind: 2, your_stack: 20 }, 15) > 0,
  "a call committing most of a short stack should add a survival margin"
);
assert.ok(
  survivalCallMargin({ big_blind: 2, your_stack: 8 }, 6) >
    survivalCallMargin({ big_blind: 2, your_stack: 16 }, 6.4),
  "the shorter the stack, the bigger the survival margin for a similarly-sized commitment"
);

// --- decide() folds a marginal, stack-threatening call when short -------
// A 4 vs. community 9: no pair, weak kicker — plainly not worth calling off
// most of a near-critical stack for, even multiway. legal_actions omits
// "fold" only when checking is free, so it's present here (to_call > 0).
const shortStackFacingBet = {
  phase: 3,
  table_rule: "standard",
  big_blind: 2,
  your_number: 4,
  community_number: 9,
  your_seat: 0,
  button_seat: 1,
  hand_number: 40,
  total_hands: 60,
  your_stack: 16,
  pot: 10,
  to_call: 14,
  min_raise_to: null,
  max_raise_to: null,
  legal_actions: ["fold", "call"],
  players: [
    { seat: 0, chip_delta: -184, folded: false, busted: false },
    { seat: 1, chip_delta: 40, folded: false, busted: false },
    { seat: 2, chip_delta: 40, folded: false, busted: false },
    { seat: 3, chip_delta: 40, folded: false, busted: false },
    { seat: 4, chip_delta: 40, folded: false, busted: false },
    { seat: 5, chip_delta: 24, folded: false, busted: false },
  ],
  recent_hands: [],
};
assert.strictEqual(
  decide(shortStackFacingBet).action,
  "fold",
  "a weak hand shouldn't call off most of a near-critical stack multiway"
);

console.log("all showdown phase 3 tests passed");
