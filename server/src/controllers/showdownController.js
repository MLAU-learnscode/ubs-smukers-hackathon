// Showdown betting-game bot. One number 1-13 dealt to each player, one
// shared community number 1-13 revealed mid-hand.
//
// Phase 1 ("standard" rule, heads-up): pair (your_number == community_number)
// beats any non-pair; otherwise higher number wins. `equity()` below is
// exact for that rule.
//
// Phase 2+ can swap in a different, undisclosed showdown ruleset per match
// (`table_rule`, an opaque codename). We're never told what a codename
// means, only that it's fixed for the whole match/leg and that recent_hands
// resets at the start of every leg. So rather than hardcode a ruleset, we
// learn one online: every request rebuilds an Elo-style rating over the 13
// numbers (plus a separate "pair" bonus) purely from the showdowns visible
// in this request's recent_hands, starting from a standard-rule prior and
// correcting itself as real outcomes come in. This is stateless by design
// (no cross-request memory) since recent_hands already carries everything
// needed and resets exactly when the rule would change under us.
//
// Phase 3 seats six players at once (multiway). Two things change:
//   - A bet has to get through however many opponents are still live in the
//     hand, not just one, so raw heads-up equity overstates our chances.
//     `multiwayEquityFromHeadsUp()` derates it per live opponent.
//   - With five other players at the table, showdowns carry a lot more
//     pairwise information per hand than heads-up ever did. The rating model
//     below learns from every pair of shown seats, not just pairs involving
//     us, so it converges faster.
// Phase 3 also scores strictly on topping the table (highest chip delta at
// the table, not just being up), so decide() nudges aggression by whether
// we're currently leading and how much of the leg is left.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Exact showdown equity vs a uniformly-random, independent opponent number
// (1-13), under the standard rule. When community is null (pre-reveal) it
// averages over all 13 possible community numbers too. Cheap (<=169
// iterations), so compute fresh every call rather than caching.
function equity(yourNumber, community) {
  if (community === null || community === undefined) {
    let total = 0;
    for (let c = 1; c <= 13; c++) total += equity(yourNumber, c);
    return total / 13;
  }

  const yourPair = yourNumber === community;
  let win = 0;
  let split = 0;

  for (let o = 1; o <= 13; o++) {
    const oppPair = o === community;
    if (yourPair && oppPair) split++;
    else if (yourPair) win++;
    else if (oppPair) {
      // opponent pairs, we don't: we lose
    } else if (yourNumber > o) win++;
    else if (yourNumber === o) split++;
    // else we lose
  }

  return (win + split * 0.5) / 13;
}

// --- Phase 2: online rule learning -----------------------------------

const ELO_SCALE = 13; // logistic spread; tuned so a max gap (12) ~= 0.89 win prob
const ELO_K = 8; // learning rate per observed showdown
const INITIAL_PAIR_BONUS = 20; // prior: a pair beats any non-pair (standard rule)

function expectedScore(a, b) {
  return 1 / (1 + Math.pow(10, (b - a) / ELO_SCALE));
}

// Rebuild a rating model for numbers 1-13 (plus a pair bonus) from the
// showdowns actually observed so far this leg. Starts from the standard-rule
// prior (rating[n] = n, pairs strong) and nudges it toward whatever the real
// table_rule actually rewards, hand by hand, in chronological order.
//
// A showdown can involve more than two shown numbers now (multiway), so we
// run one pairwise Elo update per pair of shown seats — including pairs that
// don't involve us. Every opponent-vs-opponent comparison is still evidence
// about how the undisclosed rule ranks numbers, so throwing it away would
// just make the model converge slower with no benefit.
function applyPairUpdate(rating, pairBonus, community, numA, numB, actual) {
  const aPaired = numA === community;
  const bPaired = numB === community;
  const effA = rating[numA] + (aPaired ? pairBonus : 0);
  const effB = rating[numB] + (bPaired ? pairBonus : 0);
  const delta = ELO_K * (actual - expectedScore(effA, effB));

  if (aPaired) {
    rating[numA] += delta / 2;
    pairBonus += delta / 2;
  } else {
    rating[numA] += delta;
  }

  if (bPaired) {
    rating[numB] -= delta / 2;
    pairBonus -= delta / 2;
  } else {
    rating[numB] -= delta;
  }

  return pairBonus;
}

function buildRatingModel(recentHands) {
  const rating = {};
  for (let n = 1; n <= 13; n++) rating[n] = n;
  let pairBonus = INITIAL_PAIR_BONUS;

  for (const hand of recentHands || []) {
    const community = hand.community_number;
    const shown = hand.shown_numbers;
    if (community === null || community === undefined || !shown) continue;

    const seats = Object.keys(shown).map(Number);
    if (seats.length < 2) continue; // no pairwise comparison to learn from

    const winners = new Set(hand.winners || []);

    for (let i = 0; i < seats.length; i++) {
      for (let j = i + 1; j < seats.length; j++) {
        const seatA = seats[i];
        const seatB = seats[j];
        const numA = shown[seatA];
        const numB = shown[seatB];
        if (numA === undefined || numB === undefined) continue;

        const aWon = winners.has(seatA);
        const bWon = winners.has(seatB);
        const actual = aWon && bWon ? 0.5 : aWon ? 1 : bWon ? 0 : 0.5;

        pairBonus = applyPairUpdate(rating, pairBonus, community, numA, numB, actual);
      }
    }
  }

  return { rating, pairBonus };
}

