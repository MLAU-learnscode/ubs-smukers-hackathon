const { Router } = require("express");
const { solve, reset } = require("../controllers/adaptiveGatewayController");

const router = Router();

router.post("/solve", solve);
router.post("/reset", reset);
router.get("/reset", reset);

module.exports = router;
