import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getAmazonProductVisual } from "@/lib/amazon-product";
import { getMercadoLivreProductVisual } from "@/lib/mercadolivre-product";
import { readIntegrationSecret } from "@/lib/integration-secret";

export async function POST(request: Request) {
  const runtime = env as unknown as { UAZAPI_INSTANCE_TOKEN?: string; MERCADOLIVRE_SESSION_COOKIES?: string };
  const adminToken = request.headers.get("x-promozap-admin-token") || "";
  if (!runtime.UAZAPI_INSTANCE_TOKEN || adminToken !== runtime.UAZAPI_INSTANCE_TOKEN) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  if (!env.DB) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id.trim().slice(0, 80) : "";
  if (!id) return NextResponse.json({ error: "Produto inválido." }, { status: 400 });

  const product = await env.DB.prepare(`
    SELECT id, store, product_code AS productCode, resolved_url AS resolvedUrl
    FROM product_events WHERE id = ?
  `).bind(id).first<{ id: string; store: string; productCode: string | null; resolvedUrl: string | null }>();
  if (!product?.productCode || !product.resolvedUrl || !["amazon", "mercadolivre"].includes(product.store)) {
    return NextResponse.json({ error: "Este registro não possui um produto compatível." }, { status: 422 });
  }

  const cookies = product.store === "mercadolivre"
    ? await readIntegrationSecret("mercadolivre_session_cookies") || runtime.MERCADOLIVRE_SESSION_COOKIES
    : undefined;
  const visual = product.store === "amazon"
    ? await getAmazonProductVisual(product.productCode, product.resolvedUrl)
    : await getMercadoLivreProductVisual(product.productCode, product.resolvedUrl, cookies);
  if (!visual.details && !visual.imageUrl && !visual.title) {
    return NextResponse.json({ error: "A loja não retornou dados adicionais agora." }, { status: 502 });
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE product_events SET title = COALESCE(?, title), image_url = COALESCE(?, image_url),
      product_data_json = COALESCE(?, product_data_json), data_source = COALESCE(?, data_source), updated_at = ?
    WHERE id = ?
  `).bind(
    visual.title,
    visual.imageUrl,
    visual.details ? JSON.stringify(visual.details).slice(0, 60_000) : null,
    visual.source,
    now,
    id,
  ).run();
  return NextResponse.json({ ok: true, source: visual.source });
}
