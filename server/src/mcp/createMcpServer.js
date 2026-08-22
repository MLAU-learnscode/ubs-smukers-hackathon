const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");

const getName = require("./tools/getName");
const calculate = require("./tools/calculate");
const identifyShape = require("./tools/identifyShape");
const recallStudyMaterial = require("./tools/recallStudyMaterial");
const planRoute = require("./tools/planRoute");
const venuesOpenAt = require("./tools/venuesOpenAt");
const findMeetingTime = require("./tools/findMeetingTime");
const findMeetingPoint = require("./tools/findMeetingPoint");
const planOuting = require("./tools/planOuting");

function createMcpServer() {
  const server = new McpServer({
    name: "nursery-toolbox",
    version: "1.0.0",
  });

  // Registration order matters (evaluator reads first 20 tools in order)
  getName.register(server);
  calculate.register(server);
  identifyShape.register(server);
  recallStudyMaterial.register(server);
  planRoute.register(server);
  venuesOpenAt.register(server);
  findMeetingTime.register(server);
  findMeetingPoint.register(server);
  planOuting.register(server);

  return server;
}

module.exports = { createMcpServer };
