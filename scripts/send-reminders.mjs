// Sends reminder notifications. Run hourly by .github/workflows/reminders.yml.
//
// For every device that turned reminders on: if it's the user's reminder hour (or later that day, in case
// a run was delayed) and the device hasn't had today's reminder yet, work out what's due with the same code
// the app uses, and send one notification.
//
// Needs: SUPABASE_SERVICE_ROLE_KEY (the project's secret key) and VAPID_PRIVATE_KEY (GitHub secrets).
// Optional: TEST=1 sends a test notification to every device right away.
import webpush from "web-push";
import { CLOUD } from "../js/config.js";
import { buildReminder, localNow } from "../js/reminders-core.js";
import { normalizeData } from "../js/store.js";

const LATEST_HOUR = 21; // don't send catch-up reminders late in the evening
const { SUPABASE_SERVICE_ROLE_KEY: key, VAPID_PRIVATE_KEY: vapidPrivate, TEST, GITHUB_SERVER_URL, GITHUB_REPOSITORY } = process.env;

if (!CLOUD.supabaseUrl || !CLOUD.vapidPublicKey) {
  console.log("Cloud isn't configured in js/config.js yet; nothing to do.");
  process.exit(0);
}
if (!key || !vapidPrivate) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY or VAPID_PRIVATE_KEY secret.");
  process.exit(1);
}

webpush.setVapidDetails(GITHUB_SERVER_URL && GITHUB_REPOSITORY ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}` : "https://github.com", CLOUD.vapidPublicKey, vapidPrivate);

async function db(path, { method = "GET", body } = {}) {
  const res = await fetch(`${CLOUD.supabaseUrl}/rest/v1/${path}`, {
    method,
    // New-style secret keys (sb_secret_…) go in the apikey header only; older JWT service_role keys also need Authorization.
    headers: { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function userData(userId) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await db(`items?select=kind,data&user_id=eq.${userId}&deleted=eq.false&kind=in.(task,home,prefs)&order=id&limit=1000&offset=${offset}`);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return normalizeData({
    homes: rows.filter((r) => r.kind === "home").map((r) => r.data),
    tasks: rows.filter((r) => r.kind === "task").map((r) => r.data),
    prefs: rows.find((r) => r.kind === "prefs")?.data,
  });
}

async function send(sub, message) {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(message), { TTL: 6 * 3600, urgency: "normal" });
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      console.log("Removing a device that unsubscribed.");
      await db(`push_subs?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: "DELETE" });
    } else console.error("Push failed:", err.statusCode, err.body || err.message);
    return false;
  }
}

const subs = await db("push_subs?select=*");
console.log(`${subs.length} device(s) with reminders on.`);
const cache = new Map();
let sent = 0;

for (const sub of subs) {
  if (TEST) {
    if (await send(sub, { title: "Test notification", body: "Reminders from House Upkeep Log are working.", tag: "upkeep-test" })) sent++;
    continue;
  }
  if (!cache.has(sub.user_id)) cache.set(sub.user_id, await userData(sub.user_id));
  const data = cache.get(sub.user_id);
  const { date, hour } = localNow(sub.tz);
  if (hour < data.prefs.notifyHour || hour > LATEST_HOUR || sub.last_sent_on === date) continue;

  const msg = buildReminder(data, date, sub.last_nag_on);
  const patch = { last_sent_on: date };
  if (msg && (await send(sub, msg))) {
    sent++;
    if (msg.nag) patch.last_nag_on = date;
  }
  await db(`push_subs?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: "PATCH", body: patch });
}
console.log(`Sent ${sent} notification(s).`);
