// Used by e2e/sync.spec.js. A tiny stand-in for Supabase (password sign-in, items table with push_items LWW, storage, push_subs) for local testing.
import http from "node:http";

const users = new Map(); // email -> id
const passwords = new Map(); // email -> password
const confirmed = new Set(); // emails that clicked the confirmation link
const tokens = new Map(); // access/refresh token -> user id
let items = []; // { user_id, id, kind, data, deleted, updated_at, server_at }
const objects = new Map(); // path -> { type, buf }
const subs = [];
let clock = Date.now();
const nowISO = () => new Date((clock = Math.max(clock + 1, Date.now()))).toISOString();

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS" };
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { ...cors, "Content-Type": "application/json", ...headers });
  res.end(body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body));
};
const session = (uid, email) => {
  const at = "at-" + Math.random().toString(36).slice(2), rt = "rt-" + Math.random().toString(36).slice(2);
  tokens.set(at, uid);
  tokens.set(rt, uid);
  return { access_token: at, refresh_token: rt, expires_in: 3600, user: { id: uid, email } };
};

http
  .createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const buf = Buffer.concat(chunks);
      const u = new URL(req.url, "http://x");
      if (req.method === "OPTIONS") return send(res, 204);
      if (u.pathname === "/__confirm") {
        confirmed.add(u.searchParams.get("email"));
        return send(res, 200, { ok: true });
      }
      if (req.headers.apikey !== "anon-test") return send(res, 401, { message: "bad apikey" });
      const json = () => (buf.length ? JSON.parse(buf.toString()) : {});
      const uid = tokens.get((req.headers.authorization || "").replace("Bearer ", ""));

      // ---- auth ----
      if (u.pathname === "/auth/v1/signup") {
        const { email, password } = json();
        if (users.has(email)) return send(res, 200, { id: "obfuscated" }); // like Supabase: don't reveal existing accounts
        if ((password || "").length < 8) return send(res, 422, { msg: "Password should be at least 8 characters." });
        users.set(email, "user-" + users.size);
        passwords.set(email, password);
        return send(res, 200, { id: users.get(email), email });
      }
      if (u.pathname === "/auth/v1/recover") return send(res, 200, {});
      if (u.pathname === "/auth/v1/token" && u.searchParams.get("grant_type") === "password") {
        const { email, password } = json();
        if (!users.has(email) || passwords.get(email) !== password) return send(res, 400, { error_description: "Invalid login credentials", msg: "Invalid login credentials" });
        if (!confirmed.has(email)) return send(res, 400, { msg: "Email not confirmed" });
        return send(res, 200, session(users.get(email), email));
      }
      if (u.pathname === "/auth/v1/token") {
        const id = tokens.get(json().refresh_token);
        return id ? send(res, 200, session(id, [...users].find(([, v]) => v === id)[0])) : send(res, 400, { msg: "invalid refresh" });
      }
      if (u.pathname === "/auth/v1/logout") return send(res, 204);
      if (!uid) return send(res, 401, { message: "JWT required" });

      // ---- items ----
      if (u.pathname === "/rest/v1/rpc/push_items") {
        for (const r of json().rows) {
          const cur = items.find((x) => x.user_id === uid && x.id === r.id);
          if (!cur) items.push({ user_id: uid, ...r, server_at: nowISO() });
          else if (cur.updated_at < r.updated_at) Object.assign(cur, r, { server_at: nowISO() });
        }
        return send(res, 204);
      }
      if (u.pathname === "/rest/v1/items") {
        const gt = u.searchParams.get("server_at")?.replace("gt.", "");
        const limit = Number(u.searchParams.get("limit") || 1000);
        const rows = items
          .filter((x) => x.user_id === uid && (!gt || x.server_at > gt))
          .sort((a, b) => a.server_at.localeCompare(b.server_at))
          .slice(0, limit)
          .map(({ user_id, ...r }) => r);
        return send(res, 200, rows);
      }
      // ---- storage ----
      const m = u.pathname.match(/^\/storage\/v1\/object\/attachments\/([^/]+)\/(.+)$/);
      if (m) {
        if (m[1] !== uid) return send(res, 403, { message: "not yours" });
        const key = m[1] + "/" + m[2];
        if (req.method === "POST") {
          objects.set(key, { type: req.headers["content-type"], buf });
          return send(res, 200, { Key: key });
        }
        const o = objects.get(key);
        if (!o) return send(res, 400, { message: "Object not found" });
        res.writeHead(200, { ...cors, "Content-Type": o.type });
        return res.end(o.buf);
      }
      if (u.pathname === "/rest/v1/push_subs") {
        if (req.method === "POST") subs.push({ ...json(), user_id: uid });
        return send(res, 201);
      }
      if (u.pathname === "/__dump") return send(res, 200, { items: items.length, objects: objects.size });
      send(res, 404, { message: "not found " + u.pathname });
    });
  })
  .listen(Number(process.env.PORT || 5998), () => console.log("fake supabase ready"));
