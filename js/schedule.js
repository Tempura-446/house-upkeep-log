// Pure date and scheduling helpers. No DOM access, so they can be unit tested in Node.
// Dates are local calendar dates in "YYYY-MM-DD" form.
//
// A task repeats in one of two ways:
//   schedule: "interval"  — every `intervalDays` days after it was last done
//   schedule: "seasonal"  — once a year during `month` (1–12), due by the end of that month
// A task's completed jobs live in `log` ([{ id, date, cost, note, files }]); the newest date is "last done".

export const SOON_DAYS = 14;
/** A seasonal job done up to this many days before its month counts for that season. */
export const EARLY_DAYS = 60;

export const PRESETS = [
  [7, "Weekly"],
  [30, "Monthly"],
  [91, "Every 3 months"],
  [182, "Every 6 months"],
  [365, "Yearly"],
  [730, "Every 2 years"],
];

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = MONTHS.map((m) => m.slice(0, 3));
const pad = (n) => String(n).padStart(2, "0");

export function toISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isValidISO(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return toISO(parseISO(s)) === s;
}

export function todayISO(now = new Date()) {
  return toISO(now);
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Whole calendar days from b to a (a - b). Rounds to absorb DST shifts. */
export function diffDays(a, b) {
  return Math.round((parseISO(a) - parseISO(b)) / 86400000);
}

const yearOf = (iso) => Number(iso.slice(0, 4));
export const monthStart = (year, month) => `${year}-${pad(month)}-01`;
export const monthEnd = (year, month) => toISO(new Date(year, month, 0));

export function lastDoneOf(task) {
  const dates = (task.log || []).map((e) => e.date).filter(isValidISO);
  return dates.length ? dates.sort().at(-1) : "";
}

/** Next due date from the schedule alone (ignores snoozing). Null when it can't be known yet. */
export function scheduledDue(task, today = todayISO()) {
  const last = lastDoneOf(task);
  if (task.schedule === "seasonal") {
    const m = Number(task.month) || 1;
    if (last) {
      const y = yearOf(last);
      // Done during (or shortly before) this year's season → next year's season is next.
      const counted = last >= addDays(monthStart(y, m), -EARLY_DAYS);
      return monthEnd(counted ? y + 1 : y, m);
    }
    const y = yearOf(today);
    return today <= monthEnd(y, m) ? monthEnd(y, m) : monthEnd(y + 1, m);
  }
  if (!last) return null;
  return addDays(last, Number(task.intervalDays) || 30);
}

/** Effective due date, honoring a snooze that pushes it later. */
export function nextDue(task, today = todayISO()) {
  const due = scheduledDue(task, today);
  if (!due) return null;
  return isValidISO(task.snoozedUntil) && task.snoozedUntil > due ? task.snoozedUntil : due;
}

/**
 * Where a task stands today.
 * key: "new" (needs a first date), "late" (overdue or due today), "soon", "ok".
 * days: days until due (negative when late), used for sorting.
 */
export function statusOf(task, today = todayISO()) {
  const due = nextDue(task, today);
  if (!due) return { key: "new", days: -Infinity, due: null, snoozed: false, label: "Set last date" };
  const snoozed = due === task.snoozedUntil;
  const d = diffDays(due, today);
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (d < 0) return { key: "late", days: d, due, snoozed, label: `${plural(-d, "day")} late` };
  if (d === 0) return { key: "late", days: 0, due, snoozed, label: "Due today" };

  if (task.schedule === "seasonal" && !snoozed) {
    const m = Number(task.month);
    const inSeason = today >= monthStart(yearOf(due), m);
    if (inSeason || d <= SOON_DAYS) return { key: "soon", days: d, due, snoozed, label: `Due by ${formatShort(due, today)}` };
    const sameYear = yearOf(due) === yearOf(today);
    return { key: "ok", days: d, due, snoozed, label: `Due in ${MON[m - 1]}${sameYear ? "" : " " + yearOf(due)}` };
  }
  if (d <= SOON_DAYS) return { key: "soon", days: d, due, snoozed, label: `Due in ${plural(d, "day")}` };
  return { key: "ok", days: d, due, snoozed, label: `Due ${formatShort(due, today)}` };
}

export function formatShort(iso, today = todayISO()) {
  const d = parseISO(iso);
  const sameYear = d.getFullYear() === parseISO(today).getFullYear();
  return `${MON[d.getMonth()]} ${d.getDate()}${sameYear ? "" : " " + d.getFullYear()}`;
}

export function describeInterval(n) {
  n = Number(n);
  const preset = PRESETS.find((p) => p[0] === n);
  if (preset) return preset[1].toLowerCase();
  if (n % 365 === 0) return `every ${n / 365} years`;
  if (n % 7 === 0) return `every ${n / 7} weeks`;
  return `every ${n} days`;
}

export function describeSchedule(task) {
  if (task.schedule === "seasonal") return `yearly in ${MONTHS[(Number(task.month) || 1) - 1]}`;
  return describeInterval(task.intervalDays);
}

export function newEntryId() {
  return "j" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Record a completed job. Clears any snooze. A bare repeat of an existing date
 * (no cost, note or receipts) is ignored so double taps don't create duplicates.
 */
export function logJob(task, { date, cost = null, note = "", files = [] }) {
  const log = [...(task.log || [])];
  const bare = cost == null && !note && !files.length;
  if (!(bare && log.some((e) => e.date === date))) {
    log.push({ id: newEntryId(), date, cost, note, files });
  }
  log.sort((a, b) => a.date.localeCompare(b.date));
  return { ...task, log: log.slice(-200), snoozedUntil: "", sample: false };
}

export function updateJob(task, id, changes) {
  return { ...task, log: task.log.map((e) => (e.id === id ? { ...e, ...changes } : e)).sort((a, b) => a.date.localeCompare(b.date)) };
}

export function removeJob(task, id) {
  return { ...task, log: task.log.filter((e) => e.id !== id) };
}

export function snooze(task, days, today = todayISO()) {
  const from = nextDue(task, today);
  const base = from && from > today ? from : today;
  return { ...task, snoozedUntil: addDays(base, days) };
}

/** Sum of job costs, optionally limited to one calendar year. */
export function totalCost(tasks, year) {
  let sum = 0;
  for (const t of tasks) for (const e of t.log || []) if (typeof e.cost === "number" && (!year || yearOf(e.date) === year)) sum += e.cost;
  return Math.round(sum * 100) / 100;
}
