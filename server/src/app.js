const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const routes = require("./routes");
const { solve, reset } = require("./controllers/adaptiveGatewayController");
const { kanCheongDeliveryDriver } = require("./controllers/kanCheongController");
const { move: showdownMove, health: showdownHealth } = require("./controllers/showdownController");
const ghostChainsRoutes = require("./routes/ghostChainsRoutes");
const { handleMcp } = require("./mcp/mcpHandler");
const notFound = require("./middleware/notFound");
const errorHandler = require("./middleware/errorHandler");

const app = express();

// Security & parsing
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.text({ type: "*/*", limit: "50mb" }));

// Logging (skip in test environment)
if (process.env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
}

// Routes — challenge-required root endpoints
app.post("/solve", solve);
app.post("/solve/", solve);
app.post("/adaptive-gateway/solve", solve);
app.post("/adaptive-gateway/solve/", solve);
app.post("/api/solve", solve);
app.post("/api/solve/", solve);
app.post("/reset", reset);
app.get("/reset", reset);
app.post("/kan-cheong-delivery-driver", kanCheongDeliveryDriver);
app.use("/ghost-chains", ghostChainsRoutes);
app.post("/move", showdownMove);
app.get("/health", showdownHealth);
app.post("/mcp", handleMcp);
app.post("/mcp/", handleMcp);
app.use("/api", routes);

// 404 & error handling must come last
app.use(notFound);
app.use(errorHandler);

module.exports = app;
