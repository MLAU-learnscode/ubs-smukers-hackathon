const { z } = require("zod");

const intRange = z.number().int().min(-100).max(100);

function register(server) {
  server.registerTool(
    "calculate",
    {
      description: "Arithmetic on two ints (-100..100): + - * /",
      inputSchema: {
        operator: z.enum(["+", "-", "*", "/"]),
        a: intRange,
        b: intRange,
      },
    },
    async ({ operator, a, b }) => {
      let result;
      switch (operator) {
        case "+":
          result = a + b;
          break;
        case "-":
          result = a - b;
          break;
        case "*":
          result = a * b;
          break;
        case "/":
          if (b === 0) {
            return {
              content: [{ type: "text", text: "error: division by zero" }],
              isError: true,
            };
          }
          result = a / b;
          break;
      }
      return { content: [{ type: "text", text: String(result) }] };
    }
  );
}

module.exports = { register };
