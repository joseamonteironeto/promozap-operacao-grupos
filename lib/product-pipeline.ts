import { env } from "cloudflare:workers";
import { getAmazonProductVisual } from "@/lib/amazon-product";
import { extractUrls, resolveProductUrl } from "@/lib/link-resolver";
import { generateMercadoLivreLinks } from "@/lib/mercadolivre-affiliate";
import { getMercadoLivreProductVisual } from "@/lib/mercadolivre-product";
import { readIntegrationSecret, saveIntegrationSecret } from "@/lib/integration-secret";

export type ProductStatus = "found" | "converted" | "waiting_credentials" | "unsupported" | "error" | "sent";

export type SavedProduct = {
  id: string;
  store: string;
  productCode: string | null;
  title: string | null;
  imageUrl: string | null;
  productDataJson: string | null;
  dataSource: string | null;
  sourceUrl: string;
  resolvedUrl: string | null;
  affiliateUrl: string | null;
  status: ProductStatus;
  sourceGroup: string | null;
  destinationGroup: string | null;
  messageExcerpt: string | null;
  redirectCount: number;
  occurrences: number;
  errorMessage: string | null;
  foundAt: string;
  lastSeenAt: string;
  sentAt: string | null;
  updatedAt: string;
  imageSource?: "amazon_catalog" | "mercadolivre_catalog" | "original" | "resolved" | null;
};

export function cleanText(value: unknown, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function fingerprint(store: string, productCode: string | null, sourceUrl: string) {
  const value = productCode ? `${store}:${productCode}` : `url:${sourceUrl}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

async function getAffiliateSettings() {
  if (!env.DB) return null;
  return env.DB.prepare(`
    SELECT amazon_tracking_id AS amazonTrackingId,
      mercado_livre_label AS mercadoLivreLabel,
      amazon_enabled AS amazonEnabled,
      mercado_livre_enabled AS mercadoLivreEnabled
    FROM affiliate_settings WHERE id = 1
  `).first<{ amazonTrackingId: string; mercadoLivreLabel: string; amazonEnabled: number; mercadoLivreEnabled: number }>();
}

async function saveProduct(product: {
  sourceUrl: string; resolvedUrl: string; affiliateUrl: string | null; store: string; productCode: string | null;
  title: string | null; imageUrl: string | null; status: ProductStatus; sourceGroup: string; destinationGroup: string;
  productDataJson: string | null; dataSource: string | null; messageExcerpt: string; redirectCount: number; errorMessage: string | null;
}) {
  if (!env.DB) throw new Error("Banco de dados indisponível.");
  const now = new Date().toISOString();
  const key = await fingerprint(product.store, product.productCode, product.sourceUrl);
  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO product_events
      (id, fingerprint, store, product_code, title, image_url, product_data_json, data_source, source_url, resolved_url, affiliate_url, status,
       source_group, destination_group, message_excerpt, redirect_count, occurrences, error_message, found_at, last_seen_at, sent_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, ?)
    ON CONFLICT(fingerprint) DO UPDATE SET
      store = excluded.store,
      product_code = COALESCE(excluded.product_code, product_events.product_code),
      title = COALESCE(excluded.title, product_events.title),
      image_url = COALESCE(excluded.image_url, product_events.image_url),
      product_data_json = COALESCE(excluded.product_data_json, product_events.product_data_json),
      data_source = COALESCE(excluded.data_source, product_events.data_source),
      source_url = excluded.source_url,
      resolved_url = excluded.resolved_url,
      affiliate_url = COALESCE(excluded.affiliate_url, product_events.affiliate_url),
      status = CASE WHEN product_events.status = 'sent' AND excluded.status = 'converted' THEN 'converted' ELSE excluded.status END,
      source_group = COALESCE(excluded.source_group, product_events.source_group),
      destination_group = COALESCE(excluded.destination_group, product_events.destination_group),
      message_excerpt = excluded.message_excerpt,
      redirect_count = excluded.redirect_count,
      occurrences = product_events.occurrences + 1,
      error_message = excluded.error_message,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at
  `).bind(
    id, key, product.store, product.productCode, product.title, product.imageUrl, product.productDataJson, product.dataSource, product.sourceUrl, product.resolvedUrl,
    product.affiliateUrl, product.status, product.sourceGroup || null, product.destinationGroup || null,
    product.messageExcerpt || null, product.redirectCount, product.errorMessage, now, now, now,
  ).run();
  return env.DB.prepare(`
    SELECT id, store, product_code AS productCode, title, image_url AS imageUrl,
      product_data_json AS productDataJson, data_source AS dataSource, source_url AS sourceUrl,
      resolved_url AS resolvedUrl, affiliate_url AS affiliateUrl, status, source_group AS sourceGroup,
      destination_group AS destinationGroup, message_excerpt AS messageExcerpt, redirect_count AS redirectCount,
      occurrences, error_message AS errorMessage, found_at AS foundAt, last_seen_at AS lastSeenAt,
      sent_at AS sentAt, updated_at AS updatedAt
    FROM product_events WHERE fingerprint = ?
  `).bind(key).first<SavedProduct>();
}

