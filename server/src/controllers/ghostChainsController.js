const { GhostChainsGraph } = require("../services/ghostChainsService");

// Single in-memory graph instance for the process lifetime. Cleared via /reset.
const graph = new GhostChainsGraph();

const getHealth = (req, res) => {
  res.status(200).json({ status: "ok" });
};

const resetGraph = (req, res) => {
  graph.reset();
  res.status(200).json({ clearTransactions: true });
};

// Processes transactions sequentially (order affects graph state — never
// Promise.all). A single transaction's validation/idempotency failure must
// not sink the whole batch's response: every other transaction in the
// request still needs its score returned, in order, per the endpoint
// contract. A failing transaction gets riskScore 0 in its slot rather than
// being dropped, so the response array always lines up 1:1 with the request.
const postTransactions = (req, res, next) => {
  try {
    const transactions = req.body?.transactions;
    if (!Array.isArray(transactions)) {
      const err = new Error("request body must be { transactions: [...] }");
      err.statusCode = 400;
      throw err;
    }

    const results = [];
    for (const tx of transactions) {
      try {
        results.push(graph.processTransaction(tx));
      } catch (err) {
        results.push({ txId: tx && typeof tx === "object" ? tx.txId ?? null : null, riskScore: 0 });
      }
    }

    res.status(200).json({ transactions: results });
  } catch (err) {
    next(err);
  }
};

module.exports = { getHealth, resetGraph, postTransactions, graph };
