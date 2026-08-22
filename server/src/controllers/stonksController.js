const CURRENT_YEAR = 2037;

// A round trip to year Y and back costs 2*(CURRENT_YEAR - Y) energy no matter
// how many stops are made along the way (the jump costs telescope), so the
// only thing energy limits is how far back we can go.
function maxDepth(energy) {
  return Math.floor(energy / 2);
}

// The trip is a single there-and-back walk: descend from 2037 to the deepest
// reachable year, then ascend back. Every year in between is visited twice
// (once each direction) except the turnaround point.
function buildPath(timeline, minYear) {
  const years = new Set([CURRENT_YEAR]);
  for (const key of Object.keys(timeline)) {
    const y = Number(key);
    if (Number.isInteger(y) && y >= minYear && y <= CURRENT_YEAR) years.add(y);
  }
  const descending = [...years].sort((a, b) => b - a);
  const ascending = [...descending].reverse();
  return descending.concat(ascending.slice(1)); // turnaround year isn't repeated
}

function priceAt(timeline, year, stock) {
  const stocks = timeline[year] ?? timeline[String(year)];
  const info = stocks && stocks[stock];
  return info && info.price > 0 ? info.price : undefined;
}

// A unit bought at position t is only worth buying if some later stop sells
// higher; suffixMax[t] is the best price strictly after t, suffixPos[t] the
// earliest position achieving it (selling at the first tie frees capital
// sooner for reuse elsewhere in the same trip — a strictly better outcome
// than waiting for a later tie).
function buildSuffix(path, timeline, stock) {
  const n = path.length;
  const max = new Array(n + 1).fill(-Infinity);
  const pos = new Array(n + 1).fill(-1);
  for (let t = n - 1; t >= 0; t--) {
    const p = priceAt(timeline, path[t], stock);
    if (p !== undefined && p >= max[t + 1]) {
      max[t] = p;
      pos[t] = t;
    } else {
      max[t] = max[t + 1];
      pos[t] = pos[t + 1];
    }
  }
  return { max, pos };
}

// Capital is one shared pool: buying at t and selling at t' ties up `cost` of
// it for the whole [t, t') window. Multiple such windows can overlap (from
// different stocks/years), so before committing a candidate we need the
// worst-case capital already committed anywhere in its window — a difference
// array over "committed cost per position", rebuilt to a prefix sum on query.
function makeCapitalLedger(length, capital) {
  const delta = new Array(length + 1).fill(0);
  return {
    maxCommittedIn(lo, hi) {
      let running = 0;
      let best = 0;
      for (let t = 0; t < hi; t++) {
        running += delta[t];
        if (t >= lo) best = Math.max(best, running);
      }
      return best;
    },
    commit(lo, hi, cost) {
      delta[lo] += cost;
      delta[hi] -= cost;
    },
    room(lo, hi) {
      return capital - this.maxCommittedIn(lo, hi);
    },
  };
}

function solveCase(testCase) {
  const { energy, capital, timeline } = testCase || {};
  if (!(energy > 1) || !(capital > 0) || typeof timeline !== "object" || timeline === null) {
    return [];
  }

  const minYear = CURRENT_YEAR - maxDepth(energy);
  const path = buildPath(timeline, minYear);

  const stocks = new Set();
  for (const year of path) {
    for (const name of Object.keys(timeline[year] ?? timeline[String(year)] ?? {})) stocks.add(name);
  }

  const suffixByStock = new Map();
  for (const stock of stocks) suffixByStock.set(stock, buildSuffix(path, timeline, stock));

  // One candidate per (year, stock): its first appearance in the path, since
  // buying there is never worse than waiting for the year's second visit
  // (strictly more future remains, so the achievable sell price only shrinks
  // later) — buying earlier dominates, so the later visit adds nothing.
  const seenYearStock = new Set();
  const candidates = [];
  for (let t = 0; t < path.length; t++) {
    const year = path[t];
    for (const stock of stocks) {
      const key = `${year}|${stock}`;
      if (seenYearStock.has(key)) continue;
      const stocksAtYear = timeline[year] ?? timeline[String(year)] ?? {};
      const info = stocksAtYear[stock];
      if (!info || !(info.price > 0) || !(info.qty > 0)) continue;
      seenYearStock.add(key);
      const { max, pos } = suffixByStock.get(stock);
      const sellPrice = max[t + 1];
      if (sellPrice <= info.price) continue; // no profitable future sale
      candidates.push({
        stock,
        buyT: t,
        sellT: pos[t + 1],
        price: info.price,
        qty: Math.floor(info.qty),
        sellPrice,
      });
    }
  }

  candidates.sort((a, b) => (b.sellPrice - b.price) / b.price - (a.sellPrice - a.price) / a.price);

  const ledger = makeCapitalLedger(path.length, capital);
  const actionsAt = path.map(() => []);
  const sellQtyAt = new Map(); // `${sellT}|${stock}` -> qty, so repeat sells at one stop merge

  for (const c of candidates) {
    const room = ledger.room(c.buyT, c.sellT);
    if (room <= 0) continue;
    const qty = Math.min(c.qty, Math.floor(room / c.price));
    if (qty <= 0) continue;

    ledger.commit(c.buyT, c.sellT, qty * c.price);
    actionsAt[c.buyT].push(`b-${c.stock}-${qty}`);

    const sellKey = `${c.sellT}|${c.stock}`;
    sellQtyAt.set(sellKey, (sellQtyAt.get(sellKey) || 0) + qty);
  }

  for (const [key, qty] of sellQtyAt.entries()) {
    const [tStr, stock] = key.split("|");
    actionsAt[Number(tStr)].push(`s-${stock}-${qty}`);
  }

  // Walk the path emitting only jumps between stops that actually have
  // actions — skipping empty pass-through stops costs nothing (the jump
  // distances telescope to the same total either way).
  const actions = [];
  let cursor = CURRENT_YEAR;
  for (let t = 0; t < path.length; t++) {
    if (actionsAt[t].length === 0) continue;
    const year = path[t];
    if (year !== cursor) {
      actions.push(`j-${cursor}-${year}`);
      cursor = year;
    }
    actions.push(...actionsAt[t]);
  }
  if (cursor !== CURRENT_YEAR) actions.push(`j-${cursor}-${CURRENT_YEAR}`);

  return actions;
}

const solveStonks = (req, res, next) => {
  try {
    const cases = Array.isArray(req.body) ? req.body : [];
    const results = cases.map((testCase, idx) => {
      try {
        return solveCase(testCase);
      } catch (err) {
        console.error(`stonks: failed to solve test case ${idx}`, err);
        return [];
      }
    });
    res.status(200).json(results);
  } catch (err) {
    next(err);
  }
};

module.exports = { solveStonks };
