// Optional demo gate: when DEMO_CODE is set, every API call must carry it in the x-demo-code header.
export function authorized(req) {
  const code = Netlify.env.get("DEMO_CODE");
  return !code || req.headers.get("x-demo-code") === code;
}
