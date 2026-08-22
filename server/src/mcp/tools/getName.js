const { z } = require("zod");

const NAME = "Nursery Toolbox";

function register(server) {
  server.registerTool(
    "get_name",
    {
      description: "Returns the agent's name",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: NAME }],
    })
  );
}

module.exports = { register, NAME };
