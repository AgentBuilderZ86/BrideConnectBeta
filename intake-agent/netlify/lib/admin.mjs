import { authorized } from "./auth.mjs";

// Admin actions need the demo code, plus ADMIN_CODE (x-admin-code header) when that variable is set.
export function adminAuthorized(req) {
  if (!authorized(req)) return false;
  const code = Netlify.env.get("ADMIN_CODE");
  return !code || req.headers.get("x-admin-code") === code;
}
