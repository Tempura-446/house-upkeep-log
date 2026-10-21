// Pure date and scheduling helpers. No DOM access, so they can be unit tested in Node.
// Dates are stored as local calendar dates in "YYYY-MM-DD" form.

export const SOON_DAYS = 14;

export const PRESETS = [
  [7, "Weekly"],
  [30, "Monthly"],
  [91, "Every 3 months"],
  [182, "Every 6 months"],
  [365, "Yearly"],
  [730, "Every 2 years"],
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
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

export function nextDue(task) {
  if (!task.lastDone) return null;
  return addDays(task.lastDone, Number(task.intervalDays) || 30);
}

/**
 * Where a task stands today.
 * key: "new" (never logged), "late" (overdue or due today), "soon" (within SOON_DAYS), "ok".
 * days: days until due (negative when late). Used for sorting.
 */
export function statusOf(task, today = todayISO()) {
  const due = nextDue(task);
  if (!due) return { key: "new", days: -Infinity, due: null, label: "Set last date" };
  const d = diffDays(due, today);
  if (d < 0) return { key: "late", days: d, due, label: `${-d} ${d === -1 ? "day" : "days"} late` };
  if (d === 0) return { key: "late", days: 0, due, label: "Due today" };
  if (d <= SOON_DAYS) return { key: "soon", days: d, due, label: `Due in ${d} ${d === 1 ? "day" : "days"}` };
  return { key: "ok", days: d, due, label: `Due ${formatShort(due, today)}` };
}

export function formatShort(iso, today = todayISO()) {
  const d = parseISO(iso);
  const sameYear = d.getFullYear() === parseISO(today).getFullYear();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${sameYear ? "" : " " + d.getFullYear()}`;
}

export function describeInterval(n) {
  n = Number(n);
  const preset = PRESETS.find((p) => p[0] === n);
  if (preset) return preset[1].toLowerCase();
  if (n % 365 === 0) return `every ${n / 365} years`;
  if (n % 7 === 0) return `every ${n / 7} weeks`;
  return `every ${n} days`;
}

/** Add a completion date to a task, keeping history sorted, unique and capped. */
export function logCompletion(task, date) {
  const history = [...new Set([...(task.history || []), date])].sort().slice(-100);
  const lastDone = history[history.length - 1];
  return { ...task, lastDone, history, sample: false };
}
