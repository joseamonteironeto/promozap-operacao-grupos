import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  if (!env.DB) return NextResponse.json({ logs: [] });
  const requested = Number(new URL(request.url).searchParams.get("limit") || 100);
  const limit = Math.max(10, Math.min(250, Number.isFinite(requested) ? requested : 100));
  try {
    const result = await env.DB.prepare(`
      SELECT id, level, stage, message, details_json AS detailsJson, group_jid AS groupJid,
        product_id AS productId, created_at AS createdAt
      FROM automation_logs ORDER BY created_at DESC LIMIT ?
    `).bind(limit).all();
    return NextResponse.json({ logs: result.results || [] });
  } catch (error) {
    console.error("logs.list", error);
    return NextResponse.json({ error: "Os logs ainda não estão disponíveis." }, { status: 500 });
  }
}
