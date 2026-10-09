import { guard } from "../lib/session.mjs";
import { getPilotState, computeKpis } from "../lib/pilot.mjs";
import { listFiches } from "../lib/fiche.mjs";
import { getConfig } from "../lib/config.mjs";

export default async (req) => {
  const a = await guard(req, "pilot.read");
  if (a.error) return a.error;
  const offset = Math.max(0, Math.min(400, Number(new URL(req.url).searchParams.get("offsetDays")) || 0));
  const [state, all, cfg] = await Promise.all([getPilotState(), listFiches(), getConfig()]);
  return Response.json({ ...state, kpis: computeKpis(all, Date.now() + offset * 864e5, cfg) });
};

export const config = { path: "/api/pilot", method: "GET" };
