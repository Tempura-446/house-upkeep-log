// The app's data format, migration from older versions, and backup files.
// Pure apart from load()/save(), which take a storage object (localStorage in the app).
//
// Version 3 shape:
//   homes:  [{ id, name, updatedAt }]
//   tasks:  [{ id, homeId, name, area, schedule, intervalDays, month, notes, log, snoozedUntil, sample, updatedAt }]
//   home:   [{ id, homeId, title, details, warrantyUntil, files, updatedAt }]       ("Home info" items)
//   prefs:  { currency, soonDays, notifyHour, updatedAt }                          (synced between devices)
//   local:  { currentHomeId, lastBackupAt, backupNudgeAt, ... }                    (this device only)
//   deleted:{ [id]: deletedAt }                                                     (so deletions can sync)
import { isValidISO, newEntryId, SOON_DAYS } from "./schedule.js";

const KEY_V1 = "house-upkeep-log:v1";
const KEY_V2 = "house-upkeep-log:v2";
const KEY = "house-upkeep-log:v3";
export const AREAS = ["HVAC", "Plumbing", "Kitchen", "Appliances", "Safety", "Exterior", "Yard", "Interior", "Other"];
export const FILE_LABELS = { receipt: "Receipt", before: "Before", after: "After", photo: "Photo", manual: "Manual", warranty: "Warranty" };

export function newId(prefix = "t") {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const str = (v, max) => String(v ?? "").trim().slice(0, max);
const stamp = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0);
const fileIds = (v) => (Array.isArray(v) ? v.filter((f) => typeof f === "string" && f).slice(0, 20) : []);

function normalizeEntry(raw) {
  if (typeof raw === "string") raw = { date: raw };
  if (!raw || !isValidISO(raw.date)) return null;
  const cost = raw.cost === "" || raw.cost == null ? null : Number(raw.cost);
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newEntryId(),
    date: raw.date,
    cost: Number.isFinite(cost) && cost >= 0 ? Math.round(cost * 100) / 100 : null,
    note: str(raw.note, 200),
    files: fileIds(raw.files),
  };
}

/** Clean up one task from storage, an older version, an imported file or another device. Returns null if unusable. */
export function normalizeTask(raw, defaultHomeId = "") {
  if (!raw || typeof raw !== "object") return null;
  const name = str(raw.name, 80);
  if (!name) return null;
  const interval = Math.round(Number(raw.intervalDays));
  const month = Math.round(Number(raw.month));

  // v1 kept a list of dates in `history` plus `lastDone`; v2+ keeps job entries in `log`.
  const entries = Array.isArray(raw.log) ? raw.log : [...(Array.isArray(raw.history) ? raw.history : []), ...(raw.lastDone ? [raw.lastDone] : [])];
  // Drop duplicate ids, and bare date-only entries that repeat a date already logged.
  const isBare = (e) => e.cost == null && !e.note && !e.files.length;
  const all = entries.map(normalizeEntry).filter(Boolean);
  const richDates = new Set(all.filter((e) => !isBare(e)).map((e) => e.date));
  const ids = new Set(), bareDates = new Set();
  const log = all
    .filter((e) => {
      if (ids.has(e.id)) return false;
      if (isBare(e)) {
        if (richDates.has(e.date) || bareDates.has(e.date)) return false;
        bareDates.add(e.date);
      }
      ids.add(e.id);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-200);

  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newId(),
    homeId: typeof raw.homeId === "string" && raw.homeId ? raw.homeId : defaultHomeId,
    name,
    area: AREAS.includes(raw.area) ? raw.area : "Other",
    schedule: raw.schedule === "seasonal" ? "seasonal" : "interval",
    intervalDays: interval >= 1 && interval <= 3650 ? interval : 30,
    month: month >= 1 && month <= 12 ? month : 10,
    notes: str(raw.notes, 300),
    log,
    snoozedUntil: isValidISO(raw.snoozedUntil) ? raw.snoozedUntil : "",
    sample: Boolean(raw.sample),
    updatedAt: stamp(raw.updatedAt),
  };
}

export function normalizeHomeItem(raw, defaultHomeId = "") {
  if (!raw || typeof raw !== "object") return null;
  const title = str(raw.title, 80);
  if (!title) return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newId("h"),
    homeId: typeof raw.homeId === "string" && raw.homeId ? raw.homeId : defaultHomeId,
    title,
    details: str(raw.details, 1000),
    warrantyUntil: isValidISO(raw.warrantyUntil) ? raw.warrantyUntil : "",
    files: fileIds(raw.files),
    updatedAt: stamp(raw.updatedAt),
  };
}

export function normalizeHome(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = str(raw.name, 40);
  if (!name || typeof raw.id !== "string" || !raw.id) return null;
  return { id: raw.id, name, updatedAt: stamp(raw.updatedAt) };
}

export function normalizePrefs(raw = {}) {
  const soon = Math.round(Number(raw?.soonDays));
  const hour = Math.round(Number(raw?.notifyHour));
  return {
    currency: str(raw?.currency, 4) || "$",
    soonDays: soon >= 1 && soon <= 60 ? soon : SOON_DAYS,
    notifyHour: hour >= 0 && hour <= 23 ? hour : 8,
    updatedAt: stamp(raw?.updatedAt),
  };
}

