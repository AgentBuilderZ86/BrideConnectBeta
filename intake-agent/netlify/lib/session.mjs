import { getStore } from "@netlify/blobs";
import { SignJWT, jwtVerify, createRemoteJWKSet } from "jose";
import { randomBytes, createHash } from "node:crypto";
import { authorized } from "./auth.mjs";

// Who is calling, and what they may do.
// - Signed-in users carry a session cookie (HS256 JWT) issued after Microsoft Entra ID sign-in, or by the
//   demo role picker. Their role decides what the API lets them do.
// - Without a session, the demo code alone grants every right ("demo" role), unless sign-in is required:
//   AUTH_REQUIRED=1, or Entra ID configured (ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET).
export const ROLES = { metier: "Métier", dsi: "DSI", direction: "Direction", admin: "Administrateur", demo: "Démo (tous droits)" };
const ALL = ["fiche.create", "fiche.own", "fiche.read", "fiche.dsi", "portfolio.read", "portfolio.build", "pilot.read", "pilot.run", "audit.read", "privacy.admin", "admin", "demo.reset"];
const PERMS = {
  metier: ["fiche.create", "fiche.own"],
  direction: ["fiche.create", "fiche.own", "fiche.read", "portfolio.read", "pilot.read"],
  dsi: ["fiche.create", "fiche.own", "fiche.read", "fiche.dsi", "portfolio.read", "portfolio.build", "pilot.read", "pilot.run"],
  admin: ALL,
  demo: ALL,
};
export const can = (role, perm) => !perm || (PERMS[role] || []).includes(perm);
export const permsOf = (role) => PERMS[role] || [];

const env = (k) => Netlify.env.get(k);
export const entraConfigured = () => !!(env("ENTRA_TENANT_ID") && env("ENTRA_CLIENT_ID") && env("ENTRA_CLIENT_SECRET"));
export const authRequired = () => entraConfigured() || env("AUTH_REQUIRED") === "1";
export const demoLoginAllowed = () => !entraConfigured() || env("ALLOW_DEMO_LOGIN") === "1";

const COOKIE = "__Host-intake_session", OIDC = "__Host-intake_oidc";
let secretKey = null;
// SESSION_SECRET when set; otherwise a random secret generated once and kept in the config store.
async function key() {
  if (secretKey) return secretKey;
  let s = env("SESSION_SECRET");
  if (!s) {
    const st = getStore({ name: "config", consistency: "strong" });
    s = await st.get("session-secret");
    if (!s) { s = randomBytes(32).toString("base64url"); await st.set("session-secret", s); }
  }
  secretKey = new TextEncoder().encode(s);
  return secretKey;
}
// Token used between our own functions (e.g. a channel triggering a background job).
export const internalToken = async () => createHash("sha256").update(Buffer.from(await key())).update("internal").digest("base64url");
export const isInternal = async (req) => req.headers.get("x-internal") === (await internalToken());

function readCookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(";")) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim()); }
  return null;
}
const setCookie = (name, value, maxAge) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export async function sign(payload, ttlSeconds) {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds).sign(await key());
}
async function verify(token) {
  try { return (await jwtVerify(token, await key(), { algorithms: ["HS256"] })).payload; } catch { return null; }
}

export async function getSession(req) {
  const c = readCookie(req, COOKIE);
  const s = c ? await verify(c) : null;
  return s && ROLES[s.role] && s.role !== "demo" ? s : null;
}
export async function sessionCookie(user, ttl = 8 * 3600) {
  const token = await sign({ sub: user.sub, name: user.name, email: user.email || "", role: user.role, via: user.via }, ttl);
  return setCookie(COOKIE, token, ttl);
}
export const clearSessionCookie = () => setCookie(COOKIE, "", 0);

