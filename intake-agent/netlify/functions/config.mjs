import { guard } from "../lib/session.mjs";
import { getConfig } from "../lib/config.mjs";

// Public part of the settings, used by the page (freshness durations, directions).
export default async (req) => {
  const a = await guard(req);
  if (a.error) return a.error;
  const c = await getConfig();
  return Response.json({ ttl: c.ttl, seuils: c.seuils, directions: c.directions });
};

export const config = { path: "/api/config", method: "GET" };
