const { z } = require("zod");
const { getVenues, getLocation } = require("./lib/cityClient");
const { DAYS, hourToStr, strToHour } = require("./lib/timeUtils");
const { findMeetingWindow } = require("./lib/meetingWindow");
const { medianPoint, totalTravel } = require("./lib/geometry");

function register(server) {
  server.registerTool(
    "plan_outing",
    {
      description:
        "Plans a whole outing in one call: a meeting window everyone can make, a meeting " +
        "point, and a place to eat afterwards — chosen jointly so the total journey " +
        "(everyone's travel to the meeting point, plus the trip from there to the venue) " +
        "is as small as possible. The eating place must be open for the hour right after " +
        "the meeting ends. Returns { window: {start, end}, point: [x, y], venue }.",
      inputSchema: {
        day: z.enum(DAYS).describe("Weekday name"),
        start: z
          .tuple([z.number().int().min(0).max(9), z.number().int().min(0).max(9)])
          .describe("Your own current position as [x, y]"),
        people: z.array(z.string()).min(1).describe("Friends to meet for the get-together"),
        range_start: z
          .string()
          .regex(/^([01]\d|2[0-3]):00$/)
          .describe("Earliest the meeting window may start, HH:MM"),
        range_end: z
          .string()
          .regex(/^([01]\d|2[0-3]):00$/)
          .describe("Latest the meeting window may end, HH:MM"),
        duration_minutes: z
          .number()
          .int()
          .positive()
          .multipleOf(60)
          .describe("Length of the meeting in minutes; must be a whole number of hours"),
      },
    },
    async ({ day, start, people, range_start: rangeStart, range_end: rangeEnd, duration_minutes: durationMinutes }) => {
      const windowStart = strToHour(rangeStart);
      const windowEnd = strToHour(rangeEnd);
      const durationHours = durationMinutes / 60;

      let meeting;
      try {
        meeting = await findMeetingWindow({ day, windowStart, windowEnd, durationHours, people });
      } catch (err) {
        return {
          content: [{ type: "text", text: `error: could not resolve schedules (${err.message})` }],
          isError: true,
        };
      }
      if (!meeting) {
        return {
          content: [{ type: "text", text: "error: no meeting window in range works for everyone" }],
          isError: true,
        };
      }

      let locations;
      let venueData;
      try {
        [locations, venueData] = await Promise.all([
          Promise.all(people.map((p) => getLocation(p, day))),
          getVenues(day),
        ]);
      } catch (err) {
        return {
          content: [{ type: "text", text: `error: could not fetch locations/venues (${err.message})` }],
          isError: true,
        };
      }

      const attendeePoints = [start, ...locations.map((l) => [l.x, l.y])];

      // Only venues open for the hour immediately following the meeting count.
      const eatHourStart = meeting.end;
      const eatHourEnd = meeting.end + 1;
      const candidates = (venueData.venues || []).filter((v) =>
        (v.available || []).some(
          ([s, e]) => strToHour(s) <= eatHourStart && eatHourEnd <= strToHour(e)
        )
      );

      if (candidates.length === 0) {
        return {
          content: [{ type: "text", text: "error: no venue is open right after the meeting" }],
          isError: true,
        };
      }

      // For a fixed venue, the point minimising (everyone's travel to it) +
      // (its own trip onward to that venue) is the Manhattan median of
      // attendees plus the venue itself, treated as one more point to visit.
      let best = null;
      for (const venue of candidates) {
        const points = [...attendeePoints, [venue.x, venue.y]];
        const point = medianPoint(points);
        const cost = totalTravel(attendeePoints, point) + Math.abs(point[0] - venue.x) + Math.abs(point[1] - venue.y);
        if (!best || cost < best.cost) {
          best = { cost, point, venue: venue.name };
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              window: { start: hourToStr(meeting.start), end: hourToStr(meeting.end) },
              point: best.point,
              venue: best.venue,
            }),
          },
        ],
      };
    }
  );
}

module.exports = { register };
