import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCalendar, taskEvent, foldLine } from "../js/ics.js";

const TODAY = "2026-10-21";
const STAMP = new Date("2026-10-21T12:00:00Z");
const log = (...dates) => dates.map((date, i) => ({ id: "e" + i, date, cost: null, note: "", files: [] }));

test("interval task becomes a repeating all-day event with a 9am alert", () => {
  const ev = taskEvent({ id: "t1", name: "Replace HVAC air filter", schedule: "interval", intervalDays: 91, log: log("2026-10-01"), notes: "16x25x1" }, TODAY, STAMP).join("\n");
  assert.match(ev, /DTSTART;VALUE=DATE:20261231/);
  assert.match(ev, /RRULE:FREQ=WEEKLY;INTERVAL=13/);
  assert.match(ev, /TRIGGER;RELATED=START:PT9H/);
  assert.match(ev, /UID:t1@house-upkeep-log/);
});

test("overdue tasks get their reminder today, not in the past", () => {
  const ev = taskEvent({ id: "t2", name: "Clean gutters", schedule: "interval", intervalDays: 30, log: log("2026-08-01") }, TODAY, STAMP).join("\n");
  assert.match(ev, /DTSTART;VALUE=DATE:20261021/);
  assert.match(ev, /FREQ=DAILY;INTERVAL=30/);
});

test("seasonal tasks remind on the 1st of their month each year", () => {
  const ev = taskEvent({ id: "t3", name: "Service AC", schedule: "seasonal", month: 4, intervalDays: 365, log: [] }, TODAY, STAMP).join("\n");
  assert.match(ev, /DTSTART;VALUE=DATE:20270401/);
  assert.match(ev, /RRULE:FREQ=YEARLY/);
});

test("tasks without a due date are skipped; text is escaped and lines folded", () => {
  const { text, count } = buildCalendar(
    [
      { id: "a", name: "Never done", schedule: "interval", intervalDays: 30, log: [] },
      { id: "b", name: "Filters; vents, and more", schedule: "interval", intervalDays: 30, log: log("2026-10-20"), notes: "x".repeat(200) },
    ],
    TODAY,
    STAMP
  );
  assert.equal(count, 1);
  assert.match(text, /SUMMARY:Filters\\; vents\\, and more/);
  assert.ok(text.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75));
  assert.ok(text.startsWith("BEGIN:VCALENDAR\r\n") && text.endsWith("END:VCALENDAR\r\n"));
  assert.equal(foldLine("short"), "short");
});