// Same shape as equity() above, but driven by the learned rating model
// instead of the hardcoded standard rule.
function learnedEquity(yourNumber, community, model) {
  if (community === null || community === undefined) {
    let total = 0;
    for (let c = 1; c <= 13; c++) total += learnedEquity(yourNumber, c, model);
    return total / 13;
  }

  const { rating, pairBonus } = model;
  const myPaired = yourNumber === community;
  const effMy = rating[yourNumber] + (myPaired ? pairBonus : 0);

  let total = 0;
  for (let o = 1; o <= 13; o++) {
    const oppPaired = o === community;
    const effOpp = rating[o] + (oppPaired ? pairBonus : 0);
    total += expectedScore(effMy, effOpp);
  }
  return total / 13;
}

// Live opponents this hand: seated players other than us who haven't folded
// or busted out. `players` is the table's full seating (folded players stay
// listed with folded: true), so this has to be filtered explicitly rather
// than just taken as players.length - 1.
function countLiveOpponents(state) {
  const players = state.players || [];
  return players.filter(
    (p) => p.seat !== state.your_seat && !p.folded && !p.busted
  ).length;
}

// A bet has to get through every live opponent, not just one, and each of
// them is an independent draw. Beating a single random opponent with
// probability p means beating N of them, independently, with probability
// p^N — an approximation (it folds win/split together into one number
// rather than modelling split pots exactly), but it's cheap, monotonic in
// opponent count, and matches the guide's framing directly: the same number
// is worth less at a fuller table.
function multiwayEquityFromHeadsUp(headsUpEq, numOpponents) {
  if (numOpponents <= 1) return headsUpEq;
  return Math.pow(headsUpEq, numOpponents);
}

// headsUpEq is raw hand strength (probability of beating one random
// opponent) — used to classify how strong our number is, independent of how
// many people are at the table. winProb is that derated across every live
// opponent — the actual probability the pot is heading our way, which is
// what pot-odds math needs. Keeping both lets decide() bluff or value-bet on
// hand strength while still folding correctly against a crowd.
function computeEquity(state) {
  const community = state.community_number ?? null;
  const numOpponents = Math.max(1, countLiveOpponents(state));

  const headsUpEq =
    state.phase === 1
      ? equity(state.your_number, community)
      : learnedEquity(state.your_number, community, buildRatingModel(state.recent_hands));

  const winProb = multiwayEquityFromHeadsUp(headsUpEq, numOpponents);
  return { headsUpEq, winProb, numOpponents };
}

function equityForState(state) {
  return computeEquity(state).winProb;
}

// Are we strictly ahead of everyone else at the table right now? Phase 3
// only pays out for topping the table, not merely being up, so this is what
// "leading" has to mean — ties don't count as leading either.
function isLeadingTable(state) {
  const players = state.players || [];
  const me = players.find((p) => p.seat === state.your_seat);
  if (!me) return false;
  return players.every((p) => p.seat === state.your_seat || p.chip_delta < me.chip_delta);
}

// Fraction of the leg still to come, 0 (done) to 1 (just started). Used to
// scale how much we lean into variance-seeking or protective play.
function legRemainingFrac(state) {
  const total = state.total_hands;
  if (!total) return 0.5;
  return clamp((total - state.hand_number) / total, 0, 1);
}

// Pick a bet/raise total (the "raise to" amount, not the increment) that
// scales with hand strength between the legal min and max.
function sizeRaise(minRaiseTo, maxRaiseTo, eq) {
  if (minRaiseTo === null || maxRaiseTo === null) return null;
  const t = clamp((eq - 0.5) / 0.5, 0, 1);
  const amount = Math.round(minRaiseTo + t * (maxRaiseTo - minRaiseTo));
  return clamp(amount, minRaiseTo, maxRaiseTo);
}

const STRONG_BET_EQ = 0.65;
const VALUE_RAISE_EQ = 0.75;
const BLUFF_EQ_CEILING = 0.28;
const BLUFF_FREQUENCY = 0.25;
const CALL_MARGIN = 0.06;

// Multiway pots reward tighter play: with more live opponents, the odds
// someone woke up with a real number go up, so value bets need a bit more
// margin and bluffs need to fire less often to keep folding equity honest.
// These are mild per-extra-opponent nudges on top of the heads-up baseline
// above, not a separate rule set.
const MULTIWAY_STRONG_BET_STEP = 0.04;
const MULTIWAY_VALUE_RAISE_STEP = 0.04;
const MULTIWAY_BLUFF_CEILING_STEP = 0.03;

