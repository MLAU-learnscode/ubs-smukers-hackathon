const CURRENT_YEAR = 2037;

// A round trip to year Y and back costs 2*(CURRENT_YEAR - Y) energy no matter
// how many stops are made along the way (the jump costs telescope), so the
// only thing energy limits is how far back we can go.
function maxDepth(energy) {
  return Math.floor(energy / 2);
}

// Selling never costs capital or energy, so for any bought unit the best
// possible sell is simply the highest price for that stock anywhere within
// reach — there's no benefit to ever selling for less.
function buildTradeItems(timeline, minYear) {
  const years = Object.keys(timeline)
    .map(Number)
    .filter((y) => Number.isInteger(y) && y >= minYear && y <= CURRENT_YEAR);

  const best = new Map(); // stock -> { price, year }
  for (const year of years) {
    for (const [stock, info] of Object.entries(timeline[year] ?? timeline[String(year)] ?? {})) {
      if (!info || !(info.price > 0)) continue;
      const current = best.get(stock);
      if (!current || info.price > current.price) best.set(stock, { price: info.price, year });
    }
  }

  const items = [];
  for (const year of years) {
    for (const [stock, info] of Object.entries(timeline[year] ?? timeline[String(year)] ?? {})) {
      if (!info || !(info.price > 0) || !(info.qty > 0)) continue;
      const target = best.get(stock);
      if (!target || target.year === year) continue;
      const profitPerUnit = target.price - info.price;
      if (profitPerUnit <= 0) continue;
      items.push({
        year,
        stock,
        price: info.price,
        qty: Math.floor(info.qty),
        profitPerUnit,
        sellYear: target.year,
      });
    }
  }
  return items;
}

function expandToChunks(items) {
  const chunks = [];
  items.forEach((item, itemIdx) => {
    let remaining = item.qty;
    let size = 1;
    while (remaining > 0) {
      const take = Math.min(size, remaining);
      chunks.push({ itemIdx, qty: take, cost: take * item.price, profit: take * item.profitPerUnit });
      remaining -= take;
      size *= 2;
    }
  });
  return chunks;
}

// ponytail: exact 0/1 knapsack via DP; degrades to a profit/cost greedy when
// the DP table would be huge, so a pathological capital can't hang the request.
function greedyPick(items, capital) {
  const byRatio = [...items].sort((a, b) => b.profitPerUnit / b.price - a.profitPerUnit / a.price);
  let remaining = capital;
  const picked = [];
  for (const item of byRatio) {
    if (remaining <= 0) break;
    const qty = Math.min(item.qty, Math.floor(remaining / item.price));
    if (qty > 0) {
      picked.push({ ...item, qty });
      remaining -= qty * item.price;
    }
  }
  return picked;
}

function pickPurchases(items, capital) {
  const cap = Math.max(0, Math.floor(capital));
  if (items.length === 0 || cap === 0) return [];

  const chunks = expandToChunks(items);
  if (chunks.length * cap > 5_000_000) return greedyPick(items, cap);

  const n = chunks.length;
  const dp = new Float64Array(cap + 1);
  const taken = new Uint8Array(n * (cap + 1));
  for (let i = 0; i < n; i++) {
    const { cost, profit } = chunks[i];
    const row = i * (cap + 1);
    for (let w = cap; w >= cost; w--) {
      const candidate = dp[w - cost] + profit;
      if (candidate > dp[w]) {
        dp[w] = candidate;
        taken[row + w] = 1;
      }
    }
  }

  const qtyByItem = new Map();
  let w = cap;
  for (let i = n - 1; i >= 0; i--) {
    if (taken[i * (cap + 1) + w]) {
      const c = chunks[i];
      qtyByItem.set(c.itemIdx, (qtyByItem.get(c.itemIdx) || 0) + c.qty);
      w -= c.cost;
    }
  }

  const picked = [];
  for (const [idx, qty] of qtyByItem.entries()) {
    if (qty > 0) picked.push({ ...items[idx], qty });
  }
  return picked;
}

function buildActions(purchases) {
  if (purchases.length === 0) return [];

  const allYears = new Set();
  for (const p of purchases) {
    allYears.add(p.year);
    allYears.add(p.sellYear);
  }
  const descOrder = [...allYears].sort((a, b) => b - a);
  const ascOrder = [...descOrder].reverse();

  const buysByYear = new Map();
  const sellsByYear = new Map();
  for (const p of purchases) {
    if (!buysByYear.has(p.year)) buysByYear.set(p.year, []);
    buysByYear.get(p.year).push(p);
    if (!sellsByYear.has(p.sellYear)) sellsByYear.set(p.sellYear, []);
    sellsByYear.get(p.sellYear).push(p);
  }

  const actions = [];
  let cursor = CURRENT_YEAR;

  for (const year of descOrder) {
    if (year !== cursor) {
      actions.push(`j-${cursor}-${year}`);
      cursor = year;
    }
    for (const p of buysByYear.get(year) || []) actions.push(`b-${p.stock}-${p.qty}`);
  }

  for (const year of ascOrder) {
    if (year !== cursor) {
      actions.push(`j-${cursor}-${year}`);
      cursor = year;
    }
    for (const p of sellsByYear.get(year) || []) actions.push(`s-${p.stock}-${p.qty}`);
  }

  if (cursor !== CURRENT_YEAR) actions.push(`j-${cursor}-${CURRENT_YEAR}`);

  return actions;
}

function solveCase(testCase) {
  const { energy, capital, timeline } = testCase || {};
  if (!(energy > 1) || !(capital > 0) || typeof timeline !== "object" || timeline === null) {
    return [];
  }

  const minYear = CURRENT_YEAR - maxDepth(energy);
  const items = buildTradeItems(timeline, minYear);
  const purchases = pickPurchases(items, capital);
  return buildActions(purchases);
}

const solveStonks = (req, res, next) => {
  try {
    console.log("[STONK_INPUT]", JSON.stringify(req.body));
    const cases = Array.isArray(req.body) ? req.body : [];
    const results = cases.map((testCase, idx) => {
      try {
        return solveCase(testCase);
      } catch (err) {
        console.error(`stonks: failed to solve test case ${idx}`, err);
        return [];
      }
    });
    console.log("[STONK_OUTPUT]", JSON.stringify(results));
    res.status(200).json(results);
  } catch (err) {
    console.error("[STONK ERROR]", err.message);
    next(err);
  }
};

module.exports = { solveStonks };
