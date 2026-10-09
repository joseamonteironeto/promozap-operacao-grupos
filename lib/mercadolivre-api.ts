import { getMercadoLivreAccessToken, refreshMercadoLivreAccessToken } from "@/lib/mercadolivre-oauth";
import { mercadoLivreListingUrl, scrapeMercadoLivreListing } from "@/lib/mercadolivre-marketplace";

type Row = Record<string, any>;

class MercadoLivreApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null) {
    super(message);
    this.name = "MercadoLivreApiError";
  }
}

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
  promotionId: string | null;
  priceId: string | null;
  priceSource: "sale_price" | "prices" | "buy_box" | "item" | "catalog" | "marketplace_page";
  priceUpdatedAt: string | null;
  promotions: Row[];
  coupon: Row | null;
  source: "item" | "buy_box" | "best_seller" | "catalog" | "web_search";
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
    throw new MercadoLivreApiError(
      message || `Mercado Livre respondeu HTTP ${response.status}.`,
      response.status,
      typeof data?.code === "string" ? data.code : null,
    );
  }
  return data as Row;
}

async function optionalJson(path: string, token: string) {
  try { return await apiJson(path, token); } catch { return null; }
}

/**
 * O endpoint unitario pode ser bloqueado pelo PolicyAgent para alguns apps,
 * enquanto o multi-get oficial continua autorizado. Mantemos os dois caminhos
 * para nao transformar um erro de permissao em um falso "produto sem preco".
 */
async function fetchItem(itemId: string, token: string) {
  let directError: unknown = null;
  try {
    return await apiJson(`/items/${encodeURIComponent(itemId)}`, token);
  } catch (error) {
    directError = error;
  }

  try {
    const rows = await apiJson(`/items?ids=${encodeURIComponent(itemId)}`, token);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (row?.code >= 200 && row?.code < 300 && row.body && typeof row.body === "object") return row.body as Row;
    const detail = row?.body?.message || row?.message;
    throw new MercadoLivreApiError(
      detail || `A oferta ${itemId} nao foi devolvida pela consulta em lote.`,
      finite(row?.code) || 404,
      typeof row?.body?.code === "string" ? row.body.code : null,
    );
  } catch (batchError) {
    if (directError instanceof MercadoLivreApiError && directError.status !== 404) throw directError;
    throw batchError;
  }
}

function marketplacePrice(prices: Row | null) {
  const rows = Array.isArray(prices?.prices) ? prices.prices as Row[] : [];
  const now = Date.now();
  const applies = (row: Row) => {
    const contexts = Array.isArray(row.conditions?.context_restrictions) ? row.conditions.context_restrictions : [];
    const starts = row.conditions?.start_time ? Date.parse(String(row.conditions.start_time)) : 0;
    const ends = row.conditions?.end_time ? Date.parse(String(row.conditions.end_time)) : Number.POSITIVE_INFINITY;
    return (!contexts.length || contexts.includes("channel_marketplace")) && (!starts || starts <= now) && (!ends || ends >= now);
  };
  const active = rows.filter((row) => finite(row.amount) != null && applies(row));
  return active.find((row) => row.type === "promotion") || active.find((row) => row.type === "standard") || null;
}

function saleAmount(sale: Row | null, selectedPrice: Row | null, item: Row, winner: Row) {
  return finite(sale?.amount ?? sale?.price ?? sale?.sale_price ?? selectedPrice?.amount ?? winner.price ?? item.price);
}

function regularAmount(sale: Row | null, selectedPrice: Row | null, item: Row, winner: Row) {
  return finite(sale?.regular_amount ?? sale?.original_price ?? selectedPrice?.regular_amount ?? winner.original_price ?? item.original_price ?? item.base_price);
}

function couponFromPromotions(promotions: Row[]) {
  const coupon = promotions.find((row) => String(row.type || row.promotion_type).toUpperCase() === "SELLER_COUPON_CAMPAIGN" && ["started", "active"].includes(String(row.status).toLowerCase()));
  if (!coupon) return null;
  return {
    id: coupon.id || coupon.promotion_id || null,
    code: coupon.coupon_code || null,
    subType: coupon.sub_type || null,
    fixedAmount: finite(coupon.fixed_amount),
    fixedPercentage: finite(coupon.fixed_percentage),
    minPurchaseAmount: finite(coupon.min_purchase_amount),
    maxPurchaseAmount: finite(coupon.max_purchase_amount),
    startDate: coupon.start_date || null,
    finishDate: coupon.finish_date || coupon.end_date || null,
    status: coupon.status || null,
  };
}

