import { guard } from "./session.mjs";

// Admin actions: the Administrateur role. Without a session (demo role), ADMIN_CODE (x-admin-code header)
// is also required when that variable is set.
export async function adminGuard(req) {
  const a = await guard(req, "admin");
  if (a.error) return a;
  const code = Netlify.env.get("ADMIN_CODE");
  if (a.role === "demo" && code && req.headers.get("x-admin-code") !== code) return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  return a;
}
