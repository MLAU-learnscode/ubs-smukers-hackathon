const { Router } = require("express");
const healthRoutes = require("./healthRoutes");
const adaptiveGatewayRoutes = require("./adaptiveGatewayRoutes");
const { solve } = require("../controllers/adaptiveGatewayController");

const router = Router();

router.use("/health", healthRoutes);
router.post("/solve", solve);
router.use("/adaptive-gateway", adaptiveGatewayRoutes);

// Register new feature routes here, e.g.:
// router.use("/delivery", require("./deliveryRoutes"));

module.exports = router;
