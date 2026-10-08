import { authorized } from "../lib/auth.mjs";
import {
  ROLES, permsOf, access, getSession, sessionCookie, clearSessionCookie, entraConfigured, authRequired, demoLoginAllowed,
  entraLoginRedirect, entraCallback, clearOidcCookie, roleFor, lower,
} from "../lib/session.mjs";
import { getConfig } from "../lib/config.mjs";
import { audit } from "../lib/audit.mjs";

// /api/auth/me | demo | login | callback | logout
const json = (o, status = 200, headers = {}) => Response.json(o, { status, headers });

export default async (req, context) => {
  const action = context.params?.action;

  if (action === "me") {
    const a = await access(req);
    return json({
      session: a?.session ? { name: a.session.name, email: a.session.email, role: a.session.role, via: a.session.via } : null,
      role: a?.role || null, roleLabel: a ? ROLES[a.role] : null, perms: a ? permsOf(a.role) : [],
      entra: entraConfigured(), required: authRequired(), demoLogin: demoLoginAllowed(),
    });
  }

  // Demo role picker: lets a presenter show what each role sees. Needs the demo code.
  if (action === "demo" && req.method === "POST") {
    if (!demoLoginAllowed()) return json({ error: "demo login disabled" }, 403);
    if (!authorized(req)) return json({ error: "unauthorized" }, 401);
    let b = {};
    try { b = await req.json(); } catch {}
    if (!["metier", "dsi", "direction", "admin"].includes(b.role)) return json({ error: "invalid role" }, 400);
    const name = String(b.name || ROLES[b.role]).slice(0, 80), email = lower(b.email).slice(0, 120);
    const user = { sub: `demo:${email || b.role}`, name, email, role: b.role, via: "démo" };
    await audit({ session: user }, "connexion", { details: `Connexion de démonstration, rôle ${ROLES[b.role]}`, req });
    return json({ ok: true }, 200, { "set-cookie": await sessionCookie(user, 12 * 3600) });
  }

  if (action === "login") {
    if (!entraConfigured()) return json({ error: "Microsoft Entra ID n'est pas configuré" }, 404);
    return entraLoginRedirect(req);
  }

  if (action === "callback") {
    try {
      const u = await entraCallback(req);
      const role = roleFor(u, (await getConfig()).roles);
      const user = { sub: u.sub, name: u.name, email: u.email, role, via: "Microsoft Entra ID" };
      await audit({ session: user }, "connexion", { details: `Connexion Microsoft Entra ID, rôle ${ROLES[role]}`, req });
      const h = new Headers({ location: "/" });
      h.append("set-cookie", await sessionCookie(user));
      h.append("set-cookie", clearOidcCookie());
      return new Response(null, { status: 302, headers: h });
    } catch (e) {
      console.error("entra callback", e?.message);
      return new Response(`Connexion impossible : ${String(e?.message || e).replace(/[<>&]/g, "")}`, { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
  }

  if (action === "logout" && req.method === "POST") {
    const s = await getSession(req);
    if (s) await audit({ session: s }, "déconnexion", { req });
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  }

  return json({ error: "not found" }, 404);
};

export const config = { path: "/api/auth/:action", method: ["GET", "POST"], rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] } };
