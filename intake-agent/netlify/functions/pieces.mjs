import { access, can } from "../lib/session.mjs";
import { getPiece } from "../lib/pieces.mjs";
import { audit } from "../lib/audit.mjs";

// Downloads an attachment. DSI, Direction and admins see every file; a requester sees the files they sent.
export default async (req, context) => {
  const a = await access(req);
  if (!a) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await getPiece(context.params?.id);
  if (!p) return Response.json({ error: "not found" }, { status: 404 });
  if (!can(a.role, "fiche.read") && !(a.session && p.sub && p.sub === a.session.sub)) return Response.json({ error: "forbidden" }, { status: 403 });
  await audit(a, "pièce consultée", { target: { id: context.params.id, titre: p.name }, req });
  return new Response(p.data, { headers: {
    "content-type": p.mime, "cache-control": "private, no-store", "x-content-type-options": "nosniff",
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(p.name)}`,
  } });
};

export const config = { path: "/api/pieces/:id", method: "GET" };
