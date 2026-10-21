// Saves tasks and home info on this device (localStorage) and handles backup files.
// Receipt files are kept separately in IndexedDB (see files.js).
import { isValidISO, newEntryId } from "./schedule.js";

const KEY_V1 = "house-upkeep-log:v1";
const KEY = "house-upkeep-log:v2";
export const AREAS = ["HVAC", "Plumbing", "Kitchen", "Appliances", "Safety", "Exterior", "Yard", "Interior", "Other"];

export function newId(prefix = "t") {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const str = (v, max) => String(v ?? "").trim().slice(0, max);

function normalizeEntry(raw) {
  if (typeof raw === "string") raw = { date: raw };
  if (!raw || !isValidISO(raw.date)) return null;
  const cost = raw.cost === "" || raw.cost == null ? null : Number(raw.cost);
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newEntryId(),
    date: raw.date,
    cost: Number.isFinite(cost) && cost >= 0 ? Math.round(cost * 100) / 100 : null,
    note: str(raw.note, 200),
    files: Array.isArray(raw.files) ? raw.files.filter((f) => typeof f === "string").slice(0, 10) : [],
  };
}

/** Clean up one task from storage, an older version, or an imported file. Returns null if unusable. */
export function normalizeTask(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = str(raw.name, 80);
  if (!name) return null;
  const interval = Math.round(Number(raw.intervalDays));
  const month = Math.round(Number(raw.month));

  // v1 kept a list of dates in `history` plus `lastDone`; v2 keeps job entries in `log`.
  let entries = Array.isArray(raw.log) ? raw.log : [...(Array.isArray(raw.history) ? raw.history : []), ...(raw.lastDone ? [raw.lastDone] : [])];
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
    name,
    area: AREAS.includes(raw.area) ? raw.area : "Other",
    schedule: raw.schedule === "seasonal" ? "seasonal" : "interval",
    intervalDays: interval >= 1 && interval <= 3650 ? interval : 30,
    month: month >= 1 && month <= 12 ? month : 10,
    notes: str(raw.notes, 300),
    log,
    snoozedUntil: isValidISO(raw.snoozedUntil) ? raw.snoozedUntil : "",
    sample: Boolean(raw.sample),
  };
}

export function normalizeHomeItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = str(raw.title, 80);
  if (!title) return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newId("h"),
    title,
    details: str(raw.details, 1000),
    warrantyUntil: isValidISO(raw.warrantyUntil) ? raw.warrantyUntil : "",
  };
}

export function load(storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage.getItem(KEY) || "null") || JSON.parse(storage.getItem(KEY_V1) || "null");
    if (!raw) return { tasks: [], home: [], settings: normalizeSettings() };
    return {
      tasks: (Array.isArray(raw.tasks) ? raw.tasks : []).map(normalizeTask).filter(Boolean),
      home: (Array.isArray(raw.home) ? raw.home : []).map(normalizeHomeItem).filter(Boolean),
      settings: normalizeSettings(raw.settings),
    };
  } catch {
    return { tasks: [], home: [], settings: normalizeSettings() };
  }
}

export function normalizeSettings(raw = {}) {
  return { currency: str(raw?.currency, 4) || "$" };
}

export function save({ tasks, home, settings = normalizeSettings() }, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify({ version: 2, savedAt: new Date().toISOString(), tasks, home, settings }));
    return true;
  } catch {
    return false;
  }
}

/** Every receipt file id referenced by any task. */
export function referencedFiles(tasks) {
  const ids = new Set();
  for (const t of tasks) for (const e of t.log) for (const f of e.files) ids.add(f);
  return ids;
}

/** files: [{ id, name, type, data }] where data is base64. */
export function toBackup({ tasks, home, files = [] }) {
  return JSON.stringify({ app: "house-upkeep-log", version: 2, exportedAt: new Date().toISOString(), tasks, home, files });
}

/** Parse a backup file (v1 or v2). Throws an Error with a readable message when the file is wrong. */
export function fromBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a House Upkeep Log backup (it isn't valid JSON).");
  }
  const list = Array.isArray(data) ? data : data?.tasks;
  if (!Array.isArray(list)) throw new Error("That file doesn't contain any tasks.");
  const tasks = list.map(normalizeTask).filter(Boolean);
  const home = (Array.isArray(data?.home) ? data.home : []).map(normalizeHomeItem).filter(Boolean);
  if (!tasks.length && !home.length) throw new Error("No usable tasks were found in that file.");
  const files = (Array.isArray(data?.files) ? data.files : []).filter(
    (f) => f && typeof f.id === "string" && typeof f.data === "string" && typeof f.type === "string"
  );
  return { tasks, home, files };
}