// The rating model can only learn table_rule from hands that reach showdown.
// Folding based on an untrusted prior means we never see the very hands that
// would correct it. So for the first few hands of a leg (few observed
// showdowns), call down to a fixed equity floor instead of true pot odds —
// buys information at a bounded cost until the model has enough evidence.
// Multiway showdowns hand back several pairwise comparisons at once (see
// buildRatingModel), so the model converges faster and needs fewer hands.
const EXPLORATION_HANDS = 8;
const EXPLORATION_CALL_FLOOR = 0.35;

// Phase 3 only pays out for strictly topping the table, so standing matters:
// comfortably leading late in a leg is worth protecting (tighten up), while
// trailing late is worth pushing for (seek variance) since merely being up
// scores nothing.
const STANDING_LATE_LEG_FRAC = 0.25;
const LEADING_BLUFF_MULT = 0.4;
const LEADING_STRONG_BET_BUMP = 0.05;
const TRAILING_BLUFF_MULT = 1.6;
const TRAILING_CALL_MARGIN_RELIEF = 0.03;

function decide(state) {
  const legal = new Set(state.legal_actions || []);
  const { headsUpEq, winProb, numOpponents } = computeEquity(state);
  const toCall = state.to_call || 0;
  const exploring = state.phase !== 1 && (state.recent_hands || []).length < EXPLORATION_HANDS;

  const extraOpponents = Math.max(0, numOpponents - 1);
  let strongBetEq = clamp(STRONG_BET_EQ + extraOpponents * MULTIWAY_STRONG_BET_STEP, 0, 0.95);
  let valueRaiseEq = clamp(VALUE_RAISE_EQ + extraOpponents * MULTIWAY_VALUE_RAISE_STEP, 0, 0.97);
  let bluffEqCeiling = clamp(BLUFF_EQ_CEILING - extraOpponents * MULTIWAY_BLUFF_CEILING_STEP, 0.05, 1);
  let bluffFrequency = BLUFF_FREQUENCY / numOpponents;
  let callMargin = CALL_MARGIN;

  const lateLeg = state.phase !== 1 && legRemainingFrac(state) <= STANDING_LATE_LEG_FRAC;
  if (lateLeg) {
    if (isLeadingTable(state)) {
      bluffFrequency *= LEADING_BLUFF_MULT;
      strongBetEq = clamp(strongBetEq + LEADING_STRONG_BET_BUMP, 0, 0.97);
    } else {
      bluffFrequency *= TRAILING_BLUFF_MULT;
      callMargin = Math.max(0, callMargin - TRAILING_CALL_MARGIN_RELIEF);
    }
  }

  if (toCall === 0) {
    if (legal.has("bet")) {
      if (headsUpEq >= strongBetEq) {
        const amount = sizeRaise(state.min_raise_to, state.max_raise_to, headsUpEq);
        if (amount !== null) return { action: "bet", amount };
      } else if (headsUpEq <= bluffEqCeiling && Math.random() < bluffFrequency) {
        const bluffEq = 0.55; // modest sizing, not a full-pot overbet
        const amount = sizeRaise(state.min_raise_to, state.max_raise_to, bluffEq);
        if (amount !== null) return { action: "bet", amount };
      }
    }
    if (legal.has("check")) return { action: "check" };
    if (legal.has("call")) return { action: "call" };
    return { action: "fold" };
  }

  // Facing a bet. Pot odds compare against the actual probability of
  // winning the whole pot (winProb, derated for every live opponent) —
  // that's the number the math is about, not raw hand strength.
  const potOdds = toCall / (state.pot + toCall);
  const callThreshold = exploring
    ? Math.min(potOdds + callMargin, EXPLORATION_CALL_FLOOR)
    : potOdds + callMargin;

  if (winProb >= callThreshold) {
    if (headsUpEq >= valueRaiseEq && legal.has("raise")) {
      const amount = sizeRaise(state.min_raise_to, state.max_raise_to, headsUpEq);
      if (amount !== null) return { action: "raise", amount };
    }
    if (legal.has("call")) return { action: "call" };
    if (legal.has("check")) return { action: "check" };
    return { action: "fold" };
  }

  if (legal.has("fold")) return { action: "fold" };
  if (legal.has("check")) return { action: "check" };
  if (legal.has("call")) return { action: "call" };
  return { action: "fold" };
}

const move = (req, res) => {
  const decision = decide(req.body || {});
  res.status(200).json(decision);
};

const health = (req, res) => {
  res.status(200).json({ status: "ok" });
};

module.exports = {
  move,
  health,
  decide,
  equity,
  sizeRaise,
  buildRatingModel,
  learnedEquity,
  equityForState,
  computeEquity,
  countLiveOpponents,
  multiwayEquityFromHeadsUp,
  isLeadingTable,
  legRemainingFrac,
};
