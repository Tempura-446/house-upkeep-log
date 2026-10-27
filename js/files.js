// Receipt photos and PDFs, stored in IndexedDB on this device.
// Photos are shrunk before saving so a year of receipts doesn't fill the phone's storage.

const DB_NAME = "house-upkeep-files";
const STORE = "files";
const MAX_EDGE = 1600;
const MAX_BYTES = 15 * 1024 * 1024;
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const result = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error("Storage was full or unavailable."));
      })
  );
}

const newFileId = () => "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

async function shrinkImage(file) {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 400 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file; // A format the browser can't decode (e.g. some HEIC): keep the original.
  }
}

/** Save a picked file. Returns its id. Throws an Error with a readable message on failure. */
export async function addFile(file, label = "receipt") {
  if (!file.type.startsWith("image/") && file.type !== "application/pdf") throw new Error("Attachments can be photos or PDFs.");
  const blob = await shrinkImage(file);
  if (blob.size > MAX_BYTES) throw new Error("That file is over 15 MB. Try a smaller photo or PDF.");
  const id = newFileId();
  const name = (file.name || "receipt").slice(0, 120);
  try {
    await tx("readwrite", (s) => s.put({ id, name, type: blob.type || file.type, label, blob, created: Date.now() }));
  } catch {
    throw new Error("Couldn't save that file. Your phone may be low on storage.");
  }
  return id;
}

export const getFile = (id) => tx("readonly", (s) => s.get(id));
/** Store a file record as-is (used by restore and sync). */
export const putFileRecord = (rec) => tx("readwrite", (s) => s.put(rec));

export async function setFileLabel(id, label) {
  const rec = await getFile(id);
  if (!rec) return;
  await putFileRecord({ ...rec, label, labelAt: Date.now() });
  window.dispatchEvent(new CustomEvent("file-label", { detail: { id, label } }));
}
export const deleteFile = (id) => tx("readwrite", (s) => s.delete(id));
export const allFileIds = () => tx("readonly", (s) => s.getAllKeys());

const urlCache = new Map();
/** An object URL for showing a stored file; cached for the session. */
export async function fileURL(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const rec = await getFile(id);
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(id, url);
  return url;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function base64ToBlob(data, type) {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Files for a backup, as [{ id, name, type, data(base64) }]. */
export async function exportFiles(ids) {
  const out = [];
  for (const id of ids) {
    const rec = await getFile(id);
    if (rec) out.push({ id, name: rec.name, type: rec.type, label: rec.label || "receipt", data: await blobToBase64(rec.blob) });
  }
  return out;
}

export async function importFiles(list) {
  for (const f of list) {
    const blob = base64ToBlob(f.data, f.type);
    await tx("readwrite", (s) => s.put({ id: f.id, name: f.name || "receipt", type: f.type, label: f.label || "receipt", blob, created: Date.now() }));
  }
}

/** Remove stored files no task refers to any more. */
export async function pruneFiles(keepIds) {
  const ids = await allFileIds();
  for (const id of ids) if (!keepIds.has(id)) await deleteFile(id);
}

/** Ask the browser not to clear this app's data when space runs low. Returns true if granted. */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageInfo() {
  try {
    const [persisted, est] = await Promise.all([navigator.storage?.persisted?.() ?? false, navigator.storage?.estimate?.() ?? {}]);
    return { persisted, usage: est.usage || 0 };
  } catch {
    return { persisted: false, usage: 0 };
  }
}
