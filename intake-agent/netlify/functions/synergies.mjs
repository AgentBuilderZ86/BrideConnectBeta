import { guard } from "../lib/session.mjs";
import { pilotStore } from "../lib/pilot.mjs";

// Latest duplicates / synergies review, with the background job status.
export default async (req) => {
  const a = await guard(req, "portfolio.read");
  if (a.error) return a.error;
  const s = pilotStore();
  const [synergies, running, error] = await Promise.all([s.get("synergies", { type: "json" }), s.get("synergies-running", { type: "json" }), s.get("synergies-error", { type: "json" })]);
  return Response.json({ synergies: synergies || null, running: running || null, error: error || null });
};

export const config = { path: "/api/synergies", method: "GET" };
