const { GhostChainsGraph } = require("../services/ghostChainsService");

// Single in-memory graph instance for the process lifetime. Cleared via /reset.
const graph = new GhostChainsGraph();

const getHealth = (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
};

const resetGraph = (req, res) => {
  graph.reset();
  res.status(200).json({ status: "reset" });
};

// Processes transactions sequentially (order affects graph state — never
// Promise.all). First idempotency conflict aborts the batch; everything
// already committed for earlier items in the batch stays committed.
const postTransactions = (req, res, next) => {
  try {
    const transactions = req.body;
    if (!Array.isArray(transactions)) {
      const err = new Error("request body must be an array of transactions");
      err.statusCode = 400;
      throw err;
    }

    const results = [];
    for (const tx of transactions) {
      results.push(graph.processTransaction(tx));
    }

    res.status(200).json(results);
  } catch (err) {
    next(err);
  }
};

module.exports = { getHealth, resetGraph, postTransactions, graph };
