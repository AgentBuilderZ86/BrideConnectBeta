// Every Monday at 07:00 Morocco time (06:00 UTC; Morocco is UTC+1 outside Ramadan).
export default async (req, context) => {
  const base = context?.site?.url || Netlify.env.get("URL");
  await fetch(`${base}/api/pilot-bg`, {
    method: "POST", headers: { "content-type": "application/json", "x-pilot-secret": Netlify.env.get("PILOT_SECRET") || "" },
    body: JSON.stringify({ job: "weekly" }),
  });
};

export const config = { schedule: "0 6 * * 1" };
