const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const routes = require("./routes");
const { solve } = require("./controllers/adaptiveGatewayController");
const { kanCheongDeliveryDriver } = require("./controllers/kanCheongController");
const notFound = require("./middleware/notFound");
const errorHandler = require("./middleware/errorHandler");

const app = express();

// Security & parsing
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Logging (skip in test environment)
if (process.env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
}

// Routes — challenge-required root endpoints
app.post("/solve", solve);
app.post("/kan-cheong-delivery-driver", kanCheongDeliveryDriver);
app.use("/api", routes);

// 404 & error handling must come last
app.use(notFound);
app.use(errorHandler);

module.exports = app;
