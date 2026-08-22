const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function hourToStr(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

// "14:00" -> 14. Everything in this world falls on the hour, so minutes are
// never anything but "00" and can be dropped.
function strToHour(str) {
  return parseInt(str.slice(0, 2), 10);
}

// Does [aStart,aEnd) overlap [bStart,bEnd)? Half-open intervals: a slot
// ending exactly when another begins does not overlap it.
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

module.exports = { DAYS, hourToStr, strToHour, overlaps };
