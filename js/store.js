// Saves tasks on this device (localStorage) and handles backup files.
import { isValidISO } from "./schedule.js";

const KEY = "house-upkeep-log:v1";
export const AREAS = ["HVAC", "Plumbing", "Kitchen", "Appliances", "Safety", "Exterior", "Yard", "Interior", "Other"];

export function newId() {
  return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Clean up one task from storage or an imported file. Returns null if unusable. */
export function normalizeTask(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name ?? "").trim().slice(0, 80);
  if (!name) return null;
  const interval = Math.round(Number(raw.intervalDays));
  const history = Array.isArray(raw.history) ? raw.history.filter(isValidISO) : [];
  const lastDone = isValidISO(raw.lastDone) ? raw.lastDone : history.at(-1) || "";
  if (lastDone && !history.includes(lastDone)) history.push(lastDone);
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newId(),
    name,
    area: AREAS.includes(raw.area) ? raw.area : "Other",
    intervalDays: interval >= 1 && interval <= 3650 ? interval : 30,
    lastDone,
    notes: String(raw.notes ?? "").slice(0, 300),
    history: [...new Set(history)].sort().slice(-100),
    sample: Boolean(raw.sample),
  };
}

export function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!raw || !Array.isArray(raw.tasks)) return [];
    return raw.tasks.map(normalizeTask).filter(Boolean);
  } catch {
    return [];
  }
}

export function save(tasks) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), tasks }));
    return true;
  } catch {
    return false;
  }
}

export function toBackup(tasks) {
  return JSON.stringify({ app: "house-upkeep-log", version: 1, exportedAt: new Date().toISOString(), tasks }, null, 2);
}

/** Parse a backup file. Throws an Error with a readable message when the file is wrong. */
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
  if (!tasks.length) throw new Error("No usable tasks were found in that file.");
  return tasks;
}
