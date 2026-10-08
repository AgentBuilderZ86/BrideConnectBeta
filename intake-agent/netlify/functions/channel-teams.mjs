import { handleIncoming, sendReplies } from "../lib/channels.mjs";
import { verifyTeamsRequest } from "../lib/adapters.mjs";

// Microsoft Teams bot endpoint (Azure Bot "messaging endpoint": https://<site>/api/channel/teams).
// Requires TEAMS_APP_ID and TEAMS_APP_PASSWORD (bot app registration), and TEAMS_TENANT_ID for a single-tenant bot.
export default async (req, context) => {
  let activity;
  try { activity = await req.json(); } catch { return new Response("bad request", { status: 400 }); }
  if (!(await verifyTeamsRequest(req, activity))) return new Response("unauthorized", { status: 401 });
  if (activity.type !== "message") return new Response(null, { status: 200 });
  const text = String(activity.text || "").replace(/<at>.*?<\/at>/g, "").trim();
  const ref = { serviceUrl: activity.serviceUrl, conversationId: activity.conversation?.id, tenantId: activity.conversation?.tenantId || activity.channelData?.tenant?.id };
  const sender = activity.from?.aadObjectId || activity.from?.id;
  context.waitUntil((async () => {
    try {
      const { conv, replies } = await handleIncoming({ channel: "teams", sender, name: activity.from?.name || "", text, ref });
      await sendReplies(conv, replies);
    } catch (e) { console.error("teams message error", e?.message); }
  })());
  return new Response(null, { status: 200 });
};

export const config = { path: "/api/channel/teams", method: "POST" };
