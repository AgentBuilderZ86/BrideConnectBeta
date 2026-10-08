const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Builds the Messages API turns for the intake agent: a context turn, the prior conversation,
// then the new message (with optional attachment blocks, or a single image), merging consecutive turns of the same role.
export function buildIntakeMessages({ context, history, message, image, blocks }) {
  const turns = [];
  const push = (role, content) => {
    const last = turns[turns.length - 1];
    if (last && last.role === role && typeof last.content === "string" && typeof content === "string") last.content += "\n\n" + content;
    else turns.push({ role, content });
  };
  push("user", String(context || "").slice(0, 3000) || "CONTEXTE : (aucun)");
  for (const t of (Array.isArray(history) ? history.slice(-30) : [])) {
    if (!t || (t.role !== "user" && t.role !== "assistant") || typeof t.content !== "string" || !t.content.trim()) continue;
    push(t.role, t.content.slice(0, 8000));
  }
  const text = String(message || "").slice(0, 30000);
  if (!text.trim()) return null;
  const extra = Array.isArray(blocks) ? [...blocks] : [];
  if (image && IMAGE_TYPES.has(image.media_type) && typeof image.data === "string" && image.data.length < 4_500_000) {
    extra.push({ type: "image", source: { type: "base64", media_type: image.media_type, data: image.data } });
  }
  if (extra.length) {
    const content = [...extra, { type: "text", text }];
    const last = turns[turns.length - 1];
    if (last.role === "user") last.content = [{ type: "text", text: last.content }, ...content];
    else turns.push({ role: "user", content });
  } else push("user", text);
  return turns;
}
