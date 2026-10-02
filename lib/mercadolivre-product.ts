import { env } from "cloudflare:workers";
import { parseMercadoLivreCookies } from "@/lib/mercadolivre-affiliate";

type MercadoLivreProductVisual = {
  title: string | null;
  imageUrl: string | null;
  source: "mercadolivre_items_api" | "mercadolivre_catalog_api" | "product_page" | null;
  details: Record<string, unknown> | null;
};

function compactApiData(value: Record<string, unknown>) {
  const pictures = Array.isArray(value.pictures) ? value.pictures.slice(0, 12) : [];
  const attributes = Array.isArray(value.attributes) ? value.attributes.slice(0, 60) : [];
  const saleTerms = Array.isArray(value.sale_terms) ? value.sale_terms.slice(0, 30) : [];
  return {
    id: value.id,
    siteId: value.site_id,
    title: value.title || value.name,
    familyName: value.family_name,
    status: value.status,
    domainId: value.domain_id,
    categoryId: value.category_id,
    sellerId: value.seller_id,
    officialStoreId: value.official_store_id,
    price: value.price,
    basePrice: value.base_price,
    originalPrice: value.original_price,
    currencyId: value.currency_id,
    availableQuantity: value.available_quantity,
    soldQuantity: value.sold_quantity,
    condition: value.condition,
    catalogProductId: value.catalog_product_id,
    parentId: value.parent_id,
    permalink: value.permalink,
    buyingMode: value.buying_mode,
    listingTypeId: value.listing_type_id,
    warranty: value.warranty,
    health: value.health,
    shipping: value.shipping,
    settings: value.settings,
    tags: value.tags,
    pictures,
    attributes,
    saleTerms,
  };
}

async function getOfficialApiProduct(productCode: string, resolvedUrl: string) {
  const token = (env as unknown as { MERCADOLIVRE_ACCESS_TOKEN?: string }).MERCADOLIVRE_ACCESS_TOKEN;
  const likelyCatalog = /\/p\/MLB\d+/i.test(resolvedUrl);
  const endpoints = likelyCatalog
    ? [["mercadolivre_catalog_api", `https://api.mercadolibre.com/products/${productCode}`], ["mercadolivre_items_api", `https://api.mercadolibre.com/items/${productCode}`]]
    : [["mercadolivre_items_api", `https://api.mercadolibre.com/items/${productCode}`], ["mercadolivre_catalog_api", `https://api.mercadolibre.com/products/${productCode}`]];
  for (const [source, endpoint] of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) continue;
      const data = await response.json() as Record<string, unknown>;
      const picture = Array.isArray(data.pictures) ? data.pictures[0] as Record<string, unknown> | undefined : undefined;
      const imageUrl = safeOfficialImage(typeof picture?.secure_url === "string" ? picture.secure_url : typeof picture?.url === "string" ? picture.url : null);
      return {
        title: typeof data.title === "string" ? data.title : typeof data.name === "string" ? data.name : null,
        imageUrl,
        source: source as "mercadolivre_items_api" | "mercadolivre_catalog_api",
        details: compactApiData(data),
      };
    } catch {
      // Tenta o outro recurso oficial e, depois, a página pública.
    }
  }
  return null;
}

function decodeHtml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("\\/", "/")
    .trim();
}

function metaContent(html: string, property: string) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const first = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)`, "i"));
  const second = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"));
  return decodeHtml(first?.[1] || second?.[1] || "") || null;
}

function safeOfficialImage(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(decodeHtml(value));
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (!host.endsWith(".mlstatic.com") && host !== "mlstatic.com" && !host.endsWith(".mercadolivre.com.br")) return null;
    return url.href;
  } catch {
    return null;
  }
}

function extractVisual(html: string): MercadoLivreProductVisual {
  const ogImage = safeOfficialImage(metaContent(html, "og:image"));
  const jsonImage = html.match(/"image"\s*:\s*(?:\[\s*)?"(https:[^"]+)"/i)?.[1] || null;
  const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || null;
  return {
    title: metaContent(html, "og:title") || (titleTag ? decodeHtml(titleTag) : null),
    imageUrl: ogImage || safeOfficialImage(jsonImage),
    source: ogImage || safeOfficialImage(jsonImage) ? "product_page" : null,
    details: null,
  };
}

async function limitedText(response: Response, maxBytes = 1_200_000) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - size;
    chunks.push(value.length > remaining ? value.slice(0, remaining) : value);
    size += Math.min(value.length, remaining);
    if (size >= maxBytes) await reader.cancel();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(output);
}

export async function getMercadoLivreProductVisual(
  productCode: string,
  resolvedUrl: string,
  cookies?: string,
): Promise<MercadoLivreProductVisual> {
  if (!/^MLB\d{7,}$/i.test(productCode)) return { title: null, imageUrl: null, source: null, details: null };
  const official = await getOfficialApiProduct(productCode.toUpperCase(), resolvedUrl);
  if (official) return official;
  const numericId = productCode.slice(3);
  const session = cookies ? parseMercadoLivreCookies(cookies) : null;
  const urls = [...new Set([
    resolvedUrl,
    `https://www.mercadolivre.com.br/p/${productCode.toUpperCase()}`,
    `https://produto.mercadolivre.com.br/MLB-${numericId}`,
  ])];
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          ...(session ? { Cookie: session.header } : {}),
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok || !(response.headers.get("content-type") || "").includes("text/html")) continue;
      const visual = extractVisual(await limitedText(response));
      if (visual.imageUrl) return visual;
    } catch {
      // Try the other official URL format before falling back to the received image.
    }
  }
  return { title: null, imageUrl: null, source: null, details: null };
}
