// Local Supabase-shaped gateway for end-to-end verification of Heuresis.
// - /auth/v1/*   : minimal GoTrue replacement (password + refresh grant, user, logout)
// - /rest/v1/*   : proxied to a real PostgREST 12 running against Postgres 16
// - /storage/v1/*: empty responses (card media is not exercised here)
// Not part of the project. Run: node gateway.mjs
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const POSTGREST = process.env.POSTGREST_URL ?? "http://127.0.0.1:3001";
const SECRET = process.env.JWT_SECRET ?? "local-heuresis-test-secret-at-least-32-chars";
const USERS = { "thomas@example.test": { id: "11111111-1111-4111-8111-111111111111", password: "heuresis" } };
let failNextWrites = 0;

const b64 = (value) => Buffer.from(value).toString("base64url");
function sign(payload) {
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
function verify(token) {
  const [head, body, sig] = String(token ?? "").split(".");
  if (!head || !body || !sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  if (expected !== sig) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  return payload;
}
function userObject(email, id) {
  return { id, aud: "authenticated", role: "authenticated", email, email_confirmed_at: "2026-01-01T00:00:00Z",
    app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
}
function session(email, id) {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 3600;
  return {
    access_token: sign({ sub: id, email, role: "authenticated", aud: "authenticated", iat: now, exp: now + expiresIn }),
    token_type: "bearer", expires_in: expiresIn, expires_at: now + expiresIn,
    refresh_token: b64(JSON.stringify({ email, id, n: crypto.randomUUID() })), user: userObject(email, id),
  };
}
function cors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS");
  res.setHeader("access-control-expose-headers", "content-range, content-profile, x-total-count");
}
function json(res, status, value) {
  cors(res);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (req.method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }

    // Test control endpoint: make the next N REST writes fail with HTTP 500.
    if (url.pathname === "/__test/fail-writes") { failNextWrites = Number(url.searchParams.get("n") ?? 1); json(res, 200, { failNextWrites }); return; }

    if (url.pathname.startsWith("/auth/v1/")) {
      const body = req.method === "POST" ? JSON.parse((await readBody(req)).toString() || "{}") : {};
      if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
        const user = USERS[String(body.email ?? "").toLowerCase()];
        if (!user || user.password !== body.password) { json(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials", code: 400 }); return; }
        json(res, 200, session(String(body.email).toLowerCase(), user.id)); return;
      }
      if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
        try {
          const parsed = JSON.parse(Buffer.from(String(body.refresh_token), "base64url").toString());
          json(res, 200, session(parsed.email, parsed.id)); return;
        } catch { json(res, 400, { error: "invalid_grant", msg: "Invalid refresh token" }); return; }
      }
      if (url.pathname === "/auth/v1/user") {
        const claims = verify((req.headers.authorization ?? "").replace(/^Bearer /i, ""));
        if (!claims) { json(res, 401, { msg: "invalid JWT" }); return; }
        json(res, 200, userObject(claims.email, claims.sub)); return;
      }
      if (url.pathname === "/auth/v1/logout") { cors(res); res.writeHead(204); res.end(); return; }
      json(res, 404, { msg: "not implemented in local gateway" }); return;
    }

    if (url.pathname.startsWith("/storage/v1/")) { json(res, 200, []); return; }

    if (url.pathname.startsWith("/rest/v1/")) {
      const isWrite = !["GET", "HEAD"].includes(req.method ?? "GET") && !url.pathname.includes("/rpc/");
      if (isWrite && failNextWrites > 0) { failNextWrites -= 1; json(res, 500, { message: "Injected test failure" }); return; }
      const target = new URL(url.pathname.replace(/^\/rest\/v1/, "") + url.search, POSTGREST);
      const headers = { ...req.headers };
      delete headers.host; delete headers.apikey; delete headers.connection;
      const token = String(headers.authorization ?? "").replace(/^Bearer /i, "");
      if (!verify(token)) delete headers.authorization;
      const body = ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : await readBody(req);
      const upstream = await fetch(target, { method: req.method, headers, body });
      const buffer = Buffer.from(await upstream.arrayBuffer());
      cors(res);
      const outHeaders = {};
      upstream.headers.forEach((value, key) => { if (!["content-encoding", "transfer-encoding", "connection"].includes(key)) outHeaders[key] = value; });
      res.writeHead(upstream.status, outHeaders);
      res.end(buffer);
      if (upstream.status >= 400) console.log(`[rest ${upstream.status}] ${req.method} ${url.pathname}${url.search} ${buffer.toString().slice(0, 300)}`);
      return;
    }
    json(res, 404, { msg: "unknown path" });
  } catch (error) {
    console.error(error);
    json(res, 500, { msg: String(error) });
  }
});
server.listen(PORT, () => console.log(`Heuresis test gateway on http://localhost:${PORT}`));
