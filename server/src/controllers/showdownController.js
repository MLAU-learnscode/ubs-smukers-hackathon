// Showdown: heads-up betting-game bot. One number 1-13 dealt to each player,
// one shared community number 1-13 revealed mid-hand. Pair (your_number ==
// community_number) beats any non-pair; otherwise higher number wins.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Exact showdown equity vs a uniformly-random, independent opponent number
// (1-13). When community is null (pre-reveal) it averages over all 13
// possible community numbers too. Cheap (<=169 iterations), so compute fresh
// every call rather than caching.
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
  const eq = equity(state.your_number, state.community_number ?? null);
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

module.exports = { move, health, decide, equity, sizeRaise };
