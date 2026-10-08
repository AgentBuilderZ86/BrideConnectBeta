import { adminGuard } from "../lib/admin.mjs";
import { audit } from "../lib/audit.mjs";
import { getConfigState, saveConfig, restoreVersion, saveEvalRun } from "../lib/config.mjs";

const bad = (m, s = 400) => Response.json({ error: m }, { status: s });

export default async (req) => {
  const a = await adminGuard(req);
  if (a.error) return a.error;
  if (req.method === "GET") return Response.json(await getConfigState());
  let b;
  try { b = await req.json(); } catch { return bad("invalid json"); }
  if (req.method === "PUT") {
    if (!b?.values || typeof b.values !== "object") return bad("values required");
    const v = await saveConfig(b.values, b.note);
    await audit(a, "réglages enregistrés", { details: `version ${v.version}${v.note ? ` : ${v.note}` : ""}`, req });
    return Response.json(await getConfigState());
  }
  if (req.method === "POST" && b?.restore) {
    const r = await restoreVersion(b.restore);
    if (r) await audit(a, "réglages restaurés", { details: `version ${b.restore} → ${r.version}`, req });
    return r ? Response.json(await getConfigState()) : bad("version not found", 404);
  }
  if (req.method === "POST" && b?.evalrun) {
    const run = b.evalrun;
    await saveEvalRun({ at: new Date().toISOString(), version: Number(run.version) || null, draft: !!run.draft, results: (run.results || []).slice(0, 20) });
    return Response.json(await getConfigState());
  }
  return bad("unknown action");
};

export const config = { path: "/api/admin/config", method: ["GET", "PUT", "POST"] };
