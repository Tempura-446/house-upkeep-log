import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays, diffDays, statusOf, describeInterval, describeSchedule, logJob, removeJob, isValidISO,
  nextDue, scheduledDue, lastDoneOf, snooze, totalCost, monthEnd,
} from "../js/schedule.js";

const TODAY = "2026-10-21";
const every = (intervalDays, ...dates) => ({ schedule: "interval", intervalDays, log: dates.map((date, i) => ({ id: "e" + i, date, cost: null, note: "", files: [] })) });
const yearly = (month, ...dates) => ({ ...every(365, ...dates), schedule: "seasonal", month });

test("addDays and monthEnd cross month, year and leap boundaries", () => {
  assert.equal(addDays("2026-10-21", 14), "2026-11-04");
  assert.equal(addDays("2026-12-25", 10), "2027-01-04");
  assert.equal(monthEnd(2028, 2), "2028-02-29");
  assert.equal(monthEnd(2026, 10), "2026-10-31");
});

test("diffDays counts calendar days across DST changes", () => {
  assert.equal(diffDays("2026-11-02", "2026-10-31"), 2);
  assert.equal(diffDays("2026-03-09", "2026-03-07"), 2);
});

test("isValidISO rejects impossible dates", () => {
  assert.ok(isValidISO("2026-10-21"));
  assert.ok(!isValidISO("2026-02-30"));
  assert.ok(!isValidISO("10/21/2026"));
});

test("interval: never done needs a start date; last done is the newest log entry", () => {
  assert.equal(statusOf(every(30), TODAY).key, "new");
  assert.equal(lastDoneOf(every(30, "2026-09-01", "2026-07-01")), "2026-09-01");
  assert.equal(nextDue(every(30, "2026-09-01")), "2026-10-01");
});

test("interval status buckets and labels", () => {
  assert.equal(statusOf(every(30, "2026-09-20"), TODAY).label, "1 day late");
  assert.equal(statusOf(every(30, "2026-09-21"), TODAY).label, "Due today");
  assert.equal(statusOf(every(30, "2026-10-05"), TODAY).key, "soon");
  assert.equal(statusOf(every(30, "2026-10-06"), TODAY).key, "ok");
  assert.equal(statusOf(every(365, "2026-02-20"), TODAY).label, "Due Feb 20 2027");
});

test("seasonal: schedules without a start date, due by the end of the month", () => {
  assert.equal(scheduledDue(yearly(10), TODAY), "2026-10-31"); // in season now
  assert.equal(statusOf(yearly(10), TODAY).key, "soon");
  assert.equal(statusOf(yearly(10), TODAY).label, "Due by Oct 31");
  assert.equal(scheduledDue(yearly(4), TODAY), "2027-04-30");
  assert.equal(statusOf(yearly(4), TODAY).label, "Due in Apr 2027");
  assert.equal(scheduledDue(yearly(9), TODAY), "2027-09-30"); // this year's season passed
});

test("seasonal: a job done in or shortly before the season counts for that year", () => {
  assert.equal(scheduledDue(yearly(10, "2026-10-03"), TODAY), "2027-10-31");
  assert.equal(scheduledDue(yearly(10, "2026-09-10"), TODAY), "2027-10-31"); // done a bit early
  assert.equal(scheduledDue(yearly(10, "2026-03-10"), TODAY), "2026-10-31"); // spring doesn't count
  assert.equal(statusOf(yearly(10, "2025-10-12"), TODAY).key, "soon");
  assert.equal(statusOf(yearly(9, "2025-09-12"), TODAY).label, "21 days late");
});

test("snooze pushes the due date later and logging a job clears it", () => {
  const late = every(30, "2026-09-01"); // due Oct 1, overdue
  const s = snooze(late, 7, TODAY);
  assert.equal(s.snoozedUntil, "2026-10-28");
  assert.equal(statusOf(s, TODAY).label, "Due in 7 days");
  assert.ok(statusOf(s, TODAY).snoozed);
  const upcoming = snooze(every(30, "2026-10-15"), 7, TODAY); // due Nov 14 → Nov 21
  assert.equal(upcoming.snoozedUntil, "2026-11-21");
  assert.equal(logJob(s, { date: TODAY }).snoozedUntil, "");
});

test("logJob ignores a bare repeat of the same date but keeps entries with details", () => {
  let t = logJob(every(30), { date: TODAY });
  t = logJob(t, { date: TODAY });
  assert.equal(t.log.length, 1);
  t = logJob(t, { date: TODAY, cost: 42.5, note: "Filters x2" });
  assert.equal(t.log.length, 2);
  t = removeJob(t, t.log[0].id);
  assert.equal(t.log.length, 1);
});

test("totalCost sums by year", () => {
  const t = { log: [{ date: "2026-01-02", cost: 10 }, { date: "2026-05-02", cost: 5.25 }, { date: "2025-12-31", cost: 100 }, { date: "2026-06-01", cost: null }] };
  assert.equal(totalCost([t], 2026), 15.25);
  assert.equal(totalCost([t]), 115.25);
});

test("describe schedules", () => {
  assert.equal(describeInterval(91), "every 3 months");
  assert.equal(describeInterval(14), "every 2 weeks");
  assert.equal(describeSchedule(yearly(10)), "yearly in October");
});
