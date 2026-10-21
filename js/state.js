// The app's data in memory, and the only place that writes it to the device.
import { load, save } from "./store.js";
import { requestPersistence } from "./files.js";

const initial = load();

export const state = {
  tasks: new Map(initial.tasks.map((t) => [t.id, t])),
  home: new Map(initial.home.map((h) => [h.id, h])),
  settings: initial.settings,
  view: "tasks", // "tasks" | "history" | "home"
  area: "All",
};

const listeners = new Set();
/** Subscribe to data changes. Returns an unsubscribe function. */
export const onChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
let asked = false;
let saveFailed = null;
export const onSaveFailed = (fn) => (saveFailed = fn);

export function commit() {
  const ok = save({ tasks: [...state.tasks.values()], home: [...state.home.values()], settings: state.settings });
  if (!ok) saveFailed?.();
  if (ok && !asked && (state.tasks.size || state.home.size)) {
    asked = true;
    requestPersistence();
  }
  listeners.forEach((fn) => fn());
}

export function putTask(task) {
  state.tasks.set(task.id, task);
  commit();
}
export function removeTask(id) {
  state.tasks.delete(id);
  commit();
}
export function putHome(item) {
  state.home.set(item.id, item);
  commit();
}
export function removeHome(id) {
  state.home.delete(id);
  commit();
}
export function setSettings(changes) {
  state.settings = { ...state.settings, ...changes };
  commit();
}

/** Reload from storage (another tab changed the data). */
export function reload() {
  const fresh = load();
  state.tasks = new Map(fresh.tasks.map((t) => [t.id, t]));
  state.home = new Map(fresh.home.map((h) => [h.id, h]));
  state.settings = fresh.settings;
  listeners.forEach((fn) => fn());
}
