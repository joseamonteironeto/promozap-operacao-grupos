export type Store = "amazon" | "mercadolivre" | "unknown";

export type ResolvedProduct = {
  sourceUrl: string;
  resolvedUrl: string;
  store: Store;
  productCode: string | null;
  title: string | null;
  imageUrl: string | null;
  redirectCount: number;
  errorMessage: string | null;
};

const destinationParams = ["url", "u", "ued", "redirect", "redirect_url", "redirect_uri", "destination", "dest", "target", "to"];
const amazonHosts = /(^|\.)amazon\.com\.br$/i;
const mercadoLivreHosts = /(^|\.)mercadolivre\.com\.br$/i;

function htmlDecode(value: string) {
  return value.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("\\/", "/");
}

function safeUrl(value: string, base?: string) {
  try {
    const url = new URL(htmlDecode(value.trim()), base);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
    if (/^(0|10|127|169\.254|192\.168)\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function identify(url: URL) {
  if (amazonHosts.test(url.hostname)) {
    const asin = url.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1]?.toUpperCase()
      || url.searchParams.get("asin")?.match(/^[A-Z0-9]{10}$/i)?.[0]?.toUpperCase();
    if (asin) return { store: "amazon" as const, productCode: asin, canonicalUrl: `https://www.amazon.com.br/dp/${asin}` };
  }
  if (mercadoLivreHosts.test(url.hostname)) {
    const matched = url.pathname.match(/\bMLB-?(\d{7,})\b/i);
    if (matched) {
      const raw = matched[0].toUpperCase();
      const productCode = `MLB${matched[1]}`;
      const canonicalUrl = raw.includes("-")
        ? `https://produto.mercadolivre.com.br/MLB-${matched[1]}`
        : `https://www.mercadolivre.com.br/p/${productCode}`;
      return { store: "mercadolivre" as const, productCode, canonicalUrl };
    }
  }
  return null;
}

function identifyStore(url: URL): Store {
  if (amazonHosts.test(url.hostname)) return "amazon";
  if (mercadoLivreHosts.test(url.hostname)) return "mercadolivre";
  return "unknown";
}

function extractMeta(html: string) {
  const value = (property: string) => {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const first = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)`, "i"));
    const second = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"));
    return htmlDecode(first?.[1] || second?.[1] || "").trim() || null;
  };
  const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  return { title: value("og:title") || (titleTag ? htmlDecode(titleTag).trim() : null), imageUrl: value("og:image") };
}

function mercadoLivreSocialProduct(html: string) {
  const sharedItem = html.match(/"shared_item"\s*:\s*\{[^}]{0,500}"id"\s*:\s*"(MLB\d{7,})"[^}]{0,500}"type"\s*:\s*"PRODUCT"/i)
    || html.match(/"shared_item"\s*:\s*\{[^}]{0,500}"type"\s*:\s*"PRODUCT"[^}]{0,500}"id"\s*:\s*"(MLB\d{7,})"/i);
  if (sharedItem) {
    const productCode = sharedItem[1].toUpperCase();
    return {
      store: "mercadolivre" as const,
      productCode,
      canonicalUrl: `https://www.mercadolivre.com.br/p/${productCode}`,
    };
  }

  // Newer /social pages no longer expose shared_item. The first polycard is the
  // shared offer itself; subsequent polycards are recommendations.
  const polycard = html.match(/"polycards"\s*:\s*\[\s*\{[\s\S]{0,2500}?"metadata"\s*:\s*\{[^}]{0,800}"id"\s*:\s*"(MLB\d{7,})"/i);
  if (!polycard) return null;
  const productCode = polycard[1].toUpperCase();
  return {
    store: "mercadolivre" as const,
    productCode,
    canonicalUrl: `https://produto.mercadolivre.com.br/MLB-${productCode.slice(3)}`,
  };
}

function nestedDestination(url: URL) {
  for (const name of destinationParams) {
    const value = url.searchParams.get(name);
    if (!value) continue;
    let decoded = value;
    for (let attempts = 0; attempts < 2; attempts += 1) {
      try { decoded = decodeURIComponent(decoded); } catch { break; }
    }
    const candidate = safeUrl(decoded, url.href);
    if (candidate && candidate.href !== url.href) return candidate;
  }
  return null;
}

function htmlRedirect(html: string, base: string) {
  const patterns = [
    /window\.location(?:\.href)?\s*=\s*["']([^"']+)/i,
    /window\.location\.(?:replace|assign)\(\s*["']([^"']+)/i,
    /location\.href\s*=\s*["']([^"']+)/i,
    /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"'>;]+)/i,
  ];
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1];
    const candidate = value ? safeUrl(value, base) : null;
    if (candidate) return candidate;
  }
  if (!/(?:redirecion|continuar\s+para|acessar\s+(?:a\s+)?oferta)/i.test(html)) return null;
  const scriptedTarget = html.match(/\bl\s*=\s*["'](https:\/\/[^"']+)/i)?.[1];
  if (scriptedTarget) {
    const candidate = safeUrl(scriptedTarget, base);
    if (candidate) return candidate;
  }
  const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi)];
  for (const link of links) {
    const candidate = safeUrl(link[1], base);
    if (candidate && candidate.href !== base && !candidate.href.endsWith("#")) return candidate;
  }
  return null;
}

async function limitedText(response: Response, maxBytes = 700_000) {
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

export function extractUrls(input: string) {
  const matches = input.match(/https?:\/\/[^\s<>"']+/gi) || [];
  return [...new Set(matches.map((value) => value.replace(/[),.;!?]+$/, "")))];
}

export async function resolveProductUrl(sourceUrl: string): Promise<ResolvedProduct> {
  const start = safeUrl(sourceUrl);
  if (!start) return { sourceUrl, resolvedUrl: sourceUrl, store: "unknown", productCode: null, title: null, imageUrl: null, redirectCount: 0, errorMessage: "URL inválida ou não permitida." };

  let current = start;
  let title: string | null = null;
  let imageUrl: string | null = null;
  let redirectCount = 0;
  const visited = new Set<string>();

  for (let step = 0; step < 10; step += 1) {
    const direct = identify(current);
    if (direct) return { sourceUrl, resolvedUrl: direct.canonicalUrl, store: direct.store, productCode: direct.productCode, title, imageUrl, redirectCount, errorMessage: null };
    if (visited.has(current.href)) break;
    visited.add(current.href);

    const nested = nestedDestination(current);
    if (nested && !visited.has(nested.href)) {
      current = nested;
      redirectCount += 1;
      continue;
    }

    try {
      const response = await fetch(current.href, {
        redirect: "manual",
        headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36" },
        signal: AbortSignal.timeout(10_000),
      });
      const location = response.headers.get("location");
      if (location) {
        const target = safeUrl(location, current.href);
        if (!target) break;
        current = target;
        redirectCount += 1;
        continue;
      }
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) break;
      const html = await limitedText(response);
      const meta = extractMeta(html);
      title ||= meta.title;
      imageUrl ||= meta.imageUrl;
      if (mercadoLivreHosts.test(current.hostname) && current.pathname.startsWith("/social/")) {
        const sharedProduct = mercadoLivreSocialProduct(html);
        if (sharedProduct) {
          return {
            sourceUrl,
            resolvedUrl: sharedProduct.canonicalUrl,
            store: sharedProduct.store,
            productCode: sharedProduct.productCode,
            title,
            imageUrl,
            redirectCount,
            errorMessage: null,
          };
        }
      }
      const target = htmlRedirect(html, current.href);
      if (!target || visited.has(target.href)) break;
      current = target;
      redirectCount += 1;
    } catch {
      const store = identifyStore(current);
      return {
        sourceUrl,
        resolvedUrl: current.href,
        store,
        productCode: null,
        title,
        imageUrl,
        redirectCount,
        errorMessage: store === "unknown" ? "O destino não respondeu ou bloqueou a consulta automática." : null,
      };
    }
  }

  const finalIdentity = identify(current);
  const finalStore = finalIdentity?.store || identifyStore(current);
  return {
    sourceUrl,
    resolvedUrl: finalIdentity?.canonicalUrl || current.href,
    store: finalStore,
    productCode: finalIdentity?.productCode || null,
    title,
    imageUrl,
    redirectCount,
    errorMessage: finalStore === "unknown" ? "O destino final não é Amazon nem Mercado Livre, ou não expôs o produto." : null,
  };
}
