import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { cleanText, processProductInput } from "@/lib/product-pipeline";

export async function GET(request: Request) {
  if (!env.DB) return NextResponse.json({ products: [], totals: {} });
  try {
    const url = new URL(request.url);
    const store = cleanText(url.searchParams.get("store"), 30);
    const status = cleanText(url.searchParams.get("status"), 30);
    const search = cleanText(url.searchParams.get("search"), 100);
    const clauses: string[] = [];
    const values: string[] = [];
    if (["amazon", "mercadolivre", "unknown"].includes(store)) { clauses.push("store = ?"); values.push(store); }
    if (["found", "converted", "waiting_credentials", "unsupported", "error", "sent"].includes(status)) { clauses.push("status = ?"); values.push(status); }
    if (search) { clauses.push("(title LIKE ? OR product_code LIKE ? OR source_url LIKE ?)"); values.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [products, totals] = await Promise.all([
      env.DB.prepare(`
        SELECT id, store, product_code AS productCode, title, image_url AS imageUrl,
          product_data_json AS productDataJson, data_source AS dataSource, source_url AS sourceUrl,
          resolved_url AS resolvedUrl, affiliate_url AS affiliateUrl, status, source_group AS sourceGroup,
          destination_group AS destinationGroup, message_excerpt AS messageExcerpt, redirect_count AS redirectCount,
          occurrences, error_message AS errorMessage, found_at AS foundAt, last_seen_at AS lastSeenAt,
          sent_at AS sentAt, updated_at AS updatedAt
        FROM product_events ${where} ORDER BY last_seen_at DESC LIMIT 100
      `).bind(...values).all(),
      env.DB.prepare(`SELECT status, COUNT(*) AS total FROM product_events GROUP BY status`).all(),
    ]);
    return NextResponse.json({ products: products.results, totals: Object.fromEntries(totals.results.map((row) => [String(row.status), Number(row.total)])) });
  } catch (error) {
    console.error("products.list", error);
    return NextResponse.json({ error: "O histórico de produtos não pôde ser carregado agora." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!env.DB) return NextResponse.json({ error: "Banco de dados indisponível." }, { status: 503 });
  const body = await request.json().catch(() => null) as { input?: unknown; sourceGroup?: unknown; destinationGroup?: unknown; cookies?: unknown } | null;
  const input = cleanText(body?.input, 8_000);
  if (!input) return NextResponse.json({ error: "Nenhuma mensagem foi informada." }, { status: 400 });
  try {
    const products = await processProductInput({
      message: input,
      sourceGroup: cleanText(body?.sourceGroup, 160),
      destinationGroup: cleanText(body?.destinationGroup, 160),
      cookies: typeof body?.cookies === "string" ? body.cookies : undefined,
    });
    if (!products.length) return NextResponse.json({ error: "Nenhum link foi encontrado na mensagem." }, { status: 400 });
    return NextResponse.json({ ok: true, products });
  } catch (error) {
    console.error("products.process", error);
    return NextResponse.json({ error: "Não foi possível resolver e salvar os produtos." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!env.DB) return NextResponse.json({ error: "Banco de dados indisponível." }, { status: 503 });
  const body = await request.json().catch(() => null) as { id?: unknown; status?: unknown; destinationGroup?: unknown } | null;
  const id = cleanText(body?.id, 80);
  const status = cleanText(body?.status, 30);
  if (!id || !["found", "converted", "waiting_credentials", "unsupported", "error", "sent"].includes(status)) {
    return NextResponse.json({ error: "Atualização inválida." }, { status: 400 });
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE product_events SET status = ?, destination_group = COALESCE(?, destination_group),
      sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END, updated_at = ? WHERE id = ?
  `).bind(status, cleanText(body?.destinationGroup, 160) || null, status, now, now, id).run();
  return NextResponse.json({ ok: true });
}
