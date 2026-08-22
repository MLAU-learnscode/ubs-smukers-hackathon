const { getSchedule } = require("./cityClient");
const { getOwnScheduleForDay } = require("./ownSchedule");
const { overlaps, strToHour } = require("./timeUtils");

function anyOverlap(intervals, start, end) {
  return intervals.some(([s, e]) => overlaps(start, end, s, e));
}

// Finds the best `durationHours`-long window inside [windowStart, windowEnd)
// on `day` during which the android and every named friend are free.
//
// Two-pass, per the spec: a window that is completely clean (no ACCEPTED,
// no TENTATIVE overlap) always wins, however late it falls; only when no
// clean window exists anywhere in the range do we fall back to the
// earliest window that overlaps nothing but the android's own TENTATIVE
// commitments. Friends have no tentative concept — their `busy` is hard.
async function findMeetingWindow({ day, windowStart, windowEnd, durationHours, people }) {
  const own = getOwnScheduleForDay(day);
  const schedules = await Promise.all(people.map((p) => getSchedule(p, day)));
  const friendBusy = schedules.flatMap((s) => (s.busy || []).map(([start, end]) => [strToHour(start), strToHour(end)]));

  const hardBusy = [...own.accepted, ...friendBusy];
  const softBusy = own.tentative;

  const candidates = [];
  for (let t = windowStart; t + durationHours <= windowEnd; t++) {
    candidates.push(t);
  }

  for (const t of candidates) {
    const end = t + durationHours;
    if (!anyOverlap(hardBusy, t, end) && !anyOverlap(softBusy, t, end)) {
      return { start: t, end, clean: true };
    }
  }

  for (const t of candidates) {
    const end = t + durationHours;
    if (!anyOverlap(hardBusy, t, end)) {
      return { start: t, end, clean: false };
    }
  }

  return null;
}

module.exports = { findMeetingWindow };
