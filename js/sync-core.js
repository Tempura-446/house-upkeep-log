// Pure helpers for cloud sync: turning app data into rows and merging rows back, last-writer-wins per record.
// No network or DOM here, so it is unit tested in Node.

export const PREFS_ID = "prefs";

/** Rows for every record changed after `since` (ms). Deletions become rows with deleted: true. */
export function rowsToPush(data, since = 0, fileMeta = []) {
  const rows = [];
  const add = (kind, rec) => rec.updatedAt > since && rows.push({ id: rec.id, kind, data: rec, deleted: false, updated_at: rec.updatedAt });
  data.homes.forEach((h) => add("home", h));
  data.tasks.forEach((t) => add("task", t));
  data.home.forEach((h) => add("info", h));
  if (data.prefs.updatedAt > since) rows.push({ id: PREFS_ID, kind: "prefs", data: data.prefs, deleted: false, updated_at: data.prefs.updatedAt });
  for (const f of fileMeta) if (f.updatedAt > since) rows.push({ id: f.id, kind: "file", data: { name: f.name, type: f.type, label: f.label }, deleted: false, updated_at: f.updatedAt });
  for (const [id, at] of Object.entries(data.deleted || {})) if (at > since) rows.push({ id, kind: kindOfDeleted(id, data), data: null, deleted: true, updated_at: at });
  return rows;
}

// Ids carry a prefix by kind (t… tasks, h… Home info, p… homes); anything else is treated as a task.
function kindOfDeleted(id, data) {
  if (data.homeIdsSeen?.has(id) || id === "home" || /^p[0-9a-z]{6,}$/.test(id)) return "home";
  if (/^h[0-9a-z]{6,}$/.test(id)) return "info";
  return "task";
}

/**
 * Apply rows from the server to local data. A row wins only if it is newer than the local copy
 * (or the local deletion). Returns { data, changed, files } where files are attachment details seen.
 */
export function mergeRows(data, rows) {
  const maps = {
    home: new Map(data.homes.map((x) => [x.id, x])),
    task: new Map(data.tasks.map((x) => [x.id, x])),
    info: new Map(data.home.map((x) => [x.id, x])),
  };
  const deleted = { ...(data.deleted || {}) };
  let prefs = data.prefs;
  let changed = false;
  const files = [];

  for (const r of rows) {
    const at = Number(r.updated_at) || 0;
    if (r.kind === "file") {
      if (!r.deleted && r.data) files.push({ id: r.id, ...r.data, updatedAt: at });
      continue;
    }
    if (r.kind === "prefs") {
      if (!r.deleted && r.data && at > (prefs.updatedAt || 0)) {
        prefs = { ...prefs, ...r.data, updatedAt: at };
        changed = true;
      }
      continue;
    }
    const map = maps[r.kind];
    if (!map) continue;
    const local = map.get(r.id);
    const localAt = Math.max(local?.updatedAt || 0, deleted[r.id] || 0);
    if (at <= localAt) continue;
    if (r.deleted) {
      if (local) map.delete(r.id);
      deleted[r.id] = at;
    } else if (r.data) {
      map.set(r.id, { ...r.data, id: r.id, updatedAt: at });
      delete deleted[r.id];
    }
    changed = true;
  }

  return {
    data: { ...data, homes: [...maps.home.values()], tasks: [...maps.task.values()], home: [...maps.info.values()], prefs, deleted },
    changed,
    files,
  };
}

/** The newest updatedAt among rows (used to remember how far we've pushed). */
export const newestStamp = (rows) => rows.reduce((n, r) => Math.max(n, Number(r.updated_at) || 0), 0);
