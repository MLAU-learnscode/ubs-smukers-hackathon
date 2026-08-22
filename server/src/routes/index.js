const { Router } = require("express");
const healthRoutes = require("./healthRoutes");

const router = Router();

router.use("/health", healthRoutes);

// Register new feature routes here, e.g.:
// router.use("/delivery", require("./deliveryRoutes"));

module.exports = router;
