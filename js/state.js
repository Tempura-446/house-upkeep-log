// The app's data in memory, and the only place that writes it to the device.
// Every change stamps the record's updatedAt and deletions leave a tombstone, so devices can sync.
import { load, save, normalizeData, newId } from "./store.js";
import { requestPersistence } from "./files.js";

const toMaps = (d) => ({
  homes: new Map(d.homes.map((h) => [h.id, h])),
  tasks: new Map(d.tasks.map((t) => [t.id, t])),
  home: new Map(d.home.map((h) => [h.id, h])),
  prefs: d.prefs,
  local: d.local,
  deleted: d.deleted,
});

const initial = load();
if (!initial.local.firstUseAt) initial.local.firstUseAt = Date.now();

export const state = {
  ...toMaps(initial),
  view: "tasks", // "tasks" | "history" | "home"
  area: "All",
  query: "",
};

/** Everything that would be saved or synced. */
export function snapshot() {
  return {
    homes: [...state.homes.values()],
    tasks: [...state.tasks.values()],
    home: [...state.home.values()],
    prefs: state.prefs,
    local: state.local,
    deleted: state.deleted,
  };
}

/* ---------- current home ---------- */
export const currentHomeId = () => state.local.currentHomeId;
export const currentHome = () => state.homes.get(state.local.currentHomeId) || [...state.homes.values()][0];
export const homeTasks = () => [...state.tasks.values()].filter((t) => t.homeId === currentHomeId());
export const homeInfoItems = () => [...state.home.values()].filter((h) => h.homeId === currentHomeId());

/* ---------- change notification ---------- */
const listeners = new Set();
/** Subscribe to data changes. Returns an unsubscribe function. */
export const onChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const syncListeners = new Set();
/** Called after a local edit that other devices should get (not after applying synced data). */
export const onLocalEdit = (fn) => syncListeners.add(fn);

let asked = false;
let saveFailed = null;
export const onSaveFailed = (fn) => (saveFailed = fn);

export function commit({ local = false } = {}) {
  const ok = save(snapshot());
  if (!ok) saveFailed?.();
  if (ok && !asked && (state.tasks.size || state.home.size)) {
    asked = true;
    requestPersistence();
  }
  listeners.forEach((fn) => fn());
  if (!local) syncListeners.forEach((fn) => fn());
}

const now = () => Date.now();
const touch = (x) => ({ ...x, updatedAt: Math.max(now(), (x.updatedAt || 0) + 1) });
function tombstone(id) {
  state.deleted = { ...state.deleted, [id]: now() };
}
function unTombstone(id) {
  if (state.deleted[id]) {
    const { [id]: _, ...rest } = state.deleted;
    state.deleted = rest;
  }
}

/* ---------- tasks ---------- */
export function putTask(task) {
  unTombstone(task.id);
  state.tasks.set(task.id, touch({ ...task, homeId: task.homeId || currentHomeId() }));
  commit();
}
/** Add several tasks at once (one save). */
export function putTasks(tasks) {
  for (const t of tasks) {
    unTombstone(t.id);
    state.tasks.set(t.id, touch({ ...t, homeId: t.homeId || currentHomeId() }));
  }
  commit();
}
export function removeTask(id) {
  state.tasks.delete(id);
  tombstone(id);
  commit();
}

/* ---------- home info ---------- */
export function putHome(item) {
  unTombstone(item.id);
  state.home.set(item.id, touch({ ...item, homeId: item.homeId || currentHomeId() }));
  commit();
}
export function removeHome(id) {
  state.home.delete(id);
  tombstone(id);
  commit();
}

/* ---------- homes ---------- */
export function addHome(name) {
  const h = touch({ id: newId("p"), name: name.trim().slice(0, 40) || "Home" });
  state.homes.set(h.id, h);
  state.local = { ...state.local, currentHomeId: h.id };
  state.area = "All";
  commit();
  return h;
}
export function renameHome(id, name) {
  const h = state.homes.get(id);
  if (!h) return;
  state.homes.set(id, touch({ ...h, name: name.trim().slice(0, 40) || h.name }));
  commit();
}
/** Delete a home and everything in it. The last home can't be deleted. */
export function removeHomeAndContents(id) {
  if (state.homes.size < 2) return false;
  for (const t of [...state.tasks.values()]) if (t.homeId === id) (state.tasks.delete(t.id), tombstone(t.id));
  for (const h of [...state.home.values()]) if (h.homeId === id) (state.home.delete(h.id), tombstone(h.id));
  state.homes.delete(id);
  tombstone(id);
  if (state.local.currentHomeId === id) state.local = { ...state.local, currentHomeId: [...state.homes.keys()][0] };
  commit();
  return true;
}
export function switchHome(id) {
  if (!state.homes.has(id)) return;
  state.local = { ...state.local, currentHomeId: id };
  state.area = "All";
  state.query = "";
  commit({ local: true });
}

/* ---------- prefs & device-only values ---------- */
export function setPrefs(changes) {
  state.prefs = touch({ ...state.prefs, ...changes });
  commit();
}
export function setLocal(changes) {
  state.local = { ...state.local, ...changes };
  commit({ local: true });
}

/** Replace in-memory data (another tab changed storage, or sync merged remote data). */
export function replaceAll(data, { fromSync = false } = {}) {
  const d = normalizeData({ ...data, local: data.local || state.local });
  Object.assign(state, toMaps(d));
  if (fromSync) {
    save(snapshot());
    listeners.forEach((fn) => fn());
  } else listeners.forEach((fn) => fn());
}

export function reload() {
  replaceAll(load());
}

// Persist the first-use stamp and any migration from older versions.
save(snapshot());
