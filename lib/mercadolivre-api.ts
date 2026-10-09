import { getMercadoLivreAccessToken, refreshMercadoLivreAccessToken } from "@/lib/mercadolivre-oauth";

type Row = Record<string, any>;

export type MercadoLivreOffer = {
  id: string;
  itemId: string | null;
  catalogProductId: string | null;
  title: string;
  imageUrl: string | null;
  url: string | null;
  price: number | null;
  originalPrice: number | null;
  discountPercentage: number;
  currency: string;
  condition: string | null;
  availableQuantity: number | null;
  soldQuantity: number | null;
  freeShipping: boolean;
  full: boolean;
  logisticType: string | null;
  seller: string | number | null;
  sellerId: string | number | null;
  sellerReputation: string | null;
  categoryId: string | null;
  categoryName: string | null;
  officialStore: string | number | null;
  installments: Row | null;
  warranty: string | null;
  attributes: Row[];
  pictures: Row[];
  saleTerms: Row[];
  tags: string[];
  bestSellerPosition: number | null;
  promotionType: string | null;
  source: "item" | "buy_box" | "best_seller" | "catalog";
  raw: Row;
};

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeImage(value: unknown) {
  if (typeof value !== "string") return null;
  const url = value.replace(/^http:/, "https:").replace(/-I\.jpg$/i, "-O.jpg");
  return /^https:\/\//i.test(url) ? url : null;
}

async function apiJson(path: string, token: string, timeout = 15_000, allowRefresh = true) {
  const response = await fetch(`https://api.mercadolibre.com${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(timeout),
  });
  const data = await response.json().catch(() => ({}));
  const message = data && typeof data === "object" && "message" in data ? String((data as Row).message) : "";
  if ((response.status === 401 || response.status === 403 || /invalid access token|expired token/i.test(message)) && allowRefresh) {
    const renewed = await refreshMercadoLivreAccessToken();
    if (renewed) return apiJson(path, renewed, timeout, false);
    throw new Error("A conexão com o Mercado Livre expirou. Reconecte o aplicativo no painel.");
  }
  if (!response.ok) {
    throw new Error(message || `Mercado Livre respondeu HTTP ${response.status}.`);
  }
  return data as Row;
}

async function optionalJson(path: string, token: string) {
  try { return await apiJson(path, token); } catch { return null; }
}

function saleAmount(sale: Row | null, item: Row, winner: Row) {
  return finite(sale?.amount ?? sale?.price ?? sale?.sale_price ?? item.price ?? winner.price);
}

function regularAmount(sale: Row | null, item: Row, winner: Row) {
  return finite(sale?.regular_amount ?? sale?.original_price ?? item.original_price ?? winner.original_price ?? item.base_price);
}

function normalize(input: {
  product?: Row | null;
  item?: Row | null;
  sale?: Row | null;
  seller?: Row | null;
  category?: Row | null;
  source: MercadoLivreOffer["source"];
  bestSellerPosition?: number | null;
}): MercadoLivreOffer {
  const product = input.product || {};
  const item = input.item || {};
  const winner = product.buy_box_winner || {};
  const sale = input.sale || null;
  const price = saleAmount(sale, item, winner);
  const originalPrice = regularAmount(sale, item, winner);
  const discountPercentage = price != null && originalPrice != null && originalPrice > price
    ? Math.round((1 - price / originalPrice) * 100)
    : 0;
  const shipping = item.shipping || winner.shipping || {};
  const pictures = Array.isArray(item.pictures) && item.pictures.length ? item.pictures : Array.isArray(product.pictures) ? product.pictures : [];
  const imageUrl = safeImage(pictures[0]?.secure_url || pictures[0]?.url || item.thumbnail || winner.thumbnail);
  const itemId = typeof item.id === "string" ? item.id : typeof winner.item_id === "string" ? winner.item_id : null;
  const catalogProductId = typeof item.catalog_product_id === "string" ? item.catalog_product_id : typeof product.id === "string" ? product.id : null;
  const sellerId = item.seller_id ?? winner.seller_id ?? null;
  const seller = input.seller || {};
  const reputation = seller.seller_reputation || {};
  const category = input.category || {};
  const saleMetadata = sale?.metadata || {};
  return {
    id: itemId || catalogProductId || crypto.randomUUID(),
    itemId,
    catalogProductId,
    title: String(item.title || product.name || product.family_name || "Produto sem título"),
    imageUrl,
    url: typeof item.permalink === "string" && item.permalink ? item.permalink : typeof product.permalink === "string" && product.permalink ? product.permalink : catalogProductId ? `https://www.mercadolivre.com.br/p/${catalogProductId}` : null,
    price,
    originalPrice: originalPrice != null && originalPrice >= (price || 0) ? originalPrice : null,
    discountPercentage,
    currency: String(sale?.currency_id || item.currency_id || winner.currency_id || "BRL"),
    condition: typeof item.condition === "string" ? item.condition : typeof winner.condition === "string" ? winner.condition : null,
    availableQuantity: finite(item.available_quantity ?? winner.available_quantity),
    soldQuantity: finite(item.sold_quantity ?? winner.sold_quantity),
    freeShipping: Boolean(shipping.free_shipping),
    full: shipping.logistic_type === "fulfillment" || (Array.isArray(item.tags) && item.tags.includes("fulfillment")),
    logisticType: typeof shipping.logistic_type === "string" ? shipping.logistic_type : null,
    seller: seller.nickname || sellerId,
    sellerId,
    sellerReputation: reputation.power_seller_status || reputation.level_id || null,
    categoryId: item.category_id || winner.category_id || null,
    categoryName: typeof category.name === "string" ? category.name : null,
    officialStore: item.official_store_name || item.official_store_id || winner.official_store_id || null,
    installments: item.installments || winner.installments || null,
    warranty: typeof item.warranty === "string" ? item.warranty : null,
    attributes: Array.isArray(item.attributes) && item.attributes.length ? item.attributes : Array.isArray(product.attributes) ? product.attributes : [],
    pictures: pictures.slice(0, 20),
    saleTerms: Array.isArray(item.sale_terms) ? item.sale_terms.slice(0, 30) : [],
    tags: Array.isArray(item.tags) ? item.tags.filter((tag: unknown): tag is string => typeof tag === "string") : [],
    bestSellerPosition: input.bestSellerPosition || null,
    promotionType: saleMetadata.promotion_type || sale?.promotion_type || null,
    source: input.source,
    raw: { product: input.product || null, item: input.item || null, salePrice: input.sale || null, seller: input.seller || null, category: input.category || null },
  };
}

