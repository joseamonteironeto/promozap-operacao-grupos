import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getAutomationButtonSettings, normalizeButtonLabels } from "@/lib/automation-buttons";

function authorized(request: Request) {
  const supplied = request.headers.get("x-promozap-admin-token") || "";
  const expected = (env as unknown as { UAZAPI_INSTANCE_TOKEN?: string }).UAZAPI_INSTANCE_TOKEN || "";
  if (!supplied || supplied.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < supplied.length; index += 1) difference |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

export async function GET() {
  return NextResponse.json({ settings: await getAutomationButtonSettings() });
}

export async function PUT(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Token administrativo inválido." }, { status: 401 });
  if (!env.DB) return NextResponse.json({ error: "Banco de dados indisponível." }, { status: 503 });
  const body = await request.json().catch(() => null) as { enabled?: unknown; labels?: unknown } | null;
  if (typeof body?.enabled !== "boolean" || !Array.isArray(body.labels)) {
    return NextResponse.json({ error: "Configuração inválida." }, { status: 400 });
  }
  const labels = normalizeButtonLabels(body.labels);
  if (body.enabled && labels.length === 0) {
    return NextResponse.json({ error: "Adicione pelo menos um texto para o botão." }, { status: 400 });
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO automation_button_settings (id, enabled, labels_json, updated_at)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, labels_json = excluded.labels_json, updated_at = excluded.updated_at
  `).bind(body.enabled ? 1 : 0, JSON.stringify(labels), now).run();
  return NextResponse.json({ ok: true, settings: { enabled: body.enabled, labels } });
}
