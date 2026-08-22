const { Router } = require("express");
const { solve } = require("../controllers/adaptiveGatewayController");

const router = Router();

router.post("/solve", solve);

module.exports = router;