async function enrichItem(itemId: string, token: string, product?: Row | null, source: MercadoLivreOffer["source"] = "item", bestSellerPosition?: number | null) {
  const item = await apiJson(`/items/${encodeURIComponent(itemId)}`, token);
  const [sale, seller, category] = await Promise.all([
    optionalJson(`/items/${encodeURIComponent(itemId)}/sale_price?context=channel_marketplace`, token),
    item.seller_id ? optionalJson(`/users/${encodeURIComponent(String(item.seller_id))}`, token) : null,
    item.category_id ? optionalJson(`/categories/${encodeURIComponent(String(item.category_id))}`, token) : null,
  ]);
  return normalize({ product, item, sale, seller, category, source, bestSellerPosition });
}

async function enrichProduct(productId: string, token: string, source: MercadoLivreOffer["source"] = "catalog", bestSellerPosition?: number | null) {
  const product = await apiJson(`/products/${encodeURIComponent(productId)}`, token);
  const winnerId = typeof product.buy_box_winner?.item_id === "string" ? product.buy_box_winner.item_id : null;
  if (winnerId) return enrichItem(winnerId, token, product, source === "best_seller" ? "best_seller" : "buy_box", bestSellerPosition);
  return normalize({ product, source, bestSellerPosition });
}

function parseInput(value: string) {
  const text = value.trim();
  const itemUrl = text.match(/produto\.mercadolivre\.com\.br\/MLB-?(\d{7,})/i);
  if (itemUrl) return { kind: "item" as const, id: `MLB${itemUrl[1]}` };
  const productUrl = text.match(/mercadolivre\.com\.br\/(?:[^\s/]+\/)?p\/(MLB\d{7,})/i);
  if (productUrl) return { kind: "product" as const, id: productUrl[1].toUpperCase() };
  const plain = text.match(/^(MLB\d{7,})$/i);
  if (plain) return { kind: "unknown-id" as const, id: plain[1].toUpperCase() };
  return { kind: "query" as const, query: text };
}

