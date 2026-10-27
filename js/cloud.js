// Cloud sync (Supabase) and push reminders. Does nothing until js/config.js has a Supabase URL and key.
//
// Sign-in: the user types their email, gets a code, types the code. No passwords.
// Sync: every record carries updatedAt; we push records newer than the last push and pull rows the server
// changed since the last pull, merging per record (newest wins). Attachments upload to private storage.
import { CLOUD } from "./config.js";
import { state, snapshot, onLocalEdit, replaceAll, setPrefs } from "./state.js";
import { rowsToPush, mergeRows, newestStamp } from "./sync-core.js";
import { referencedFiles } from "./store.js";
import { getFile, putFileRecord } from "./files.js";
import { addSettingsSection } from "./other-sheets.js";
import { $, esc, toast } from "./ui.js";
import { icon } from "./icons.js";

const enabled = Boolean(CLOUD.supabaseUrl && CLOUD.supabaseAnonKey);
const SESSION_KEY = "house-upkeep-log:session";
const SYNC_KEY = "house-upkeep-log:sync";
const MINUTE = 60000;

/* ---------------- small persistent stores ---------------- */
const readJSON = (k, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? fallback;
  } catch {
    return fallback;
  }
};
const writeJSON = (k, v) => {
  try {
    v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

let session = readJSON(SESSION_KEY, null); // { access_token, refresh_token, expires_at, user: { id, email } }
let sync = readJSON(SYNC_KEY, { pushedUpTo: 0, pulledAt: null, lastSyncAt: 0, uploaded: [], fileStamps: {} });
const saveSync = () => writeJSON(SYNC_KEY, sync);
const setSession = (s) => {
  session = s;
  writeJSON(SESSION_KEY, s);
};
export const signedIn = () => Boolean(session?.refresh_token);

/* ---------------- HTTP ---------------- */
class CloudError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function http(path, { method = "GET", body, auth = true, headers = {}, raw = false } = {}) {
  if (auth) await freshToken();
  let res;
  try {
    res = await fetch(CLOUD.supabaseUrl + path, {
      method,
      headers: {
        apikey: CLOUD.supabaseAnonKey,
        ...(auth && session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...(body !== undefined && !(body instanceof Blob) ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
    });
  } catch {
    throw new CloudError("You're offline. Changes will sync when you're back online.", 0);
  }
  if (raw) {
    if (!res.ok) throw new CloudError(`Request failed (${res.status})`, res.status);
    return res;
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new CloudError(data?.msg || data?.message || data?.error_description || `Request failed (${res.status})`, res.status);
  return data;
}

function sessionFrom(d) {
  return { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + (d.expires_in || 3600) * 1000, user: { id: d.user?.id, email: d.user?.email } };
}

let refreshing = null;
async function freshToken() {
  if (!session) throw new CloudError("Not signed in", 401);
  if (session.expires_at - MINUTE > Date.now()) return;
  refreshing ||= http("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: session.refresh_token }, auth: false })
    .then((d) => setSession(sessionFrom(d)))
    .catch((e) => {
      if (e.status === 400 || e.status === 401) {
        setSession(null);
        redrawSettings?.();
      }
      throw e;
    })
    .finally(() => (refreshing = null));
  return refreshing;
}

/* ---------------- sign-in ---------------- */
async function sendCode(email) {
  await http("/auth/v1/otp", { method: "POST", body: { email, create_user: true }, auth: false });
}
async function verifyCode(email, token) {
  const d = await http("/auth/v1/verify", { method: "POST", body: { type: "email", email, token }, auth: false });
  setSession(sessionFrom(d));
  // A new account (or a different one) starts from scratch so everything on this device uploads.
  sync = { pushedUpTo: 0, pulledAt: null, lastSyncAt: 0, uploaded: [], fileStamps: {}, userId: session.user.id };
  saveSync();
}
async function signOut() {
  try {
    await unsubscribePush();
    await http("/auth/v1/logout", { method: "POST" });
  } catch {}
  setSession(null);
  sync = { pushedUpTo: 0, pulledAt: null, lastSyncAt: 0, uploaded: [], fileStamps: {} };
  saveSync();
}

/* ---------------- sync ---------------- */
let syncing = null;
let again = false;
let lastError = "";

export function syncNow() {
  if (!enabled || !signedIn()) return Promise.resolve();
  if (syncing) {
    again = true;
    return syncing;
  }
  syncing = runSync()
    .then(() => (lastError = ""))
    .catch((e) => {
      lastError = e.message;
    })
    .finally(() => {
      syncing = null;
      redrawSettings?.();
      if (again) {
        again = false;
        syncNow();
      }
    });
  return syncing;
}

async function fileMetaToPush() {
  const ids = referencedFiles([...state.tasks.values()], [...state.home.values()]);
  const out = [];
  for (const id of ids) {
    const rec = await getFile(id).catch(() => null);
    if (!rec) continue;
    const stamp = rec.labelAt || rec.created || 1;
    if ((sync.fileStamps[id] || 0) >= stamp) continue;
    out.push({ id, name: rec.name, type: rec.type, label: rec.label || "receipt", updatedAt: stamp });
  }
  return out;
}

async function runSync() {
  const uid = session.user.id;

  // 1. Pull what changed on the server (with a small overlap; merging is idempotent).
  let since = sync.pulledAt ? new Date(Date.parse(sync.pulledAt) - 2 * MINUTE).toISOString() : null;
  const remoteFiles = [];
  for (let page = 0; page < 50; page++) {
    const q = `/rest/v1/items?select=id,kind,data,deleted,updated_at,server_at&order=server_at.asc&limit=500${since ? `&server_at=gt.${encodeURIComponent(since)}` : ""}`;
    const rows = await http(q);
    if (!rows.length) break;
    const merged = mergeRows(snapshot(), rows); // merge into the latest local state, not a stale copy
    if (merged.changed) replaceAll(merged.data, { fromSync: true });
    remoteFiles.push(...merged.files);
    for (const f of merged.files) sync.fileStamps[f.id] = Math.max(sync.fileStamps[f.id] || 0, f.updatedAt);
    since = rows.at(-1).server_at;
    sync.pulledAt = since;
    if (rows.length < 500) break;
  }

  // 2. Push local changes. "Pushed up to" is this device's clock at the moment of the snapshot, so a
  //    record synced from a device whose clock runs ahead can't hide later local edits.
  const fileMeta = await fileMetaToPush();
  const pushStart = Date.now() - 1;
  const rows = rowsToPush(snapshot(), sync.pushedUpTo, fileMeta);
  for (let i = 0; i < rows.length; i += 200) await http("/rest/v1/rpc/push_items", { method: "POST", body: { rows: rows.slice(i, i + 200) } });
  sync.pushedUpTo = Math.max(sync.pushedUpTo, Math.min(pushStart, newestStamp(rows) || pushStart));
  for (const f of fileMeta) sync.fileStamps[f.id] = f.updatedAt;

  // 3. Attachments: upload ours, download ones that only exist elsewhere.
  const needed = referencedFiles([...state.tasks.values()], [...state.home.values()]);
  const uploaded = new Set(sync.uploaded);
  for (const id of needed) {
    const rec = await getFile(id).catch(() => null);
    if (rec && !uploaded.has(id)) {
      await http(`/storage/v1/object/attachments/${uid}/${encodeURIComponent(id)}`, {
        method: "POST",
        body: rec.blob,
        headers: { "Content-Type": rec.type || "application/octet-stream", "x-upsert": "true" },
      });
      uploaded.add(id);
    } else if (!rec) {
      try {
        const res = await http(`/storage/v1/object/attachments/${uid}/${encodeURIComponent(id)}`, { raw: true });
        const blob = await res.blob();
        const meta = remoteFiles.find((f) => f.id === id) || {};
        await putFileRecord({ id, name: meta.name || "attachment", type: meta.type || blob.type, label: meta.label || "receipt", blob, created: Date.now() });
        uploaded.add(id);
      } catch (e) {
        if (e.status !== 404 && e.status !== 400) throw e;
      }
    }
  }
  sync.uploaded = [...uploaded];
  sync.lastSyncAt = Date.now();
  saveSync();
  if (remoteFiles.length) replaceAll(snapshot(), { fromSync: true }); // redraw thumbnails that just arrived
}

/* ---------------- push reminders ---------------- */
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function urlB64ToBytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** The service worker registration, or null if it isn't running (it never registers on some previews). */
async function swReady(ms = 3000) {
  return Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), ms))]);
}

async function currentSubscription() {
  if (!CLOUD.vapidPublicKey || !pushSupported()) return null;
  const reg = await swReady(1500);
  return reg ? reg.pushManager.getSubscription() : null;
}

async function subscribePush() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are blocked. Allow them for this app in your phone's settings, then try again.");
  const reg = await swReady();
  if (!reg) throw new Error("Reminders need the installed app. Reload the page and try again.");
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(CLOUD.vapidPublicKey) }));
  const json = sub.toJSON();
  await http("/rest/v1/push_subs?on_conflict=endpoint", {
    method: "POST",
    body: { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" },
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
  });
}

