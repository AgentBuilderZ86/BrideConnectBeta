import { authorized } from "../lib/auth.mjs";
import { getPilotState, computeKpis } from "../lib/pilot.mjs";
import { listFiches } from "../lib/fiche.mjs";

export default async (req) => {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const offset = Math.max(0, Math.min(400, Number(new URL(req.url).searchParams.get("offsetDays")) || 0));
  const [state, all] = await Promise.all([getPilotState(), listFiches()]);
  return Response.json({ ...state, kpis: computeKpis(all, Date.now() + offset * 864e5) });
};

export const config = { path: "/api/pilot", method: "GET" };
