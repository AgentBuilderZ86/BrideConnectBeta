import { adminAuthorized } from "../lib/admin.mjs";
import { getConfigState, saveConfig, restoreVersion, saveEvalRun } from "../lib/config.mjs";

const bad = (m, s = 400) => Response.json({ error: m }, { status: s });

export default async (req) => {
  if (!adminAuthorized(req)) return bad("unauthorized", 401);
  if (req.method === "GET") return Response.json(await getConfigState());
  let b;
  try { b = await req.json(); } catch { return bad("invalid json"); }
  if (req.method === "PUT") {
    if (!b?.values || typeof b.values !== "object") return bad("values required");
    await saveConfig(b.values, b.note);
    return Response.json(await getConfigState());
  }
  if (req.method === "POST" && b?.restore) {
    const r = await restoreVersion(b.restore);
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
