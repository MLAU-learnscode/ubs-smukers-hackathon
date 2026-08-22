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
//
// Phase 4 is a knockout tournament against other teams' bots (never ours),
// up to 7 seats per table, one table_rule per table as before. Every round
// that survives a cut reshuffles into a fresh table with a fresh leg, so
// recent_hands still resets exactly when the rule would change under us —
// nothing here is keyed to a fixed seat count, so the phase-3 multiway
// logic (countLiveOpponents, multiwayEquityFromHeadsUp, the rating/rule
// models) already generalizes from 6 seats to 7 without modification. The
// two things phase 4 actually adds are operational, not mathematical: the
// health check (health() below) has to stay cheap and dependency-free so it
// can't fail right before the bracket cuts, and move() has to degrade to a
// safe legal action rather than throw for literally any payload shape,
// since a bad table_rule guess or a malformed field from an unfamiliar
// opponent bot's match is not grounds for forfeiting a hand (see
// safestFallback()).

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

// --- Phase 3: fast rule identification --------------------------------
//
// The Elo model above nudges a rating by a small fixed step (ELO_K) per
// observed showdown, starting from a standard-rule prior. That works fine
// when the true rule is close to standard, but real showdown data has shown
// at least one table_rule (seen live: a pair losing to a non-pair, and the
// LOWER non-pair number winning — the exact mirror image of standard) that
// is a full inversion of the prior. Inverting 13 numbers' relative order one
// small nudge at a time takes far more hands than we get before the model's
// own (badly wrong-signed) confidence has already pushed real money into
// exactly the hands that are worst under the true rule.
//
// So before falling back to the slow Elo nudge, test a handful of simple,
// fully-specified candidate rules directly against every showdown seen so
// far. A single pair-loses-to-non-pair result already falsifies "standard"
// outright — that's decisive in a way no small Elo step can be. Once one
// candidate clearly dominates, use its exact equity instead of the Elo
// model's noisy estimate.
//
// Each comparator answers "who wins, A or B, given this community number",
// returning 1 (A), -1 (B), or 0 (tie) — the only two-player-decomposable
// shapes a showdown rule can plausibly take from this game's primitives.
const RULE_HYPOTHESES = {
  standard: (a, b, c) => {
    const aPair = a === c;
    const bPair = b === c;
    if (aPair !== bPair) return aPair ? 1 : -1;
    if (a === b) return 0;
    return a > b ? 1 : -1;
  },
  inverted: (a, b, c) => {
    const aPair = a === c;
    const bPair = b === c;
    if (aPair !== bPair) return aPair ? -1 : 1;
    if (a === b) return 0;
    return a < b ? 1 : -1;
  },
  pureHigh: (a, b) => (a === b ? 0 : a > b ? 1 : -1),
  pureLow: (a, b) => (a === b ? 0 : a < b ? 1 : -1),
  closestToCommunity: (a, b, c) => {
    const da = Math.abs(a - c);
    const db = Math.abs(b - c);
    return da === db ? 0 : da < db ? 1 : -1;
  },
  farthestFromCommunity: (a, b, c) => {
    const da = Math.abs(a - c);
    const db = Math.abs(b - c);
    return da === db ? 0 : da > db ? 1 : -1;
  },
};

// Score every candidate rule against every provable pairwise outcome in
// recent_hands. A pair (i, j) is only provable when at least one of them is
// in `winners`: if i won and j didn't, i is definitively better than j under
// whatever the true rule is (regardless of a third player k also winning or
// losing) — transitivity of any total-order rule guarantees that. Two seats
// that both lost carry no provable relation to each other from `winners`
// alone, so those pairs are skipped rather than guessed at.
function scoreRuleHypotheses(recentHands) {
  const scores = {};
  for (const name of Object.keys(RULE_HYPOTHESES)) scores[name] = { correct: 0, total: 0 };

  for (const hand of recentHands || []) {
    const community = hand.community_number;
    const shown = hand.shown_numbers;
    if (community === null || community === undefined || !shown) continue;

    const seats = Object.keys(shown).map(Number);
    if (seats.length < 2) continue;
    const winners = new Set(hand.winners || []);

    for (let i = 0; i < seats.length; i++) {
      for (let j = i + 1; j < seats.length; j++) {
        const seatA = seats[i];
        const seatB = seats[j];
        const aWon = winners.has(seatA);
        const bWon = winners.has(seatB);
        if (aWon === bWon && !aWon) continue; // both lost: no provable relation

        const actual = aWon && bWon ? 0 : aWon ? 1 : -1;
        const numA = shown[seatA];
        const numB = shown[seatB];

        for (const [name, cmp] of Object.entries(RULE_HYPOTHESES)) {
          scores[name].total++;
          if (cmp(numA, numB, community) === actual) scores[name].correct++;
        }
      }
    }
  }

  return scores;
}

const RULE_ID_MIN_SAMPLES = 6; // provable pairwise comparisons needed before trusting a hypothesis
const RULE_ID_MIN_ACCURACY = 0.8; // below this, the "best" guess still isn't good enough to act on

// Pick the best-fitting rule name, or null if there isn't enough evidence
// yet (too few provable comparisons) or no candidate clearly fits (a rule
// we haven't modeled, e.g. one that depends on matching another player's
// number rather than the community number) — callers should fall back to
// the slower online Elo model in that case.
function identifyRule(recentHands) {
  const scores = scoreRuleHypotheses(recentHands);
  let best = null;
  for (const [name, s] of Object.entries(scores)) {
    if (s.total < RULE_ID_MIN_SAMPLES) continue;
    const accuracy = s.correct / s.total;
    if (accuracy < RULE_ID_MIN_ACCURACY) continue;
    if (!best || accuracy > best.accuracy) best = { name, accuracy, total: s.total };
  }
  return best ? best.name : null;
}

