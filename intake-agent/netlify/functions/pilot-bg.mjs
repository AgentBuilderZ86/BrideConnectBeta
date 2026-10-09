import { guard } from "../lib/session.mjs";
import { audit } from "../lib/audit.mjs";
import { runDaily, runWeekly, pilotStore } from "../lib/pilot.mjs";

// Background worker (up to 15 min) for the autopilot. Called by the scheduled functions
// with x-pilot-secret, or from the DSI page ("Lancer maintenant") with the demo code.
export default async (req) => {
  const secret = Netlify.env.get("PILOT_SECRET");
  const bySchedule = !!secret && req.headers.get("x-pilot-secret") === secret;
  if (!bySchedule) {
    const a = await guard(req, "pilot.run");
    if (a.error) return;
    await audit(a, "pilotage lancé à la main", { req });
  }
  let b = {};
  try { b = await req.json(); } catch {}
  const offsetDays = Math.max(0, Math.min(400, Number(b.offsetDays) || 0));
  const trigger = bySchedule ? "planifié" : "manuel";
  const s = pilotStore();
  await s.setJSON("running", { job: b.job, since: new Date().toISOString() });
  try {
    if (b.job === "weekly") await runWeekly({ offsetDays, trigger });
    else await runDaily({ offsetDays, trigger });
  } catch (e) {
    console.error("pilot error", e?.message);
    const log = (await s.get("runs", { type: "json" })) || [];
    log.unshift({ job: b.job || "daily", at: new Date().toISOString(), trigger, erreur: String(e?.message || e).slice(0, 300) });
    await s.setJSON("runs", log.slice(0, 40));
  } finally {
    await s.delete("running");
  }
};

export const config = { path: "/api/pilot-bg", method: "POST", background: true };
