import { access, can, guard } from "../lib/session.mjs";
import { getConfig, notice, noticeVersion } from "../lib/config.mjs";
import { exportSubject, eraseSubject, hashSubject } from "../lib/privacy.mjs";
import { audit } from "../lib/audit.mjs";

// Loi 09-08: information notice, consent record, right of access (export) and right of erasure.
// A signed-in person acts on their own data; administrators (and the demo role) may act for anyone.
const bad = (m, s = 400) => Response.json({ error: m }, { status: s });

export default async (req) => {
  const a = await access(req);
  if (!a) return bad("unauthorized", 401);
  const cfg = await getConfig();
  if (req.method === "GET") return Response.json({ notice: notice(cfg), short: notice(cfg, true), version: noticeVersion(cfg), conformite: cfg.conformite });

  let b;
  try { b = await req.json(); } catch { return bad("invalid json"); }
  if (b?.action === "consent") {
    await audit(a, "information acceptée", { details: `Notice loi 09-08 v${String(b.version || "").slice(0, 20)} lue et acceptée (${String(b.canal || "web").slice(0, 20)})`, req });
    return Response.json({ ok: true, version: noticeVersion(cfg) });
  }
  if (!["export", "erase"].includes(b?.action)) return bad("unknown action");

  // Whose data: the caller's own identity, plus the fiches they list (their browser's « Mes besoins »);
  // any other subject needs the privacy.admin right.
  const self = a.session ? { email: a.session.email, sub: a.session.sub, name: a.session.name } : {};
  let subject = { ...self, ficheIds: b.ficheIds };
  if (b.subject && typeof b.subject === "object") {
    const g = await guard(req, "privacy.admin");
    if (g.error) return g.error;
    subject = b.subject;
  } else if (!a.session && !can(a.role, "privacy.admin")) return bad("forbidden", 403);
  try {
    if (b.action === "export") {
      const data = await exportSubject(subject);
      await audit(a, "export de données personnelles", { details: `${data.fiches.length} fiche(s), ${data.conversations.length} conversation(s) — personne ${hashSubject(subject)}`, req });
      return Response.json(data);
    }
    const out = await eraseSubject(subject);
    await audit(a, "effacement de données personnelles", { details: `${out.fiches_anonymisees} fiche(s) anonymisée(s), ${out.brouillons_supprimes} brouillon(s) et ${out.conversations_supprimees} conversation(s) supprimés — personne ${hashSubject(subject)}`, req });
    return Response.json(out);
  } catch (e) { return bad(String(e?.message || e)); }
};

export const config = { path: "/api/privacy", method: ["GET", "POST"] };
