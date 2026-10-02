import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { resolveProductUrl } from "@/lib/link-resolver";

function affiliateUrl(resolvedUrl: string, asin: string | null, trackingId: string) {
  if (asin) return `https://www.amazon.com.br/dp/${asin}?tag=${encodeURIComponent(trackingId)}`;
  const url = new URL(resolvedUrl);
  url.searchParams.set("tag", trackingId);
  return url.toString();
}

export async function POST(request: Request) {
  if (!env.DB) return NextResponse.json({ ok: false, message: "Banco de dados indisponível." }, { status: 503 });
  const body = await request.json() as { urls?: string[] };
  const urls = [...new Set((Array.isArray(body.urls) ? body.urls : []).map((url) => String(url).trim()).filter(Boolean))].slice(0, 20);
  if (!urls.length) return NextResponse.json({ ok: false, message: "Cole ao menos um link da Amazon." }, { status: 400 });

  const settings = await env.DB.prepare(`
    SELECT amazon_tracking_id AS trackingId, amazon_enabled AS enabled
    FROM affiliate_settings WHERE id = 1
  `).first<{ trackingId: string; enabled: number }>();
  if (!settings?.enabled || !settings.trackingId) {
    return NextResponse.json({ ok: false, message: "Ative a Amazon e informe seu Tracking ID na aba Afiliados." }, { status: 412 });
  }

  const results = [];
  for (const originUrl of urls) {
    const resolved = await resolveProductUrl(originUrl);
    if (resolved.store !== "amazon") {
      results.push({ originUrl, ok: false, message: resolved.errorMessage || "O destino não pertence à Amazon Brasil." });
      continue;
    }
    results.push({
      originUrl,
      ok: true,
      asin: resolved.productCode,
      title: resolved.title,
      resolvedUrl: resolved.resolvedUrl,
      affiliateUrl: affiliateUrl(resolved.resolvedUrl, resolved.productCode, settings.trackingId),
      redirectCount: resolved.redirectCount,
    });
  }

  const converted = results.filter((item) => item.ok).length;
  return NextResponse.json({
    ok: converted > 0,
    trackingId: settings.trackingId,
    message: `${converted} de ${results.length} link(s) convertido(s).`,
    results,
  }, { status: converted > 0 ? 200 : 422 });
}
