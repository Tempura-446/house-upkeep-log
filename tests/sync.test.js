import { test } from "node:test";
import assert from "node:assert/strict";
import { rowsToPush, mergeRows, newestStamp } from "../js/sync-core.js";
import { buildReminder, localNow } from "../js/reminders-core.js";
import { normalizeData } from "../js/store.js";

const base = () =>
  normalizeData({
    homes: [{ id: "home", name: "My home", updatedAt: 100 }],
    tasks: [{ id: "t1", homeId: "home", name: "Clean gutters", intervalDays: 30, log: [], updatedAt: 200 }],
    home: [{ id: "h1", homeId: "home", title: "Furnace", updatedAt: 300 }],
    prefs: { soonDays: 7, updatedAt: 50 },
  });

test("rowsToPush sends only records changed since the last push, including deletions and file details", () => {
  const d = { ...base(), deleted: { t9: 400, h7abcdef12: 20, home: 450, pabc1234: 460, habc1234: 470 } };
  const rows = rowsToPush(d, 150, [{ id: "f1", name: "r.jpg", type: "image/jpeg", label: "receipt", updatedAt: 500 }]);
  assert.deepEqual(rows.map((r) => [r.kind, r.id, r.deleted]), [
    ["task", "t1", false], ["info", "h1", false], ["file", "f1", false],
    ["task", "t9", true], ["home", "home", true], ["home", "pabc1234", true], ["info", "habc1234", true],
  ]);
  assert.equal(newestStamp(rows), 500);
  assert.equal(rowsToPush(d, 0).length, 9);
});

test("mergeRows: newer remote rows win, older ones are ignored", () => {
  const d = base();
  const { data, changed } = mergeRows(d, [
    { id: "t1", kind: "task", data: { ...d.tasks[0], name: "Clean gutters (front)" }, updated_at: 250 },
    { id: "h1", kind: "info", data: { ...d.home[0], title: "Old title" }, updated_at: 299 },
    { id: "t2", kind: "task", data: { id: "t2", homeId: "home", name: "New from phone", log: [] }, updated_at: 260 },
  ]);
  assert.ok(changed);
  assert.equal(data.tasks.find((t) => t.id === "t1").name, "Clean gutters (front)");
  assert.equal(data.tasks.find((t) => t.id === "t1").updatedAt, 250);
  assert.equal(data.home[0].title, "Furnace");
  assert.equal(data.tasks.length, 2);
});

test("mergeRows: deletions apply when newer and leave a tombstone; a newer local deletion beats an older remote edit", () => {
  const d = { ...base(), deleted: { t5: 900 } };
  const { data } = mergeRows(d, [
    { id: "t1", kind: "task", data: null, deleted: true, updated_at: 210 },
    { id: "t5", kind: "task", data: { id: "t5", name: "Edited elsewhere" }, updated_at: 800 },
  ]);
  assert.equal(data.tasks.length, 0);
  assert.equal(data.deleted.t1, 210);
  assert.equal(data.deleted.t5, 900);
});

test("mergeRows: prefs merge by time and file rows are reported", () => {
  const { data, files } = mergeRows(base(), [
    { id: "prefs", kind: "prefs", data: { soonDays: 21, currency: "€" }, updated_at: 60 },
    { id: "f1", kind: "file", data: { name: "a.pdf", type: "application/pdf", label: "manual" }, updated_at: 70 },
  ]);
  assert.equal(data.prefs.soonDays, 21);
  assert.equal(data.prefs.currency, "€");
  assert.deepEqual(files, [{ id: "f1", name: "a.pdf", type: "application/pdf", label: "manual", updatedAt: 70 }]);
});

test("merging the same rows twice changes nothing the second time", () => {
  const rows = [{ id: "t1", kind: "task", data: { ...base().tasks[0], name: "X" }, updated_at: 999 }];
  const once = mergeRows(base(), rows);
  const twice = mergeRows(once.data, rows);
  assert.equal(twice.changed, false);
});

/* ---------------- reminders ---------------- */
const TODAY = "2026-10-27";
const task = (id, name, intervalDays, lastDone, homeId = "home") => ({ id, homeId, name, schedule: "interval", intervalDays, log: lastDone ? [{ id: "j" + id, date: lastDone }] : [] });

test("reminder for tasks due today or tomorrow", () => {
  const r = buildReminder({ homes: [{ id: "home", name: "My home" }], tasks: [task("a", "Clean gutters", 30, "2026-09-27"), task("b", "Test detectors", 30, "2026-09-28"), task("c", "Later", 90, "2026-10-01")], prefs: {} }, TODAY);
  assert.equal(r.body, "Clean gutters is due today · Test detectors is due tomorrow");
  assert.equal(r.title, "2 home upkeep tasks need attention");
  assert.equal(r.nag, false);
});

test("overdue tasks remind at most every 3 days; nothing due means no reminder", () => {
  const data = { homes: [], tasks: [task("a", "Flush water heater", 365, "2025-10-01"), task("b", "Never dated", 30, null)], prefs: {} };
  assert.match(buildReminder(data, TODAY).body, /Flush water heater is 26 days late/);
  assert.equal(buildReminder(data, TODAY, "2026-10-25"), null);
  assert.ok(buildReminder(data, TODAY, "2026-10-24"));
  assert.equal(buildReminder({ homes: [], tasks: [task("c", "Later", 90, "2026-10-20")], prefs: {} }, TODAY), null);
});

test("reminders name the home when there are several, and combine due + overdue", () => {
  const data = {
    homes: [{ id: "home", name: "House" }, { id: "p2", name: "Cabin" }],
    tasks: [task("a", "Clean gutters", 30, "2026-09-27"), task("b", "Drain pipes", 30, "2026-08-01", "p2"), task("c", "Check roof", 30, "2026-08-02", "p2")],
    prefs: {},
  };
  assert.equal(buildReminder(data, TODAY).body, "Clean gutters (House) is due today · 2 more overdue");
});

test("localNow converts to the device's time zone", () => {
  const at = new Date("2026-10-27T13:30:00Z");
  assert.deepEqual(localNow("America/New_York", at), { date: "2026-10-27", hour: 9 });
  assert.deepEqual(localNow("Asia/Tokyo", at), { date: "2026-10-27", hour: 22 });
  assert.deepEqual(localNow("Not/AZone", at), { date: "2026-10-27", hour: 13 });
});
