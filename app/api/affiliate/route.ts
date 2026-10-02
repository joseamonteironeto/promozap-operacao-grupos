import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";

const empty = {
  amazonTrackingId: "",
  mercadoLivreLabel: "",
  redirectDomain: "",
  amazonEnabled: true,
  mercadoLivreEnabled: false,
};

export async function GET() {
  if (!env.DB) return NextResponse.json({ settings: empty });
  const row = await env.DB.prepare(`
    SELECT amazon_tracking_id AS amazonTrackingId,
      mercado_livre_label AS mercadoLivreLabel,
      redirect_domain AS redirectDomain,
      amazon_enabled AS amazonEnabled,
      mercado_livre_enabled AS mercadoLivreEnabled
    FROM affiliate_settings WHERE id = 1
  `).first();
  return NextResponse.json({ settings: row ?? empty });
}

export async function PUT(request: Request) {
  if (!env.DB) return NextResponse.json({ error: "Banco de dados indisponível." }, { status: 503 });
  const body = await request.json() as typeof empty;
  await env.DB.prepare(`
    INSERT INTO affiliate_settings
      (id, amazon_tracking_id, mercado_livre_label, redirect_domain, amazon_enabled, mercado_livre_enabled, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      amazon_tracking_id = excluded.amazon_tracking_id,
      mercado_livre_label = excluded.mercado_livre_label,
      redirect_domain = excluded.redirect_domain,
      amazon_enabled = excluded.amazon_enabled,
      mercado_livre_enabled = excluded.mercado_livre_enabled,
      updated_at = excluded.updated_at
  `).bind(
    body.amazonTrackingId?.trim() ?? "",
    body.mercadoLivreLabel?.trim() ?? "",
    body.redirectDomain?.trim() ?? "",
    body.amazonEnabled ? 1 : 0,
    body.mercadoLivreEnabled ? 1 : 0,
    new Date().toISOString(),
  ).run();
  return NextResponse.json({ ok: true });
}
