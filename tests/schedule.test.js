import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, diffDays, statusOf, describeInterval, logCompletion, isValidISO, nextDue } from "../js/schedule.js";

const TODAY = "2026-10-21";

test("addDays crosses month and year boundaries", () => {
  assert.equal(addDays("2026-10-21", 14), "2026-11-04");
  assert.equal(addDays("2026-12-25", 10), "2027-01-04");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
});

test("diffDays counts calendar days across DST changes", () => {
  assert.equal(diffDays("2026-11-02", "2026-10-31"), 2);
  assert.equal(diffDays("2026-03-09", "2026-03-07"), 2);
  assert.equal(diffDays("2026-10-20", "2026-10-21"), -1);
});

test("isValidISO rejects impossible dates", () => {
  assert.ok(isValidISO("2026-10-21"));
  assert.ok(!isValidISO("2026-02-30"));
  assert.ok(!isValidISO("10/21/2026"));
  assert.ok(!isValidISO(""));
});

test("a task that was never done needs a start date", () => {
  const s = statusOf({ intervalDays: 30, lastDone: "" }, TODAY);
  assert.equal(s.key, "new");
  assert.equal(nextDue({ intervalDays: 30 }), null);
});

test("status buckets: late, due today, soon, ok", () => {
  assert.deepEqual(
    [
      statusOf({ intervalDays: 91, lastDone: "2026-07-10" }, TODAY).key, // due Oct 9
      statusOf({ intervalDays: 30, lastDone: "2026-09-21" }, TODAY).key, // due today
      statusOf({ intervalDays: 30, lastDone: "2026-10-05" }, TODAY).key, // due Nov 4 (14 days)
      statusOf({ intervalDays: 30, lastDone: "2026-10-06" }, TODAY).key, // due Nov 5 (15 days)
    ],
    ["late", "late", "soon", "ok"]
  );
});

test("labels read naturally", () => {
  assert.equal(statusOf({ intervalDays: 30, lastDone: "2026-09-20" }, TODAY).label, "1 day late");
  assert.equal(statusOf({ intervalDays: 30, lastDone: "2026-09-21" }, TODAY).label, "Due today");
  assert.equal(statusOf({ intervalDays: 30, lastDone: "2026-09-22" }, TODAY).label, "Due in 1 day");
  assert.equal(statusOf({ intervalDays: 365, lastDone: "2026-02-20" }, TODAY).label, "Due Feb 20 2027");
});

test("describeInterval", () => {
  assert.equal(describeInterval(91), "every 3 months");
  assert.equal(describeInterval(14), "every 2 weeks");
  assert.equal(describeInterval(1095), "every 3 years");
  assert.equal(describeInterval(10), "every 10 days");
});

test("logCompletion keeps history unique and sorted, and clears the example flag", () => {
  const t = { lastDone: "2026-07-10", history: ["2026-04-08", "2026-07-10"], sample: true };
  const done = logCompletion(t, TODAY);
  assert.equal(done.lastDone, TODAY);
  assert.deepEqual(done.history, ["2026-04-08", "2026-07-10", TODAY]);
  assert.equal(done.sample, false);
  assert.deepEqual(logCompletion(done, TODAY).history, done.history);
});