function normalize(input: {
  product?: Row | null;
  item?: Row | null;
  sale?: Row | null;
  prices?: Row | null;
  promotions?: Row[] | null;
  seller?: Row | null;
  category?: Row | null;
  source: MercadoLivreOffer["source"];
  bestSellerPosition?: number | null;
}): MercadoLivreOffer {
  const product = input.product || {};
  const item = input.item || {};
  const winner = product.buy_box_winner || {};
  const sale = input.sale || null;
  const selectedPrice = marketplacePrice(input.prices || null);
  const promotions = Array.isArray(input.promotions) ? input.promotions : [];
  const price = saleAmount(sale, selectedPrice, item, winner);
  const originalPrice = regularAmount(sale, selectedPrice, item, winner);
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
    promotionType: saleMetadata.promotion_type || sale?.promotion_type || selectedPrice?.type || null,
    promotionId: saleMetadata.promotion_id || sale?.promotion_id || promotions.find((row) => ["started", "active"].includes(String(row.status).toLowerCase()))?.id || null,
    priceId: sale?.price_id != null ? String(sale.price_id) : selectedPrice?.id != null ? String(selectedPrice.id) : null,
    priceSource: sale && finite(sale.amount) != null ? "sale_price" : selectedPrice ? "prices" : finite(winner.price) != null ? "buy_box" : finite(item.price) != null ? "item" : "catalog",
    priceUpdatedAt: sale?.reference_date || selectedPrice?.last_updated || null,
    promotions,
    coupon: couponFromPromotions(promotions),
    source: input.source,
    raw: { product: input.product || null, item: input.item || null, salePrice: input.sale || null, prices: input.prices || null, promotions, seller: input.seller || null, category: input.category || null },
  };
}

async function enrichItem(itemId: string, token: string, product?: Row | null, source: MercadoLivreOffer["source"] = "item", bestSellerPosition?: number | null) {
  const item = await fetchItem(itemId, token);
  const [sale, prices, promotionsResponse, seller, category] = await Promise.all([
    optionalJson(`/items/${encodeURIComponent(itemId)}/sale_price?context=channel_marketplace`, token),
    optionalJson(`/items/${encodeURIComponent(itemId)}/prices`, token),
    optionalJson(`/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`, token),
    item.seller_id ? optionalJson(`/users/${encodeURIComponent(String(item.seller_id))}`, token) : null,
    item.category_id ? optionalJson(`/categories/${encodeURIComponent(String(item.category_id))}`, token) : null,
  ]);
  const promotions = Array.isArray(promotionsResponse) ? promotionsResponse as Row[] : [];
  return normalize({ product, item, sale, prices, promotions, seller, category, source, bestSellerPosition });
}

async function enrichProduct(productId: string, token: string, source: MercadoLivreOffer["source"] = "catalog", bestSellerPosition?: number | null, depth = 0): Promise<MercadoLivreOffer> {
  const product = await apiJson(`/products/${encodeURIComponent(productId)}`, token);
  const winnerId = typeof product.buy_box_winner?.item_id === "string" ? product.buy_box_winner.item_id : null;
  if (winnerId) {
    try { return await enrichItem(winnerId, token, product, source === "best_seller" ? "best_seller" : "buy_box", bestSellerPosition); }
    catch {
      const winner = product.buy_box_winner || {};
      const fallbackItem = { ...winner, id: winnerId, seller_id: winner.seller_id, pictures: product.pictures, attributes: product.attributes, catalog_product_id: product.id };
      const [sale, prices] = await Promise.all([
        optionalJson(`/items/${encodeURIComponent(winnerId)}/sale_price?context=channel_marketplace`, token),
        optionalJson(`/items/${encodeURIComponent(winnerId)}/prices`, token),
      ]);
      return normalize({ product, item: fallbackItem, sale, prices, source: source === "best_seller" ? "best_seller" : "buy_box", bestSellerPosition });
    }
  }
  const children = Array.isArray(product.children_ids) ? product.children_ids.filter((id: unknown): id is string => typeof id === "string").slice(0, 16) : [];
  if (depth < 2 && children.length) {
    const offers = await inChunks(children, 4, async (childId) => {
      try { return await enrichProduct(childId, token, source, bestSellerPosition, depth + 1); } catch { return null; }
    });
    const priced = offers.filter((offer) => offer.price != null).sort((a, b) => (a.price || Number.POSITIVE_INFINITY) - (b.price || Number.POSITIVE_INFINITY));
    if (priced[0]) return priced[0];
  }
  return normalize({ product, source, bestSellerPosition });
}

