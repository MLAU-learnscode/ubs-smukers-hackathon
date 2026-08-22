const { z } = require("zod");
const { getVenues } = require("./lib/cityClient");
const { DAYS, strToHour } = require("./lib/timeUtils");

function register(server) {
  server.registerTool(
    "venues_open_at",
    {
      description:
        "Lists every venue open at a given time on a given day. A venue is open at that " +
        "time if it falls within one of the venue's published available windows (windows " +
        "are [start, end) — a venue closing at 21:00 is not open for a 21:00 query). " +
        "Returns the names of every matching venue, in no particular order.",
      inputSchema: {
        day: z.enum(DAYS).describe("Weekday name, e.g. 'Thursday'"),
        time: z
          .string()
          .regex(/^([01]\d|2[0-3]):00$/)
          .describe("Zero-padded 24-hour time on the hour, e.g. '08:00' or '21:00'"),
      },
    },
    async ({ day, time }) => {
      let data;
      try {
        data = await getVenues(day);
      } catch (err) {
        return {
          content: [{ type: "text", text: `error: could not fetch venues (${err.message})` }],
          isError: true,
        };
      }

      const hour = strToHour(time);
      const open = (data.venues || []).filter((v) =>
        (v.available || []).some(([start, end]) => strToHour(start) <= hour && hour < strToHour(end))
      );

      return {
        content: [{ type: "text", text: open.map((v) => v.name).join(", ") }],
      };
    }
  );
}

module.exports = { register };