// Resolves the caller: { role, session } or null when the request may not go further.
export async function access(req) {
  const session = await getSession(req);
  if (session) return { role: session.role, session };
  if (authRequired() || !authorized(req)) return null;
  return { role: "demo", session: null };
}
export async function guard(req, perm) {
  const a = await access(req);
  if (!a) return { error: Response.json({ error: "unauthorized", login: authRequired() }, { status: 401 }) };
  if (!can(a.role, perm)) return { error: Response.json({ error: "forbidden", role: a.role }, { status: 403 }) };
  return a;
}
export function actorOf(a) {
  if (!a) return { name: "Inconnu", role: "?" };
  if (a.system) return { name: a.system, role: "système" };
  if (a.session) return { name: a.session.name, email: a.session.email || "", role: a.session.role, via: a.session.via };
  return { name: "Accès démo", role: "demo" };
}
export const lower = (s) => String(s || "").trim().toLowerCase();
// A fiche belongs to the signed-in user who created it, or whose e-mail is the requester's.
export function isOwner(doc, a) {
  const s = a?.session; if (!s) return false;
  if (doc?.owner?.sub && doc.owner.sub === s.sub) return true;
  const e = lower(s.email);
  if (e && (lower(doc?.owner?.email) === e || lower(doc?.demandeur) === e)) return true;
  // Co-owners of a merged need.
  return (doc?.coporteurs || []).some((c) => (c.owner?.sub && c.owner.sub === s.sub) || (e && lower(c.owner?.email) === e));
}
// Métier actions on a fiche: its owner, or a role that may act for anyone (demo, admin).
export const canActAsOwner = (doc, a) => a.role === "demo" || a.role === "admin" || isOwner(doc, a);
export const canSeeFiche = (doc, a) => can(a.role, "fiche.read") || isOwner(doc, a);

// ---------- Microsoft Entra ID (OpenID Connect, authorization code + PKCE) ----------
const tenant = () => env("ENTRA_TENANT_ID");
const authority = () => `https://login.microsoftonline.com/${tenant()}`;
let jwks = null;

export async function entraLoginRedirect(req) {
  const origin = new URL(req.url).origin;
  const state = randomBytes(16).toString("base64url"), nonce = randomBytes(16).toString("base64url"), verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const u = new URL(`${authority()}/oauth2/v2.0/authorize`);
  for (const [k, v] of Object.entries({ client_id: env("ENTRA_CLIENT_ID"), response_type: "code", redirect_uri: `${origin}/api/auth/callback`, response_mode: "query", scope: "openid profile email", state, nonce, code_challenge: challenge, code_challenge_method: "S256" })) u.searchParams.set(k, v);
  const tmp = await sign({ state, nonce, verifier }, 600);
  return new Response(null, { status: 302, headers: { location: u.toString(), "set-cookie": setCookie(OIDC, tmp, 600) } });
}

// Returns { sub, name, email, roles } for a valid callback, or throws.
export async function entraCallback(req) {
  const u = new URL(req.url);
  const tmp = await verify(readCookie(req, OIDC) || "");
  if (!tmp || !u.searchParams.get("code") || u.searchParams.get("state") !== tmp.state) throw new Error("état de connexion invalide");
  const r = await fetch(`${authority()}/oauth2/v2.0/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("ENTRA_CLIENT_ID"), client_secret: env("ENTRA_CLIENT_SECRET"), grant_type: "authorization_code", code: u.searchParams.get("code"), redirect_uri: `${u.origin}/api/auth/callback`, code_verifier: tmp.verifier }),
  });
  const j = await r.json();
  if (!j.id_token) throw new Error(j.error_description || "jeton absent");
  jwks ||= createRemoteJWKSet(new URL(`${authority()}/discovery/v2.0/keys`));
  const { payload } = await jwtVerify(j.id_token, jwks, { audience: env("ENTRA_CLIENT_ID") });
  if (payload.iss !== `https://login.microsoftonline.com/${payload.tid}/v2.0`) throw new Error("émetteur inattendu");
  if (/^[0-9a-f-]{36}$/i.test(tenant()) && payload.tid !== tenant()) throw new Error("locataire inattendu");
  if (payload.nonce !== tmp.nonce) throw new Error("nonce invalide");
  return { sub: `entra:${payload.oid || payload.sub}`, name: payload.name || payload.preferred_username || "Utilisateur", email: payload.email || payload.preferred_username || "", roles: Array.isArray(payload.roles) ? payload.roles : [] };
}
export const clearOidcCookie = () => setCookie(OIDC, "", 0);

// Entra app roles ("Metier", "DSI", "Direction", "Admin") win; then the admin console mapping; then Métier.
export function roleFor(user, mapping = {}) {
  const norm = (r) => lower(r).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^administrateur$/, "admin");
  for (const r of ["admin", "dsi", "direction", "metier"]) if ((user.roles || []).some((x) => norm(x) === r)) return r;
  const m = mapping[lower(user.email)];
  return ROLES[m] && m !== "demo" ? m : "metier";
}
