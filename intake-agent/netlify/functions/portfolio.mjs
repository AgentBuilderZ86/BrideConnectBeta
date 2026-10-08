import { authorized } from "../lib/auth.mjs";
import { pilotStore } from "../lib/pilot.mjs";

// Latest portfolio / roadmap proposal, with the background build status.
export default async (req) => {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const s = pilotStore();
  const [portfolio, running, error] = await Promise.all([s.get("portfolio", { type: "json" }), s.get("portfolio-running", { type: "json" }), s.get("portfolio-error", { type: "json" })]);
  return Response.json({ portfolio: portfolio || null, running: running || null, error: error || null });
};

export const config = { path: "/api/portfolio", method: "GET" };
