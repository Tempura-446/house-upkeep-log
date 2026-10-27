// Decides what a daily reminder should say. Shared by the server job that sends push notifications.
// Pure: give it the user's data and a local date; it returns a message or null.
import { statusOf } from "./schedule.js";

const NAG_EVERY_DAYS = 3;

/**
 * @param data      { homes, tasks, prefs } as stored by the app
 * @param today     "YYYY-MM-DD" in the device's time zone
 * @param lastNagOn "YYYY-MM-DD" when we last reminded about overdue tasks, or null
 * @returns { title, body, tag, nag } or null when there's nothing worth a notification today
 */
export function buildReminder(data, today, lastNagOn = null) {
  const soonDays = data.prefs?.soonDays || 14;
  const homes = new Map((data.homes || []).map((h) => [h.id, h.name]));
  const multiHome = homes.size > 1;
  const rows = (data.tasks || [])
    .map((t) => ({ t, s: statusOf(t, today, soonDays) }))
    .filter((r) => r.s.key !== "new")
    .sort((a, b) => a.s.days - b.s.days);

  const dueNow = rows.filter((r) => r.s.days === 0 || r.s.days === 1); // due today or tomorrow
  const overdue = rows.filter((r) => r.s.days < 0);
  const daysSinceNag = lastNagOn ? Math.round((Date.parse(today) - Date.parse(lastNagOn)) / 86400000) : Infinity;
  const nag = overdue.length > 0 && daysSinceNag >= NAG_EVERY_DAYS;
  if (!dueNow.length && !nag) return null;

  const label = ({ t }) => (multiHome && homes.get(t.homeId) ? `${t.name} (${homes.get(t.homeId)})` : t.name);
  const lines = [];
  for (const r of dueNow) lines.push(`${label(r)} is due ${r.s.days === 0 ? "today" : "tomorrow"}`);
  if (overdue.length) {
    if (dueNow.length) lines.push(`${overdue.length} more overdue`);
    else if (overdue.length === 1) lines.push(`${label(overdue[0])} is ${overdue[0].s.label}`);
    else lines.push(`${label(overdue[0])} and ${overdue.length - 1} more are overdue`);
  }
  const count = dueNow.length + overdue.length;
  return {
    title: count === 1 ? "Home upkeep reminder" : `${count} home upkeep tasks need attention`,
    body: lines.slice(0, 4).join(" · "),
    tag: `upkeep-${today}`,
    nag: overdue.length > 0,
  };
}

/** Local calendar date and hour for a time zone, e.g. { date: "2026-10-27", hour: 8 }. */
export function localNow(timeZone, now = new Date()) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  }
  const get = (t) => parts.find((p) => p.type === t).value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}
