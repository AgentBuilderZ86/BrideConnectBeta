import { guard } from "../lib/session.mjs";
import { listAudit } from "../lib/audit.mjs";

// Audit trail for administrators: GET /api/audit?days=30
export default async (req) => {
  const a = await guard(req, "audit.read");
  if (a.error) return a.error;
  const days = Math.max(1, Math.min(366, Number(new URL(req.url).searchParams.get("days")) || 30));
  return Response.json({ items: await listAudit({ days, limit: 500 }) });
};

export const config = { path: "/api/audit", method: "GET" };