async function enrichUserProduct(userProductId: string, token: string, bestSellerPosition?: number | null) {
  const userProduct = await apiJson(`/user-products/${encodeURIComponent(userProductId)}`, token);
  const sellerId = userProduct.user_id || userProduct.seller_id;
  if (!sellerId) return normalize({ product: userProduct, source: "best_seller", bestSellerPosition });
  const search = await apiJson(`/users/${encodeURIComponent(String(sellerId))}/items/search?user_product_id=${encodeURIComponent(userProductId)}&status=active&limit=10`, token);
  const itemIds = Array.isArray(search.results) ? search.results.filter((id: unknown): id is string => typeof id === "string") : [];
  const offers = await inChunks(itemIds.slice(0, 10), 4, async (itemId) => {
    try { return await enrichItem(itemId, token, userProduct, "best_seller", bestSellerPosition); } catch { return null; }
  });
  const priced = offers.filter((offer) => offer.price != null).sort((a, b) => (a.price || Number.POSITIVE_INFINITY) - (b.price || Number.POSITIVE_INFINITY));
  return priced[0] || normalize({ product: userProduct, source: "best_seller", bestSellerPosition });
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
  if (parsed.kind === "item") {
    try { return await enrichItem(parsed.id, token); }
    catch (error) {
      const fallback = await scrapeMercadoLivreListing(mercadoLivreListingUrl(parsed.id), 1, 10).catch(() => null);
      const item = fallback?.items.find((offer) => offer.itemId === parsed.id);
      if (item) return item;
      throw error;
    }
  }
  if (parsed.kind === "product") return enrichProduct(parsed.id, token);
  if (parsed.kind === "unknown-id") {
    try { return await enrichItem(parsed.id, token); }
    catch (error) {
      // IDs de catalogo e de anuncio compartilham o prefixo MLB. So tentamos
      // catalogo quando o recurso de item realmente nao existe; erros de
      // permissao precisam chegar ate a interface para orientar a configuracao.
      if (error instanceof MercadoLivreApiError && error.status !== 404) {
        const fallback = await scrapeMercadoLivreListing(mercadoLivreListingUrl(parsed.id), 1, 10).catch(() => null);
        const item = fallback?.items.find((offer) => offer.itemId === parsed.id);
        if (item) return item;
        throw error;
      }
      return enrichProduct(parsed.id, token);
    }
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
        if (row.type === "USER_PRODUCT" || String(row.id).startsWith("MLBU")) return await enrichUserProduct(String(row.id), token, finite(row.position));
        if (row.type === "ITEM") return await enrichItem(String(row.id), token, null, "best_seller", finite(row.position));
        if (row.type === "PRODUCT") return await enrichProduct(String(row.id), token, "best_seller", finite(row.position));
        return null;
      } catch { return null; }
    });
    priced = [...priced, ...bestSellers.filter((item) => item.price != null)];
  }
  let marketplaceItems: MercadoLivreOffer[] = [];
  let marketplaceWarning: string | null = null;
  if (priced.length < Math.min(8, limit)) {
    const marketplace = await scrapeMercadoLivreListing(mercadoLivreListingUrl(query), 1, limit).catch(() => null);
    marketplaceItems = marketplace?.items.filter((item) => item.price != null) || [];
    marketplaceWarning = marketplace?.warning || null;
  }
  const seen = new Map<string, MercadoLivreOffer>();
  for (const item of [...marketplaceItems, ...priced, ...catalogOffers]) if (!seen.has(item.id)) seen.set(item.id, item);
  const items = [...seen.values()].slice(0, limit);
  return {
    query,
    category: discovery ? { categoryId: discovery.category_id || null, categoryName: discovery.category_name || null, domainId: discovery.domain_id || null, domainName: discovery.domain_name || null } : null,
    items,
    total: finite(search.paging?.total) || items.length,
    mode: marketplaceItems.length ? "marketplace" as const : priced.length ? "offers" as const : "catalog" as const,
    marketplaceWarning,
  };
}
