const { Router } = require("express");
const { getHealth, resetGraph, postTransactions } = require("../controllers/ghostChainsController");

const router = Router();

router.get("/health", getHealth);
router.post("/reset", resetGraph);
router.post("/transactions", postTransactions);

module.exports = router;
