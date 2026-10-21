// Builds an .ics calendar file so due dates show up (with an alert) in the phone's own calendar.
// Pure functions: no DOM, unit tested in Node.
import { nextDue, todayISO, monthStart, MONTHS, describeSchedule, addDays } from "./schedule.js";

const ALERT_HOUR = 9; // 9:00 on the day the event starts

const icsDate = (iso) => iso.replaceAll("-", "");
const escapeText = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Fold lines longer than 75 octets, as the iCalendar spec requires. */
export function foldLine(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts = [];
  let current = "", size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** The event for one task, or null when it has no due date yet. */
export function taskEvent(task, today = todayISO(), stamp = new Date()) {
  const due = nextDue(task, today);
  if (!due) return null;
  const seasonal = task.schedule === "seasonal";
  // Seasonal tasks get their reminder on the 1st of the month; overdue tasks get one today.
  let start = seasonal && !task.snoozedUntil ? monthStart(Number(due.slice(0, 4)), task.month) : due;
  if (start < today) start = today;

  let rrule = null;
  if (seasonal) rrule = "FREQ=YEARLY";
  else if (task.intervalDays % 7 === 0) rrule = `FREQ=WEEKLY;INTERVAL=${task.intervalDays / 7}`;
  else rrule = `FREQ=DAILY;INTERVAL=${task.intervalDays}`;

  const desc = [
    seasonal ? `Do this any time in ${MONTHS[task.month - 1]}.` : `Repeats ${describeSchedule(task)}.`,
    task.notes,
    "Mark it done in House Upkeep Log so the schedule stays accurate.",
  ]
    .filter(Boolean)
    .join("\n");

  const dtstamp = stamp.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return [
    "BEGIN:VEVENT",
    `UID:${task.id}@house-upkeep-log`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${icsDate(start)}`,
    `DTEND;VALUE=DATE:${icsDate(addDays(start, 1))}`,
    `RRULE:${rrule}`,
    `SUMMARY:${escapeText(task.name)}`,
    `DESCRIPTION:${escapeText(desc)}`,
    "TRANSP:TRANSPARENT",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(task.name)}`,
    `TRIGGER;RELATED=START:PT${ALERT_HOUR}H`,
    "END:VALARM",
    "END:VEVENT",
  ];
}

export function buildCalendar(tasks, today = todayISO(), stamp = new Date()) {
  const events = tasks.map((t) => taskEvent(t, today, stamp)).filter(Boolean);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//House Upkeep Log//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Home maintenance",
    ...events.flat(),
    "END:VCALENDAR",
  ];
  return { text: lines.map(foldLine).join("\r\n") + "\r\n", count: events.length };
}
