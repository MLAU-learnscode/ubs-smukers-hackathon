const inbox = require("../data/inbox.json");

// Every email in the inbox is an invitation the android already replied to.
// The "When:" line is the line that stands — bodies sometimes mention an
// earlier, superseded time in prose ("we had this down for X originally"),
// but that text never carries a "When:" label itself, so a plain regex on
// the labelled line is enough to get the current time.
const WHEN_RE = /When:\s*([A-Za-z]+)\s+(\d{2}:\d{2})-(\d{2}:\d{2})/;
const RESPONSE_RE = /Response:\s*(ACCEPTED|DECLINED|TENTATIVE)/;

function parseInbox() {
  // day -> { accepted: [[startHour,endHour],...], tentative: [...] }
  const byDay = {};

  for (const email of inbox.emails) {
    const body = email.body || "";
    const respMatch = body.match(RESPONSE_RE);
    const whenMatch = body.match(WHEN_RE);
    if (!respMatch || !whenMatch) continue;

    const response = respMatch[1];
    if (response === "DECLINED") continue; // constrains nothing

    const [, day, start, end] = whenMatch;
    if (!byDay[day]) byDay[day] = { accepted: [], tentative: [] };

    const startHour = parseInt(start.slice(0, 2), 10);
    const endHour = parseInt(end.slice(0, 2), 10);
    const bucket = response === "ACCEPTED" ? "accepted" : "tentative";
    byDay[day][bucket].push([startHour, endHour]);
  }

  return byDay;
}

const SCHEDULE_BY_DAY = parseInbox();

// Returns { accepted: [[startHour,endHour]], tentative: [[startHour,endHour]] }
// for the given day, empty arrays if the android has nothing on record.
function getOwnScheduleForDay(day) {
  return SCHEDULE_BY_DAY[day] || { accepted: [], tentative: [] };
}

module.exports = { getOwnScheduleForDay, SCHEDULE_BY_DAY };