export function normalizeLocal(raw = {}) {
  return {
    currentHomeId: typeof raw?.currentHomeId === "string" ? raw.currentHomeId : "",
    lastBackupAt: stamp(raw?.lastBackupAt),
    backupNudgeAt: stamp(raw?.backupNudgeAt),
    firstUseAt: stamp(raw?.firstUseAt),
  };
}

export const DEFAULT_HOME_ID = "home";

/** Build a complete, valid v3 data object from anything older or partial. */
export function normalizeData(raw = {}) {
  let homes = (Array.isArray(raw.homes) ? raw.homes : []).map(normalizeHome).filter(Boolean);
  if (!homes.length) homes = [{ id: DEFAULT_HOME_ID, name: "My home", updatedAt: 0 }];
  const homeIds = new Set(homes.map((h) => h.id));
  const fallback = homes[0].id;
  const fixHome = (x) => (homeIds.has(x.homeId) ? x : { ...x, homeId: fallback });

  const local = normalizeLocal(raw.local);
  if (!homeIds.has(local.currentHomeId)) local.currentHomeId = fallback;

  const deleted = {};
  if (raw.deleted && typeof raw.deleted === "object") for (const [k, v] of Object.entries(raw.deleted)) if (stamp(v)) deleted[k] = stamp(v);

  return {
    homes,
    tasks: (Array.isArray(raw.tasks) ? raw.tasks : []).map((t) => normalizeTask(t, fallback)).filter(Boolean).map(fixHome),
    home: (Array.isArray(raw.home) ? raw.home : []).map((h) => normalizeHomeItem(h, fallback)).filter(Boolean).map(fixHome),
    prefs: normalizePrefs(raw.prefs || raw.settings),
    local,
    deleted,
  };
}

export function load(storage = globalThis.localStorage) {
  try {
    const raw =
      JSON.parse(storage.getItem(KEY) || "null") ||
      JSON.parse(storage.getItem(KEY_V2) || "null") ||
      JSON.parse(storage.getItem(KEY_V1) || "null") ||
      {};
    return normalizeData(raw);
  } catch {
    return normalizeData({});
  }
}

export function save(data, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify({ version: 3, savedAt: Date.now(), ...data }));
    return true;
  } catch {
    return false;
  }
}

/** Every attachment id referenced by any task job or Home info item. */
export function referencedFiles(tasks, homeItems = []) {
  const ids = new Set();
  for (const t of tasks) for (const e of t.log) for (const f of e.files) ids.add(f);
  for (const h of homeItems) for (const f of h.files || []) ids.add(f);
  return ids;
}

/** files: [{ id, name, type, label, data }] where data is base64. */
export function toBackup({ homes, tasks, home, prefs, files = [] }) {
  return JSON.stringify({ app: "house-upkeep-log", version: 3, exportedAt: new Date().toISOString(), homes, tasks, home, prefs, files });
}

/** Parse a backup file (v1, v2 or v3). Throws an Error with a readable message when the file is wrong. */
export function fromBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a House Upkeep Log backup (it isn't valid JSON).");
  }
  const list = Array.isArray(data) ? data : data?.tasks;
  if (!Array.isArray(list)) throw new Error("That file doesn't contain any tasks.");
  const norm = normalizeData(Array.isArray(data) ? { tasks: data } : data);
  if (!norm.tasks.length && !norm.home.length) throw new Error("No usable tasks were found in that file.");
  const files = (Array.isArray(data?.files) ? data.files : []).filter(
    (f) => f && typeof f.id === "string" && typeof f.data === "string" && typeof f.type === "string"
  );
  return { homes: norm.homes, tasks: norm.tasks, home: norm.home, prefs: data?.prefs || data?.settings ? norm.prefs : null, files };
}

/* ---------------- CSV export ---------------- */
const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s;
};

/** One row per logged job. Cells starting with = + - @ are neutralized so spreadsheets don't run them as formulas. */
export function jobsToCSV(tasks, homes = []) {
  const homeName = new Map(homes.map((h) => [h.id, h.name]));
  const rows = [["Date", "Task", "Area", "Home", "Cost", "Notes", "Attachments"]];
  const jobs = [];
  for (const t of tasks) for (const e of t.log) jobs.push([e.date, t.name, t.area, homeName.get(t.homeId) || "", e.cost ?? "", e.note, e.files.length || ""]);
  jobs.sort((a, b) => a[0].localeCompare(b[0]));
  return [...rows, ...jobs].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/* ---------------- spending ---------------- */
/** Spending grouped by year, then by area: [{ year, total, areas: [{ area, total }] }], newest year first. */
export function spendingByYear(tasks) {
  const years = new Map();
  for (const t of tasks)
    for (const e of t.log) {
      if (typeof e.cost !== "number" || !e.cost) continue;
      const y = Number(e.date.slice(0, 4));
      if (!years.has(y)) years.set(y, new Map());
      const areas = years.get(y);
      areas.set(t.area, (areas.get(t.area) || 0) + e.cost);
    }
  const r2 = (n) => Math.round(n * 100) / 100;
  return [...years.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, areas]) => {
      const list = [...areas.entries()].map(([area, total]) => ({ area, total: r2(total) })).sort((a, b) => b.total - a.total);
      return { year, total: r2(list.reduce((n, a) => n + a.total, 0)), areas: list };
    });
}
