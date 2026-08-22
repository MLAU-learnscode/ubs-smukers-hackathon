require("dotenv").config();
const app = require("./src/app");

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] running on port ${PORT} (${process.env.NODE_ENV || "development"})`);
});
