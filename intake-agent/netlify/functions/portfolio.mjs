import { guard } from "../lib/session.mjs";
import { pilotStore } from "../lib/pilot.mjs";

// Latest portfolio / roadmap proposal, with the background build status.
export default async (req) => {
  const a = await guard(req, "portfolio.read");
  if (a.error) return a.error;
  const s = pilotStore();
  const [portfolio, running, error] = await Promise.all([s.get("portfolio", { type: "json" }), s.get("portfolio-running", { type: "json" }), s.get("portfolio-error", { type: "json" })]);
  return Response.json({ portfolio: portfolio || null, running: running || null, error: error || null });
};

export const config = { path: "/api/portfolio", method: "GET" };
