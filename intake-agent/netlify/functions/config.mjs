import { authorized } from "../lib/auth.mjs";
import { getConfig } from "../lib/config.mjs";

// Public part of the settings, used by the page (freshness durations, directions).
export default async (req) => {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const c = await getConfig();
  return Response.json({ ttl: c.ttl, seuils: c.seuils, directions: c.directions });
};

export const config = { path: "/api/config", method: "GET" };
