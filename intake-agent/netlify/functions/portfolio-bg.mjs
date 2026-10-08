import { authorized } from "../lib/auth.mjs";
import { buildPortfolio } from "../lib/portfolio.mjs";
import { pilotStore } from "../lib/pilot.mjs";

// Builds the portfolio in the background (can take more than a minute on a large queue).
export default async (req) => {
  if (!authorized(req)) return;
  const s = pilotStore();
  await s.setJSON("portfolio-running", { since: new Date().toISOString() });
  try { await buildPortfolio(); await s.delete("portfolio-error"); }
  catch (e) { console.error("portfolio error", e?.message); await s.setJSON("portfolio-error", { at: new Date().toISOString(), message: String(e?.message || e).slice(0, 300) }); }
  finally { await s.delete("portfolio-running"); }
};

export const config = { path: "/api/portfolio-bg", method: "POST", background: true };
