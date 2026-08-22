const { Router } = require("express");
const { kanCheongDeliveryDriver } = require("../controllers/kanCheongController");

const router = Router();

router.post("/", kanCheongDeliveryDriver);

module.exports = router;
