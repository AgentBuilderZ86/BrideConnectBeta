import { internalToken } from "./session.mjs";

// Starts one of our background functions (answers 202 at once; the job runs up to 15 minutes).
export async function triggerBg(origin, path, body) {
  if (!origin) return false;
  try {
    const r = await fetch(new URL(path, origin), { method: "POST", headers: { "content-type": "application/json", "x-internal": await internalToken() }, body: JSON.stringify(body || {}) });
    return r.ok;
  } catch (e) { console.error("background trigger", path, e?.message); return false; }
}
