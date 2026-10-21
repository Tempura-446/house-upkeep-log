import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTask, normalizeHomeItem, toBackup, fromBackup, load, save, referencedFiles } from "../js/store.js";

const memoryStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
};

test("v1 tasks (history + lastDone) migrate to job log entries", () => {
  const t = normalizeTask({ id: "a", name: "Clean gutters", area: "Exterior", intervalDays: 182, lastDone: "2026-04-18", history: ["2025-10-20", "2026-04-18", "bad"] });
  assert.deepEqual(t.log.map((e) => e.date), ["2025-10-20", "2026-04-18"]);
  assert.equal(t.schedule, "interval");
  assert.equal(t.snoozedUntil, "");
});

test("load reads v1 storage when there is no v2 data yet", () => {
  const storage = memoryStorage({ "house-upkeep-log:v1": JSON.stringify({ version: 1, tasks: [{ id: "a", name: "Flush water heater", intervalDays: 365, lastDone: "2025-11-15" }] }) });
  const { tasks, home } = load(storage);
  assert.equal(tasks[0].log[0].date, "2025-11-15");
  assert.deepEqual(home, []);
  save({ tasks, home }, storage);
  assert.equal(load(storage).tasks[0].name, "Flush water heater");
});

test("normalizeTask cleans bad values", () => {
  const t = normalizeTask({ name: "  X ", area: "Garage", intervalDays: -5, schedule: "seasonal", month: 13, log: [{ date: "2026-01-01", cost: "-3" }, { date: "2026-01-01", cost: "19.999", note: "parts" }] });
  assert.equal(t.area, "Other");
  assert.equal(t.intervalDays, 30);
  assert.equal(t.month, 10);
  assert.equal(t.log.length, 1); // the bare duplicate date is dropped
  assert.equal(t.log[0].cost, 20);
  assert.equal(normalizeTask({ name: "  " }), null);
});

test("home items keep a warranty date only when valid", () => {
  assert.equal(normalizeHomeItem({ title: "Dishwasher", warrantyUntil: "2027-02-30" }).warrantyUntil, "");
  assert.equal(normalizeHomeItem({ title: "" }), null);
});

test("backups round-trip tasks, home info and files", () => {
  const tasks = [normalizeTask({ id: "a", name: "Service furnace", schedule: "seasonal", month: 9, log: [{ id: "j1", date: "2025-09-12", cost: 129, files: ["f1"] }] })];
  const home = [normalizeHomeItem({ id: "h1", title: "Furnace", details: "Model X" })];
  const files = [{ id: "f1", name: "receipt.jpg", type: "image/jpeg", data: "AAAA" }];
  assert.deepEqual(fromBackup(toBackup({ tasks, home, files })), { tasks, home, files });
  assert.deepEqual([...referencedFiles(tasks)], ["f1"]);
});

test("fromBackup explains bad files", () => {
  assert.throws(() => fromBackup("not json"), /isn't valid JSON/);
  assert.throws(() => fromBackup('{"hello":1}'), /doesn't contain any tasks/);
  assert.throws(() => fromBackup('{"tasks":[{"name":""}]}'), /No usable tasks/);
});
