import { env } from "cloudflare:workers";

type LogLevel = "info" | "success" | "warning" | "error";

function safeDetails(details: Record<string, unknown> | undefined) {
  if (!details) return null;
  try {
    return JSON.stringify(details, (_key, value) => {
      if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}…`;
      return value;
    }).slice(0, 4_000);
  } catch {
    return null;
  }
}

export async function automationLog(input: {
  level?: LogLevel;
  stage: string;
  message: string;
  details?: Record<string, unknown>;
  groupJid?: string | null;
  productId?: string | null;
}) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`
      INSERT INTO automation_logs (id, level, stage, message, details_json, group_jid, product_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), input.level || "info", input.stage.slice(0, 60), input.message.slice(0, 500),
      safeDetails(input.details), input.groupJid || null, input.productId || null, new Date().toISOString(),
    ).run();
  } catch {
    // Logging must never interrupt message processing.
  }
}
