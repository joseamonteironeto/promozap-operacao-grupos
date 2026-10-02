type AmazonProductVisual = {
  title: string | null;
  imageUrl: string | null;
  source: "product_page" | null;
  details: Record<string, unknown> | null;
};

function productJsonLd(html: string) {
  const scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const raw = script.replace(/^.*?>/s, "").replace(/<\/script>$/i, "").trim();
    try {
      const parsed = JSON.parse(raw) as unknown;
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const candidate of candidates) {
        const item = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : null;
        if (item && (item["@type"] === "Product" || (Array.isArray(item["@type"]) && item["@type"].includes("Product")))) return item;
        const graph = item && Array.isArray(item["@graph"]) ? item["@graph"] : [];
        const product = graph.find((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>)["@type"] === "Product");
        if (product) return product as Record<string, unknown>;
      }
    } catch {
      // Ignora JSON-LD inválido e tenta o próximo bloco.
    }
  }
  return null;
}

function compactAmazonData(data: Record<string, unknown> | null, asin: string) {
  if (!data) return { asin, apiStatus: "credentials_required", apiNote: "A Creators API exige Credential ID, Credential Secret e Partner Tag." };
  const brand = data.brand && typeof data.brand === "object" ? (data.brand as Record<string, unknown>).name : data.brand;
  const offers = Array.isArray(data.offers) ? data.offers[0] : data.offers;
  const rating = data.aggregateRating && typeof data.aggregateRating === "object" ? data.aggregateRating as Record<string, unknown> : null;
  return {
    asin,
    name: data.name,
    brand,
    description: data.description,
    sku: data.sku,
    mpn: data.mpn,
    gtin: data.gtin || data.gtin13 || data.gtin12,
    category: data.category,
    color: data.color,
    size: data.size,
    material: data.material,
    model: data.model,
    images: Array.isArray(data.image) ? data.image.slice(0, 12) : data.image ? [data.image] : [],
    offers,
    aggregateRating: rating ? { ratingValue: rating.ratingValue, reviewCount: rating.reviewCount, ratingCount: rating.ratingCount } : null,
    apiStatus: "credentials_required",
    apiNote: "Dados estruturados da página. A Creators API oficial exige Credential ID, Credential Secret e Partner Tag.",
  };
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

function safeAmazonImage(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(decodeHtml(value));
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (!host.endsWith(".media-amazon.com") && !host.endsWith(".ssl-images-amazon.com")) return null;
    return url.href;
  } catch {
    return null;
  }
}

function extractVisual(html: string, asin: string): AmazonProductVisual {
  const jsonLd = productJsonLd(html);
  const candidates = [
    metaContent(html, "og:image"),
    metaContent(html, "twitter:image"),
    html.match(/"hiRes"\s*:\s*"(https:[^"]+)"/i)?.[1] || null,
    html.match(/"large"\s*:\s*"(https:[^"]+)"/i)?.[1] || null,
    html.match(/data-old-hires=["'](https:[^"']+)["']/i)?.[1] || null,
    html.match(/"image"\s*:\s*(?:\[\s*)?"(https:[^"]+)"/i)?.[1] || null,
  ];
  const imageUrl = candidates.map(safeAmazonImage).find(Boolean) || null;
  const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || null;
  return {
    title: metaContent(html, "og:title") || (titleTag ? decodeHtml(titleTag).replace(/\s*:\s*Amazon\.com\.br.*$/i, "") : null),
    imageUrl,
    source: imageUrl ? "product_page" : null,
    details: compactAmazonData(jsonLd, asin),
  };
}

async function limitedText(response: Response, maxBytes = 1_500_000) {
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

export async function getAmazonProductVisual(asin: string, resolvedUrl: string): Promise<AmazonProductVisual> {
  if (!/^[A-Z0-9]{10}$/i.test(asin)) return { title: null, imageUrl: null, source: null, details: null };
  const urls = [...new Set([resolvedUrl, `https://www.amazon.com.br/dp/${asin.toUpperCase()}`])];
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.6",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok || !(response.headers.get("content-type") || "").includes("text/html")) continue;
      const visual = extractVisual(await limitedText(response), asin.toUpperCase());
      if (visual.imageUrl) return visual;
    } catch {
      // Keep the received image as fallback when Amazon does not expose the page.
    }
  }
  return { title: null, imageUrl: null, source: null, details: compactAmazonData(null, asin.toUpperCase()) };
}