async function unsubscribePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  try {
    await http(`/rest/v1/push_subs?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: "DELETE" });
  } catch {}
  await sub.unsubscribe();
}

/* ---------------- Settings section ---------------- */
let redrawSettings = null;
let rerender = null;
const ago = (ms) => {
  if (!ms) return "not yet";
  const m = Math.round((Date.now() - ms) / MINUTE);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

function settingsSection(container, sheet) {
  const box = document.createElement("div");
  box.className = "cloud-box";
  container.append(box);
  let step = "email";
  let email = session?.user?.email || "";

  const draw = async () => {
    if (!box.isConnected) return (redrawSettings = null);
    if (!signedIn()) {
      box.innerHTML = `
        <div class="cloud-head">${icon.cloud}<div><b>Sync & cloud backup</b><small>Sign in with your email to keep your log safe and use it on more than one device. Also turns on reminder notifications.</small></div></div>
        ${
          step === "email"
            ? `<form class="inline-add" id="emailForm"><input id="cloudEmail" type="email" required autocomplete="email" placeholder="you@example.com" aria-label="Email" value="${esc(email)}"><button class="btn primary" type="submit">Send code</button></form>`
            : `<p class="help">We sent a code to <b>${esc(email)}</b>. It can take a minute; check spam if you don't see it.</p>
               <form class="inline-add" id="codeForm"><input id="cloudCode" inputmode="numeric" autocomplete="one-time-code" required pattern="[0-9]{6,10}" placeholder="Code" aria-label="Code from the email"><button class="btn primary" type="submit">Sign in</button></form>
               <button type="button" class="link" id="otherEmail">Use a different email</button>`
        }
        <span class="help" id="cloudStatus" aria-live="polite"></span>`;
    } else {
      const sub = await currentSubscription().catch(() => null);
      const pushRow = !CLOUD.vapidPublicKey
        ? ""
        : !pushSupported()
          ? `<section class="setting"><div><b>Reminders</b><small>${
              isIOS() && !standalone()
                ? "On iPhone, add this app to your Home Screen (Share → Add to Home Screen), open it from there, and turn reminders on here."
                : "This browser can't show notifications from web apps."
            }</small></div></section>`
          : `<section class="setting">
              <div><b>Reminders on this device</b><small>${sub ? `A notification at ${hourLabel(state.prefs.notifyHour)} when something is due. Overdue tasks remind you every few days.` : "Get a notification when a task is due."}</small></div>
              <button class="btn ${sub ? "" : "primary"}" id="pushBtn">${sub ? "Turn off" : "Turn on"}</button>
            </section>
            ${sub ? `<section class="setting"><div><label for="notifyHour"><b>Reminder time</b></label><small>Applies to all your devices</small></div><select id="notifyHour" class="short-select">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === state.prefs.notifyHour ? "selected" : ""}>${hourLabel(h)}</option>`).join("")}</select></section>` : ""}`;
      box.innerHTML = `
        <div class="cloud-head">${icon.cloud}<div><b>Synced as ${esc(session.user.email || "you")}</b><small id="syncLine">${syncing ? "Syncing…" : lastError ? esc(lastError) : `Last synced ${ago(sync.lastSyncAt)}`}</small></div></div>
        <div class="cloud-actions"><button class="btn" id="syncBtn" ${syncing ? "disabled" : ""}>Sync now</button><button class="btn" id="signOutBtn">Sign out</button></div>
        ${pushRow}`;
    }
    wire();
  };
  redrawSettings = draw;

  const status = (msg) => {
    const el = $("#cloudStatus", box);
    if (el) el.textContent = msg;
  };

  function wire() {
    $("#emailForm", box)?.addEventListener("submit", async (e) => {
      e.preventDefault();
      email = $("#cloudEmail", box).value.trim();
      e.submitter && (e.submitter.disabled = true);
      status("Sending…");
      try {
        await sendCode(email);
        step = "code";
        draw();
        setTimeout(() => $("#cloudCode", box)?.focus(), 50);
      } catch (err) {
        status(err.status === 429 ? "Too many codes requested. Wait a few minutes and try again." : err.message);
        e.submitter && (e.submitter.disabled = false);
      }
    });
    $("#codeForm", box)?.addEventListener("submit", async (e) => {
      e.preventDefault();
      status("Signing in…");
      try {
        await verifyCode(email, $("#cloudCode", box).value.trim());
        step = "email";
        rerender?.();
        draw();
        await syncNow();
        toast("Signed in. Your log is now backed up and syncing.");
      } catch (err) {
        status(/expired|invalid/i.test(err.message) ? "That code didn't work. Check it, or request a new one." : err.message);
      }
    });
    $("#otherEmail", box)?.addEventListener("click", () => ((step = "email"), draw()));
    $("#syncBtn", box)?.addEventListener("click", () => {
      syncNow();
      draw();
    });
    $("#signOutBtn", box)?.addEventListener("click", async () => {
      await signOut();
      draw();
      rerender?.();
      toast("Signed out. Your log stays on this device.");
    });
    $("#pushBtn", box)?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        if (await currentSubscription()) {
          await unsubscribePush();
          toast("Reminders turned off on this device.");
        } else {
          await subscribePush();
          toast(`Reminders on. You'll get a notification at ${hourLabel(state.prefs.notifyHour)} when something is due.`);
        }
      } catch (err) {
        toast(err.message || "Couldn't change notifications.");
      }
      draw();
    });
    $("#notifyHour", box)?.addEventListener("change", (e) => setPrefs({ notifyHour: Number(e.target.value) }));
  }
  draw();
}

const hourLabel = (h) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" });

/* ---------------- start ---------------- */
export function start({ hooks, render }) {
  if (!enabled) return;
  addSettingsSection(settingsSection);
  hooks.isBackedUp = () => signedIn() && Date.now() - sync.lastSyncAt < 7 * 86400000;
  hooks.canSignIn = () => !signedIn();

  let timer = null;
  onLocalEdit(() => {
    clearTimeout(timer);
    timer = setTimeout(syncNow, 1500);
  });
  window.addEventListener("online", () => syncNow());
  document.addEventListener("visibilitychange", () => !document.hidden && syncNow());
  setInterval(() => !document.hidden && syncNow(), 5 * MINUTE);
  window.addEventListener("file-label", () => syncNow());
  rerender = render;
  if (signedIn()) syncNow();
  render?.();
}
