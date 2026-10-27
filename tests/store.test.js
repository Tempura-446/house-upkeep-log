import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTask, normalizeHomeItem, normalizeData, normalizePrefs, toBackup, fromBackup, load, save,
  referencedFiles, jobsToCSV, spendingByYear, DEFAULT_HOME_ID,
} from "../js/store.js";

const memoryStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), raw: m };
};

test("v1 tasks (history + lastDone) migrate to job log entries", () => {
  const t = normalizeTask({ id: "a", name: "Clean gutters", area: "Exterior", intervalDays: 182, lastDone: "2026-04-18", history: ["2025-10-20", "2026-04-18", "bad"] });
  assert.deepEqual(t.log.map((e) => e.date), ["2025-10-20", "2026-04-18"]);
  assert.equal(t.schedule, "interval");
});

test("v1 storage migrates all the way to v3 with a default home", () => {
  const storage = memoryStorage({ "house-upkeep-log:v1": JSON.stringify({ version: 1, tasks: [{ id: "a", name: "Flush water heater", intervalDays: 365, lastDone: "2025-11-15" }] }) });
  const d = load(storage);
  assert.equal(d.homes.length, 1);
  assert.equal(d.homes[0].id, DEFAULT_HOME_ID);
  assert.equal(d.tasks[0].homeId, DEFAULT_HOME_ID);
  assert.equal(d.local.currentHomeId, DEFAULT_HOME_ID);
  assert.equal(d.prefs.soonDays, 14);
  save(d, storage);
  assert.ok(storage.raw.has("house-upkeep-log:v3"));
  assert.equal(load(storage).tasks[0].log[0].date, "2025-11-15");
});

test("v2 storage keeps settings as prefs and Home info items", () => {
  const storage = memoryStorage({
    "house-upkeep-log:v2": JSON.stringify({ version: 2, tasks: [], home: [{ id: "h1", title: "Furnace", details: "Model X" }], settings: { currency: "€" } }),
  });
  const d = load(storage);
  assert.equal(d.prefs.currency, "€");
  assert.equal(d.home[0].homeId, DEFAULT_HOME_ID);
  assert.deepEqual(d.home[0].files, []);
});

test("items pointing at a missing home move to the first home", () => {
  const d = normalizeData({ homes: [{ id: "p1", name: "Cabin" }], tasks: [{ id: "a", name: "X", homeId: "gone" }], local: { currentHomeId: "gone" } });
  assert.equal(d.tasks[0].homeId, "p1");
  assert.equal(d.local.currentHomeId, "p1");
});

test("normalizeTask and prefs clean bad values", () => {
  const t = normalizeTask({ name: "  X ", area: "Garage", intervalDays: -5, schedule: "seasonal", month: 13, log: [{ date: "2026-01-01", cost: "-3" }, { date: "2026-01-01", cost: "19.999", note: "parts" }] });
  assert.equal(t.area, "Other");
  assert.equal(t.intervalDays, 30);
  assert.equal(t.month, 10);
  assert.equal(t.log.length, 1);
  assert.equal(t.log[0].cost, 20);
  assert.equal(normalizeTask({ name: "  " }), null);
  assert.deepEqual({ ...normalizePrefs({ soonDays: 999, notifyHour: 25, currency: "" }), updatedAt: 0 }, { currency: "$", soonDays: 14, notifyHour: 8, updatedAt: 0 });
});

test("home items keep a warranty date only when valid, and their attachments", () => {
  assert.equal(normalizeHomeItem({ title: "Dishwasher", warrantyUntil: "2027-02-30" }).warrantyUntil, "");
  assert.deepEqual(normalizeHomeItem({ title: "Dishwasher", files: ["f1", 3, ""] }).files, ["f1"]);
  assert.equal(normalizeHomeItem({ title: "" }), null);
});

test("backups round-trip homes, tasks, home info, prefs and files", () => {
  const d = normalizeData({
    homes: [{ id: "p1", name: "House" }],
    tasks: [{ id: "a", homeId: "p1", name: "Service furnace", schedule: "seasonal", month: 9, log: [{ id: "j1", date: "2025-09-12", cost: 129, files: ["f1"] }] }],
    home: [{ id: "h1", homeId: "p1", title: "Furnace", details: "Model X", files: ["f2"] }],
    prefs: { currency: "£", soonDays: 7 },
  });
  const files = [{ id: "f1", name: "receipt.jpg", type: "image/jpeg", label: "receipt", data: "AAAA" }];
  const back = fromBackup(toBackup({ ...d, files }));
  assert.deepEqual(back.tasks, d.tasks);
  assert.deepEqual(back.home, d.home);
  assert.deepEqual(back.homes, d.homes);
  assert.equal(back.prefs.soonDays, 7);
  assert.deepEqual(back.files, files);
  assert.deepEqual([...referencedFiles(d.tasks, d.home)].sort(), ["f1", "f2"]);
});

test("fromBackup reads v2 files and explains bad ones", () => {
  const v2 = fromBackup(JSON.stringify({ version: 2, tasks: [{ id: "a", name: "X", log: [] }], home: [], files: [] }));
  assert.equal(v2.tasks[0].homeId, DEFAULT_HOME_ID);
  assert.throws(() => fromBackup("not json"), /isn't valid JSON/);
  assert.throws(() => fromBackup('{"hello":1}'), /doesn't contain any tasks/);
  assert.throws(() => fromBackup('{"tasks":[{"name":""}]}'), /No usable tasks/);
});

test("CSV export lists jobs by date, quotes text and defuses formulas", () => {
  const tasks = [
    normalizeTask({ id: "a", homeId: "p1", name: "Clean gutters", area: "Exterior", log: [{ id: "j2", date: "2026-04-18", cost: 180, note: "Gutter Pros, two stories" }] }),
    normalizeTask({ id: "b", homeId: "p1", name: "=HYPERLINK(1)", area: "Other", log: [{ id: "j1", date: "2026-01-02" }] }),
  ];
  const csv = jobsToCSV(tasks, [{ id: "p1", name: "House" }]).split("\r\n");
  assert.equal(csv[0], "Date,Task,Area,Home,Cost,Notes,Attachments");
  assert.equal(csv[1], `2026-01-02,"'=HYPERLINK(1)",Other,House,,,`);
  assert.equal(csv[2], `2026-04-18,Clean gutters,Exterior,House,180,"Gutter Pros, two stories",`);
});

test("spendingByYear totals by year and area, newest first", () => {
  const tasks = [
    { area: "HVAC", log: [{ date: "2026-01-02", cost: 10 }, { date: "2025-06-01", cost: 100 }] },
    { area: "Exterior", log: [{ date: "2026-05-02", cost: 180 }, { date: "2026-06-01", cost: null }] },
    { area: "HVAC", log: [{ date: "2026-08-02", cost: 5.255 }] },
  ];
  const s = spendingByYear(tasks);
  assert.deepEqual(s.map((y) => y.year), [2026, 2025]);
  assert.equal(s[0].total, 195.26);
  assert.deepEqual(s[0].areas.map((a) => a.area), ["Exterior", "HVAC"]);
});
