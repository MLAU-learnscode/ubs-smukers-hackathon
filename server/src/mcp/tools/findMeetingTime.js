const { z } = require("zod");
const { DAYS, hourToStr, strToHour } = require("./lib/timeUtils");
const { findMeetingWindow } = require("./lib/meetingWindow");

function register(server) {
  server.registerTool(
    "find_meeting_time",
    {
      description:
        "Finds the best meeting window on a given day, inside a given time range, during " +
        "which you and every named friend are free. A window that overlaps none of your " +
        "commitments (including tentative ones) always wins, however late it falls; only " +
        "if no such clean window exists in the range does it fall back to the earliest " +
        "window that overlaps nothing but your own tentative commitments. Returns the " +
        "chosen start and end time, both HH:MM.",
      inputSchema: {
        day: z.enum(DAYS).describe("Weekday name, e.g. 'Tuesday'"),
        range_start: z
          .string()
          .regex(/^([01]\d|2[0-3]):00$/)
          .describe("Earliest the window may start, HH:MM on the hour"),
        range_end: z
          .string()
          .regex(/^([01]\d|2[0-3]):00$/)
          .describe("Latest the window may end, HH:MM on the hour"),
        duration_minutes: z
          .number()
          .int()
          .positive()
          .multipleOf(60)
          .describe("Length of the meeting in minutes; must be a whole number of hours"),
        people: z
          .array(z.string())
          .min(1)
          .describe("Names of the friends who need to be free too (do not include yourself)"),
      },
    },
    async ({ day, range_start: rangeStart, range_end: rangeEnd, duration_minutes: durationMinutes, people }) => {
      const windowStart = strToHour(rangeStart);
      const windowEnd = strToHour(rangeEnd);
      const durationHours = durationMinutes / 60;

      let result;
      try {
        result = await findMeetingWindow({ day, windowStart, windowEnd, durationHours, people });
      } catch (err) {
        return {
          content: [{ type: "text", text: `error: could not resolve schedules (${err.message})` }],
          isError: true,
        };
      }

      if (!result) {
        return {
          content: [{ type: "text", text: "error: no window in range works for everyone" }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ start: hourToStr(result.start), end: hourToStr(result.end) }),
          },
        ],
      };
    }
  );
}

module.exports = { register };