export async function processProductInput(input: {
  message: string;
  sourceGroup?: string;
  destinationGroup?: string;
  cookies?: string;
  originalImageUrl?: string;
}) {
  if (!env.DB) throw new Error("Banco de dados indisponível.");
  const message = cleanText(input.message, 8_000);
  const urls = extractUrls(message);
  if (!urls.length) return [];
  const settings = await getAffiliateSettings();
  const runtime = env as unknown as { MERCADOLIVRE_SESSION_COOKIES?: string };
  const storedCookies = input.cookies?.trim() ? null : await readIntegrationSecret("mercadolivre_session_cookies");
  let cookies = input.cookies?.trim() || storedCookies || runtime.MERCADOLIVRE_SESSION_COOKIES;
  const saved: SavedProduct[] = [];

  for (const sourceUrl of urls) {
    const resolved = await resolveProductUrl(sourceUrl);
    const mercadoLivreVisual = resolved.store === "mercadolivre" && resolved.productCode
      ? await getMercadoLivreProductVisual(resolved.productCode, resolved.resolvedUrl, cookies)
      : null;
    const amazonVisual = resolved.store === "amazon" && resolved.productCode
      ? await getAmazonProductVisual(resolved.productCode, resolved.resolvedUrl)
      : null;
    const productVisual = mercadoLivreVisual || amazonVisual;
    let affiliateUrl: string | null = null;
    let status: ProductStatus = resolved.store === "unknown" ? "unsupported" : "found";
    let errorMessage = resolved.errorMessage;

    if (resolved.store === "amazon" && settings?.amazonEnabled && settings.amazonTrackingId) {
      if (resolved.productCode) {
        affiliateUrl = `https://www.amazon.com.br/dp/${resolved.productCode}?tag=${encodeURIComponent(settings.amazonTrackingId)}`;
      } else {
        try {
          const tagged = new URL(resolved.resolvedUrl);
          tagged.searchParams.set("tag", settings.amazonTrackingId);
          affiliateUrl = tagged.toString();
        } catch {
          affiliateUrl = null;
        }
      }
      status = "converted";
      errorMessage = null;
    } else if (resolved.store === "mercadolivre" && resolved.productCode && settings?.mercadoLivreEnabled && settings.mercadoLivreLabel) {
      if (!cookies) {
        status = "waiting_credentials";
        errorMessage = "Informe os cookies da sessão do Mercado Livre para gerar o link.";
      } else {
        const generated = await generateMercadoLivreLinks([resolved.resolvedUrl], settings.mercadoLivreLabel, cookies);
        if (generated.refreshedCookies) {
          cookies = generated.refreshedCookies;
          await saveIntegrationSecret("mercadolivre_session_cookies", generated.refreshedCookies);
        }
        if (generated.ok && generated.results[0]) {
          affiliateUrl = generated.results[0].short_url || generated.results[0].long_url || null;
          status = affiliateUrl ? "converted" : "error";
          errorMessage = affiliateUrl ? null : "O Mercado Livre não retornou o link gerado.";
        } else {
          status = "waiting_credentials";
          errorMessage = generated.message;
        }
      }
    }

    const record = await saveProduct({
      ...resolved,
      title: productVisual?.title || resolved.title,
      imageUrl: productVisual?.imageUrl || cleanText(input.originalImageUrl, 4_000) || resolved.imageUrl,
      productDataJson: productVisual?.details ? JSON.stringify(productVisual.details).slice(0, 60_000) : null,
      dataSource: productVisual?.source || null,
      affiliateUrl,
      status,
      sourceGroup: cleanText(input.sourceGroup, 160),
      destinationGroup: cleanText(input.destinationGroup, 160),
      messageExcerpt: message.slice(0, 4_000),
      errorMessage,
    });
    if (record) {
      saved.push({
        ...record,
        imageSource: productVisual?.imageUrl
          ? resolved.store === "amazon" ? "amazon_catalog" : "mercadolivre_catalog"
          : cleanText(input.originalImageUrl, 4_000) ? "original"
          : resolved.imageUrl ? "resolved"
          : null,
      });
    }
  }
  return saved;
}

export async function markProductsSent(ids: string[], destinationGroup: string) {
  if (!env.DB || !ids.length) return;
  const now = new Date().toISOString();
  const statements = ids.map((id) => env.DB!.prepare(`
    UPDATE product_events SET status = 'sent', destination_group = ?, sent_at = ?, updated_at = ? WHERE id = ?
  `).bind(destinationGroup || null, now, now, id));
  await env.DB.batch(statements);
}
