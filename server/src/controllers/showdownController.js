// Showdown: heads-up betting-game bot. One number 1-13 dealt to each player,
// one shared community number 1-13 revealed mid-hand.
//
// Phase 1 ("standard" rule): pair (your_number == community_number) beats
// any non-pair; otherwise higher number wins. `equity()` below is exact for
// that rule.
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
function buildRatingModel(recentHands, mySeat) {
  const rating = {};
  for (let n = 1; n <= 13; n++) rating[n] = n;
  let pairBonus = INITIAL_PAIR_BONUS;

  for (const hand of recentHands || []) {
    const community = hand.community_number;
    const shown = hand.shown_numbers;
    if (community === null || community === undefined || !shown) continue;

    const myNum = shown[mySeat];
    if (myNum === undefined) continue;

    const oppSeats = Object.keys(shown)
      .map(Number)
      .filter((s) => s !== mySeat);
    if (oppSeats.length !== 1) continue; // only handle heads-up showdowns

    const oppSeat = oppSeats[0];
    const oppNum = shown[oppSeat];
    if (oppNum === undefined) continue;

    const winners = hand.winners || [];
    const myWon = winners.includes(mySeat);
    const oppWon = winners.includes(oppSeat);
    const actual = myWon && oppWon ? 0.5 : myWon ? 1 : oppWon ? 0 : 0.5;

    const myPaired = myNum === community;
    const oppPaired = oppNum === community;
    const effMy = rating[myNum] + (myPaired ? pairBonus : 0);
    const effOpp = rating[oppNum] + (oppPaired ? pairBonus : 0);
    const delta = ELO_K * (actual - expectedScore(effMy, effOpp));

    if (myPaired) {
      rating[myNum] += delta / 2;
      pairBonus += delta / 2;
    } else {
      rating[myNum] += delta;
    }

    if (oppPaired) {
      rating[oppNum] -= delta / 2;
      pairBonus -= delta / 2;
    } else {
      rating[oppNum] -= delta;
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

function equityForState(state) {
  const community = state.community_number ?? null;
  if (state.phase === 1) return equity(state.your_number, community);

  const model = buildRatingModel(state.recent_hands, state.your_seat);
  return learnedEquity(state.your_number, community, model);
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

function decide(state) {
  const legal = new Set(state.legal_actions || []);
  const eq = equityForState(state);
  const toCall = state.to_call || 0;

  if (toCall === 0) {
    if (legal.has("bet")) {
      if (eq >= STRONG_BET_EQ) {
        const amount = sizeRaise(state.min_raise_to, state.max_raise_to, eq);
        if (amount !== null) return { action: "bet", amount };
      } else if (eq <= BLUFF_EQ_CEILING && Math.random() < BLUFF_FREQUENCY) {
        const bluffEq = 0.55; // modest sizing, not a full-pot overbet
        const amount = sizeRaise(state.min_raise_to, state.max_raise_to, bluffEq);
        if (amount !== null) return { action: "bet", amount };
      }
    }
    if (legal.has("check")) return { action: "check" };
    if (legal.has("call")) return { action: "call" };
    return { action: "fold" };
  }

  // Facing a bet.
  const potOdds = toCall / (state.pot + toCall);

  if (eq >= potOdds + CALL_MARGIN) {
    if (eq >= VALUE_RAISE_EQ && legal.has("raise")) {
      const amount = sizeRaise(state.min_raise_to, state.max_raise_to, eq);
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
};
