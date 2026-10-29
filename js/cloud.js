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
import { $, esc, toast, openSheet, closeSheet } from "./ui.js";
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

/* ---------------- sign-in (email + password) ---------------- */
// Links in Supabase's emails (confirm address, reset password) come back to the app's own address.
const appURL = () => new URL("./", location.href).href;

function startFresh() {
  // A new sign-in starts sync from scratch so everything on this device uploads and everything remote downloads.
  sync = { pushedUpTo: 0, pulledAt: null, lastSyncAt: 0, uploaded: [], fileStamps: {}, userId: session.user.id };
  saveSync();
}

async function signInWithPassword(email, password) {
  const d = await http("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password }, auth: false });
  setSession(sessionFrom(d));
  startFresh();
}

/** Returns "signed-in" when the account is ready right away, or "confirm" when an email has to be confirmed first. */
async function signUp(email, password) {
  const d = await http(`/auth/v1/signup?redirect_to=${encodeURIComponent(appURL())}`, { method: "POST", body: { email, password }, auth: false });
  if (d?.access_token) {
    setSession(sessionFrom(d));
    startFresh();
    return "signed-in";
  }
  return "confirm";
}

async function sendReset(email) {
  await http(`/auth/v1/recover?redirect_to=${encodeURIComponent(appURL())}`, { method: "POST", body: { email }, auth: false });
}

async function setNewPassword(password) {
  await http("/auth/v1/user", { method: "PUT", body: { password } });
}

/** Turn Supabase's error wording into something a person can act on. */
function friendly(err) {
  const m = err.message || "";
  if (/invalid login credentials/i.test(m)) return "That email and password don't match. Check them, or reset your password.";
  if (/email not confirmed/i.test(m)) return "Confirm your email first: open the link we sent you, then sign in here.";
  if (/already registered|already been registered/i.test(m)) return "There's already an account with that email. Sign in instead.";
  if (/password should be at least|weak password/i.test(m)) return "Choose a longer password (at least 8 characters).";
  if (/signups not allowed|signup is disabled/i.test(m)) return "New accounts are turned off for this app. Sign in with your existing account.";
  if (err.status === 429 || /rate limit/i.test(m)) return "Too many tries. Wait a few minutes and try again.";
  return m;
}

/**
 * When the app opens from a link in a Supabase email, the address ends with #access_token=…&type=…
 * Take the session from it, clear it from the address bar, and say what happened.
 * Returns "signup", "recovery", or null.
 */
function takeSessionFromLink() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get("error_description")) {
    history.replaceState(null, "", location.pathname + location.search);
    toast(/expired|invalid/i.test(h.get("error_description")) ? "That link has expired. Request a new one from Settings." : h.get("error_description"));
    return null;
  }
  if (!h.get("access_token") || !h.get("refresh_token")) return null;
  const type = h.get("type");
  history.replaceState(null, "", location.pathname + location.search);
  let user = {};
  try {
    const payload = JSON.parse(atob(h.get("access_token").split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    user = { id: payload.sub, email: payload.email };
  } catch {}
  const previous = session?.user?.id;
  setSession({ access_token: h.get("access_token"), refresh_token: h.get("refresh_token"), expires_at: Date.now() + Number(h.get("expires_in") || 3600) * 1000, user });
  if (previous !== user.id) startFresh();
  return type;
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
  let mode = "signin"; // "signin" | "create" | "reset" | "confirm"
  let email = session?.user?.email || readJSON("house-upkeep-log:last-email", "") || "";

  const draw = async () => {
    if (!box.isConnected) return (redrawSettings = null);
    if (!signedIn()) {
      const intro = `<div class="cloud-head">${icon.cloud}<div><b>Sync & cloud backup</b><small>Sign in to keep your log safe and use it on more than one device.</small></div></div>`;
      const emailField = `<div class="field"><label for="cloudEmail">Email</label><input id="cloudEmail" type="email" required autocomplete="email" placeholder="you@example.com" value="${esc(email)}"></div>`;
      let body = "";
      if (mode === "confirm") {
        body = `<p class="help">Almost there. We sent a link to <b>${esc(email)}</b>. Open it to confirm your email (it can take a minute; check spam), then come back here and sign in.</p>
          <button type="button" class="btn primary" data-mode="signin">Sign in</button>`;
      } else if (mode === "reset") {
        body = `<form class="cloud-form" id="resetForm">${emailField}
            <p class="help">We'll email you a link to choose a new password.</p>
            <div class="cloud-actions"><button class="btn primary" type="submit">Send reset link</button><button type="button" class="btn" data-mode="signin">Back</button></div>
          </form>`;
      } else {
        const creating = mode === "create";
        body = `<div class="segmented small" role="group" aria-label="Account">
            <button type="button" data-mode="signin" aria-pressed="${!creating}">Sign in</button>
            <button type="button" data-mode="create" aria-pressed="${creating}">Create account</button>
          </div>
          <form class="cloud-form" id="authForm">${emailField}
            <div class="field"><label for="cloudPassword">Password</label><input id="cloudPassword" type="password" required minlength="${creating ? 8 : 1}" autocomplete="${creating ? "new-password" : "current-password"}"${creating ? ' aria-describedby="pwHelp"' : ""}>${creating ? '<span class="help" id="pwHelp">At least 8 characters. Your phone can suggest a strong one.</span>' : ""}</div>
            <div class="cloud-actions"><button class="btn primary" type="submit">${creating ? "Create account" : "Sign in"}</button>${creating ? "" : '<button type="button" class="link" data-mode="reset">Forgot password?</button>'}</div>
          </form>`;
      }
      box.innerHTML = `${intro}${body}<span class="help" id="cloudStatus" role="status" aria-live="polite"></span>`;
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
    box.querySelectorAll("[data-mode]").forEach((b) =>
      b.addEventListener("click", () => {
        email = $("#cloudEmail", box)?.value.trim() || email;
        mode = b.dataset.mode;
        draw();
      })
    );
    $("#authForm", box)?.addEventListener("submit", async (e) => {
      e.preventDefault();
      email = $("#cloudEmail", box).value.trim();
      writeJSON("house-upkeep-log:last-email", email);
      const password = $("#cloudPassword", box).value;
      const btn = e.submitter;
      if (btn) btn.disabled = true;
      status(mode === "create" ? "Creating your account…" : "Signing in…");
      try {
        if (mode === "create" && (await signUp(email, password)) === "confirm") {
          mode = "confirm";
          return draw();
        }
        if (mode !== "create") await signInWithPassword(email, password);
        mode = "signin";
        rerender?.();
        draw();
        await syncNow();
        toast("Signed in. Your log is now backed up and syncing.");
      } catch (err) {
        status(friendly(err));
        if (btn) btn.disabled = false;
      }
    });
    $("#resetForm", box)?.addEventListener("submit", async (e) => {
      e.preventDefault();
      email = $("#cloudEmail", box).value.trim();
      status("Sending…");
      try {
        await sendReset(email);
        status("If there's an account for that email, a reset link is on its way. Open it on this device.");
      } catch (err) {
        status(friendly(err));
      }
    });
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

function openNewPasswordSheet() {
  const sheet = openSheet(`<form class="sheet-form" id="newPwForm">
      <h3>Choose a new password</h3>
      <p class="help">For ${esc(session?.user?.email || "your account")}.</p>
      <div class="field"><label for="newPw">New password</label><input id="newPw" type="password" required minlength="8" autocomplete="new-password"><span class="help">At least 8 characters.</span></div>
      <span class="help" id="newPwStatus" role="status" aria-live="polite"></span>
      <div class="actions"><div class="right"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Save password</button></div></div>
    </form>`);
  $("#newPwForm", sheet).addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await setNewPassword($("#newPw", sheet).value);
      closeSheet(sheet);
      toast("Password changed. Use it to sign in on your other devices.");
    } catch (err) {
      $("#newPwStatus", sheet).textContent = friendly(err);
    }
  });
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
  const fromLink = takeSessionFromLink();
  if (fromLink === "recovery") setTimeout(openNewPasswordSheet, 300);
  else if (fromLink) toast("Email confirmed. You're signed in and syncing on this browser. On your phone's app, sign in with the same email and password.");
  if (signedIn()) syncNow();
  render?.();
}