async function inChunks<T, R>(values: T[], size: number, task: (value: T) => Promise<R | null>) {
  const results: R[] = [];
  for (let index = 0; index < values.length; index += size) {
    const chunk = await Promise.all(values.slice(index, index + size).map(task));
    results.push(...chunk.filter((value): value is R => value != null));
  }
  return results;
}

export async function getMercadoLivreOffer(input: string) {
  const token = await getMercadoLivreAccessToken();
  if (!token) throw new Error("Conecte novamente o Mercado Livre para consultar preços.");
  const parsed = parseInput(input);
  if (parsed.kind === "item") return enrichItem(parsed.id, token);
  if (parsed.kind === "product") return enrichProduct(parsed.id, token);
  if (parsed.kind === "unknown-id") {
    try { return await enrichItem(parsed.id, token); }
    catch { return enrichProduct(parsed.id, token); }
  }
  throw new Error("Informe um link ou ID do Mercado Livre.");
}

export async function searchMercadoLivreOffers(queryInput: string, limit = 20) {
  const token = await getMercadoLivreAccessToken();
  if (!token) throw new Error("Conecte novamente o Mercado Livre para consultar preços.");
  const parsed = parseInput(queryInput);
  if (parsed.kind !== "query") {
    const offer = await getMercadoLivreOffer(queryInput);
    return { query: queryInput, category: null, items: [offer], total: 1, mode: "exact" as const };
  }
  const query = parsed.query || "ofertas";
  const discoveryRows = await optionalJson(`/sites/MLB/domain_discovery/search?q=${encodeURIComponent(query)}&limit=1`, token);
  const discovery = Array.isArray(discoveryRows) ? discoveryRows[0] || null : null;
  const search = await apiJson(`/products/search?status=active&site_id=MLB&q=${encodeURIComponent(query)}&limit=${Math.min(20, limit)}`, token);
  const summaries = Array.isArray(search.results) ? search.results as Row[] : [];
  const catalogOffers = await inChunks(summaries, 5, async (summary) => {
    try { return await enrichProduct(String(summary.id), token); } catch { return null; }
  });
  let priced = catalogOffers.filter((item) => item.price != null);
  if (discovery?.category_id && priced.length < Math.min(8, limit)) {
    const highlights = await optionalJson(`/highlights/MLB/category/${encodeURIComponent(String(discovery.category_id))}`, token);
    const rows = Array.isArray(highlights?.content) ? highlights.content as Row[] : [];
    const bestSellers = await inChunks(rows.slice(0, limit), 4, async (row) => {
      try {
        if (row.type === "ITEM") return await enrichItem(String(row.id), token, null, "best_seller", finite(row.position));
        if (row.type === "PRODUCT") return await enrichProduct(String(row.id), token, "best_seller", finite(row.position));
        return null;
      } catch { return null; }
    });
    priced = [...priced, ...bestSellers.filter((item) => item.price != null)];
  }
  const seen = new Map<string, MercadoLivreOffer>();
  for (const item of [...priced, ...catalogOffers]) if (!seen.has(item.id)) seen.set(item.id, item);
  const items = [...seen.values()].slice(0, limit);
  return {
    query,
    category: discovery ? { categoryId: discovery.category_id || null, categoryName: discovery.category_name || null, domainId: discovery.domain_id || null, domainName: discovery.domain_name || null } : null,
    items,
    total: finite(search.paging?.total) || items.length,
    mode: priced.length ? "offers" as const : "catalog" as const,
  };
}
