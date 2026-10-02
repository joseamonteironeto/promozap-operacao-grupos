import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";

type GroupConfig = {
  jid: string;
  name: string;
  role: "source" | "destination" | "ignored";
  category: string;
  destinationJid?: string | null;
  enabled: boolean;
};

export async function GET() {
  if (!env.DB) return NextResponse.json({ configs: [] });
  const result = await env.DB.prepare("SELECT jid, name, role, category, destination_jid AS destinationJid, enabled FROM group_configs ORDER BY name").all();
  return NextResponse.json({ configs: result.results ?? [] });
}

export async function PUT(request: Request) {
  if (!env.DB) return NextResponse.json({ error: "Banco de dados indisponível." }, { status: 503 });
  const body = await request.json() as { configs?: GroupConfig[] };
  const configs = Array.isArray(body.configs) ? body.configs : [];
  const now = new Date().toISOString();
  const statements = configs.map((item) => env.DB!.prepare(`
    INSERT INTO group_configs (jid, name, role, category, destination_jid, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET
      name = excluded.name,
      role = excluded.role,
      category = excluded.category,
      destination_jid = excluded.destination_jid,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).bind(item.jid, item.name, item.role, item.category || "geral", item.destinationJid || null, item.enabled ? 1 : 0, now));

  if (statements.length) await env.DB.batch(statements);
  return NextResponse.json({ ok: true, saved: statements.length });
}
