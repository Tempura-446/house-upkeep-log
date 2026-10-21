import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTask, toBackup, fromBackup } from "../js/store.js";

test("normalizeTask fills defaults and drops bad values", () => {
  const t = normalizeTask({ name: "  Clean gutters ", area: "Garage", intervalDays: -5, lastDone: "2026-02-30", history: ["2026-04-18", "nope"] });
  assert.equal(t.name, "Clean gutters");
  assert.equal(t.area, "Other");
  assert.equal(t.intervalDays, 30);
  assert.equal(t.lastDone, "2026-04-18");
  assert.deepEqual(t.history, ["2026-04-18"]);
  assert.ok(t.id);
});

test("normalizeTask rejects tasks without a name", () => {
  assert.equal(normalizeTask({ name: "   " }), null);
  assert.equal(normalizeTask(null), null);
});

test("backups round-trip", () => {
  const tasks = [normalizeTask({ id: "a", name: "Flush water heater", area: "Plumbing", intervalDays: 365, lastDone: "2025-11-15" })];
  assert.deepEqual(fromBackup(toBackup(tasks)), tasks);
});

test("fromBackup explains bad files", () => {
  assert.throws(() => fromBackup("not json"), /isn't valid JSON/);
  assert.throws(() => fromBackup('{"hello":1}'), /doesn't contain any tasks/);
  assert.throws(() => fromBackup('{"tasks":[{"name":""}]}'), /No usable tasks/);
});
