const { z } = require("zod");
const { getLocation } = require("./lib/cityClient");
const { DAYS } = require("./lib/timeUtils");
const { medianPoint } = require("./lib/geometry");

function register(server) {
  server.registerTool(
    "find_meeting_point",
    {
      description:
        "Finds the grid point [x, y] that minimises total travel for you and a group of " +
        "friends on a given day — your own travel plus every friend's travel, all under " +
        "Manhattan (grid) distance. Include your own current position; friends' positions " +
        "are looked up automatically for the given day. The returned point need not be " +
        "anywhere anyone already is.",
      inputSchema: {
        day: z.enum(DAYS).describe("Weekday name — friends may be in different places on different days"),
        start: z
          .tuple([z.number().int().min(0).max(9), z.number().int().min(0).max(9)])
          .describe("Your own current position as [x, y]"),
        people: z.array(z.string()).min(1).describe("Names of the friends to meet"),
      },
    },
    async ({ day, start, people }) => {
      let locations;
      try {
        locations = await Promise.all(people.map((p) => getLocation(p, day)));
      } catch (err) {
        return {
          content: [{ type: "text", text: `error: could not fetch locations (${err.message})` }],
          isError: true,
        };
      }

      const points = [start, ...locations.map((l) => [l.x, l.y])];
      const point = medianPoint(points);

      return { content: [{ type: "text", text: JSON.stringify(point) }] };
    }
  );
}

module.exports = { register };