// Same shape as equity()/learnedEquity() above, but driven directly by an
// identified comparator rule instead of a hardcoded or slowly-learned one.
function comparatorEquity(yourNumber, community, comparator) {
  if (community === null || community === undefined) {
    let total = 0;
    for (let c = 1; c <= 13; c++) total += comparatorEquity(yourNumber, c, comparator);
    return total / 13;
  }

  let win = 0;
  let split = 0;
  for (let o = 1; o <= 13; o++) {
    const result = comparator(yourNumber, o, community);
    if (result > 0) win++;
    else if (result === 0) split++;
  }
  return (win + split * 0.5) / 13;
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

  let headsUpEq;
  if (state.phase === 1) {
    headsUpEq = equity(state.your_number, community);
  } else {
    const identified = identifyRule(state.recent_hands);
    headsUpEq = identified
      ? comparatorEquity(state.your_number, community, RULE_HYPOTHESES[identified])
      : learnedEquity(state.your_number, community, buildRatingModel(state.recent_hands));
  }

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
// scales with hand strength between the legal min and max. Guards against
// undefined (not just an explicit null) since a missing field and a null
// field are both "no legal amount to compute against" - either one used to
// slip through the strict `=== null` check, land in the arithmetic below,
// and come out as NaN, which JSON.stringify silently turns into a
// `null` amount on an action the caller still thought was a valid bet.
function sizeRaise(minRaiseTo, maxRaiseTo, eq) {
  if (!Number.isFinite(minRaiseTo) || !Number.isFinite(maxRaiseTo)) return null;
  const t = clamp((eq - 0.5) / 0.5, 0, 1);
  const amount = Math.round(minRaiseTo + t * (maxRaiseTo - minRaiseTo));
  return clamp(amount, minRaiseTo, maxRaiseTo);
}

const STRONG_BET_EQ = 0.65;
const VALUE_RAISE_EQ = 0.75;
const BLUFF_EQ_CEILING = 0.28;
const BLUFF_FREQUENCY = 0.25;
const CALL_MARGIN = 0.06;

// Busting is a flat -200 and last place at the table regardless of how well
// a leg was going beforehand — there's no partial credit and no recovering
// from 0 chips. That makes going bust categorically worse than folding away
// a marginal +EV spot, especially early in a leg while the online rule
// model hasn't converged yet and a "strong" hand might just be a wrong
// prior. So once the stack is short, any call/raise that would commit a
// large chunk of it needs a bigger equity margin than the same decision
// would need with a deep stack, and bluffing (which risks a chunk of the
// stack on a hand with no real equity) stops paying for itself entirely.
const SURVIVAL_STACK_BB = 20; // below this many big blinds, start being careful
const SURVIVAL_CRITICAL_BB = 8; // by here, be as careful as this guardrail gets
const SURVIVAL_COMMIT_FRACTION = 0.4; // "a large chunk" of the stack, as a fraction
const SURVIVAL_MAX_MARGIN = 0.15; // extra equity margin at its most cautious

function isShortStacked(state) {
  const bb = state.big_blind || 1;
  const stack = state.your_stack;
  if (stack === undefined || stack === null) return false;
  return stack / bb < SURVIVAL_STACK_BB;
}

// Extra pot-odds margin to demand on a call that would commit a large
// fraction of a short stack. 0 once the stack is comfortably deep, or once
// the call is small relative to the stack — this only kicks in for
// genuinely stack-threatening decisions, not routine pot-odds calls.
function survivalCallMargin(state, toCall) {
  const bb = state.big_blind || 1;
  const stack = state.your_stack;
  if (!stack || stack <= 0) return 0;

  const stackBB = stack / bb;
  if (stackBB >= SURVIVAL_STACK_BB) return 0;

  const commitFraction = clamp(toCall / stack, 0, 1);
  if (commitFraction < SURVIVAL_COMMIT_FRACTION) return 0;

  const shortness = clamp(
    (SURVIVAL_STACK_BB - stackBB) / (SURVIVAL_STACK_BB - SURVIVAL_CRITICAL_BB),
    0,
    1
  );
  return SURVIVAL_MAX_MARGIN * shortness * commitFraction;
}

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

  // Short-stacked: a bluff risks a real chunk of a stack that has no
  // recovery once it hits 0, for a hand with no genuine equity behind it.
  // Value bets/raises with real strength are untouched — pushing a short
  // stack with a real hand is still correct, only the bluffing stops.
  if (state.phase !== 1 && isShortStacked(state)) {
    bluffFrequency = 0;
  }
  callMargin += survivalCallMargin(state, toCall);

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

// Safest legal response to an unforeseen state shape: never call/raise
// blind, so an exception can never turn into an accidental chip commitment.
function safestFallback(legal) {
  if (legal.has("fold")) return { action: "fold" };
  if (legal.has("check")) return { action: "check" };
  return { action: "fold" };
}

const move = (req, res) => {
  const state = req.body || {};
  try {
    const decision = decide(state);
    res.status(200).json(decision);
  } catch (err) {
    // The game requires a valid action every turn - a thrown exception with
    // no fallback would otherwise surface as a 500 with no move at all,
    // which the game server has no reason to treat as anything but a
    // forfeited hand. Degrade to the safest legal action instead of losing
    // the turn (and any state built on it) outright.
    console.error("showdown decide() threw, falling back to a safe action:", err);
    res.status(200).json(safestFallback(new Set(state.legal_actions || [])));
  }
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
  isShortStacked,
  survivalCallMargin,
  RULE_HYPOTHESES,
  scoreRuleHypotheses,
  identifyRule,
  comparatorEquity,
};
