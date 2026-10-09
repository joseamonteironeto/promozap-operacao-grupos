import { NextResponse } from "next/server";
import { searchMercadoLivreOffers } from "@/lib/mercadolivre-api";

type MlRow = Record<string, any>;

type RankedProduct = {
  id: string;
  position: number;
  score: number;
  reasons: string[];
  title: string;
  url: string | null;
  imageUrl: string | null;
  price: number | null;
  originalPrice: number | null;
  discountPercentage: number;
  currency: string;
  availableQuantity: number | null;
  soldQuantity: number | null;
  condition: string | null;
  categoryId: string | null;
  catalogProductId: string | null;
  officialStore: string | null;
  seller: { id: string | number | null; nickname: string | null; reputation: string | null; powerSellerStatus: string | null };
  shipping: { free: boolean; full: boolean; logisticType: string | null };
  installments: { quantity: number; amount: number | null; rate: number | null } | null;
  attributes: unknown[];
  tags: string[];
  promotionDetected: boolean;
  bestSellerPosition: number | null;
  raw: MlRow;
};

function imageUrl(value: unknown) {
  return typeof value === "string" ? value.replace(/^http:/, "https:").replace(/-I\.jpg$/i, "-O.jpg") : null;
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function deriveQuery(url: URL) {
  const explicit = url.searchParams.get("q") || url.searchParams.get("query") || url.searchParams.get("keyword");
  if (explicit?.trim()) return explicit.trim();
  const path = decodeURIComponent(url.pathname)
    .replace(/^\/+/, "")
    .replace(/^_?Container_/i, "")
    .replace(/\bMLB\d+\b/gi, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\b(total|lista|ofertas?|comprar|mercado livre)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return path || "ofertas";
}

function categoryFromUrl(url: URL) {
  const direct = url.searchParams.get("category") || url.searchParams.get("category_id");
  if (direct && /^MLB\d+$/i.test(direct)) return direct.toUpperCase();
  const match = url.pathname.match(/(?:^|[\/_-])(MLB\d{3,})(?:$|[\/_-])/i);
  return match?.[1]?.toUpperCase() || null;
}

async function mlJson(url: string, headers: HeadersInit, timeout = 15_000) {
  const response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(timeout) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data && typeof data === "object" && "message" in data ? String((data as { message?: unknown }).message) : "";
    throw new Error(message || `Mercado Livre recusou a consulta (HTTP ${response.status}).`);
  }
  return data;
}

async function discoverCategory(query: string, headers: HeadersInit) {
  const endpoint = new URL("https://api.mercadolibre.com/sites/MLB/domain_discovery/search");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("limit", "1");
  try {
    const rows = await mlJson(endpoint.href, headers) as MlRow[];
    const first = Array.isArray(rows) ? rows[0] : null;
    return first ? {
      categoryId: typeof first.category_id === "string" ? first.category_id : null,
      categoryName: typeof first.category_name === "string" ? first.category_name : null,
      domainId: typeof first.domain_id === "string" ? first.domain_id : null,
    } : { categoryId: null, categoryName: null, domainId: null };
  } catch {
    return { categoryId: null, categoryName: null, domainId: null };
  }
}

async function getHighlights(categoryId: string | null, headers: HeadersInit) {
  if (!categoryId) return new Map<string, number>();
  try {
    const data = await mlJson(`https://api.mercadolibre.com/highlights/MLB/category/${encodeURIComponent(categoryId)}`, headers) as MlRow;
    const rows = Array.isArray(data.content) ? data.content : Array.isArray(data) ? data : [];
    return new Map<string, number>(rows.map((row: MlRow, index: number) => [String(row.id || row.item_id || ""), finiteNumber(row.position) || index + 1]).filter(([id]) => id));
  } catch {
    return new Map<string, number>();
  }
}

function sellerReputation(row: MlRow) {
  const seller = row.seller || {};
  const reputation = seller.seller_reputation || seller.reputation || {};
  const level = reputation.level_id || seller.reputation_level_id || null;
  const power = reputation.power_seller_status || seller.power_seller_status || null;
  return { level: typeof level === "string" ? level : null, power: typeof power === "string" ? power : null };
}

function reputationPoints(level: string | null, power: string | null) {
  if (power === "platinum") return 10;
  if (power === "gold") return 8;
  if (power === "silver") return 6;
  if (level?.startsWith("5_")) return 9;
  if (level?.startsWith("4_")) return 7;
  if (level?.startsWith("3_")) return 5;
  return 2;
}

function normalize(row: MlRow, medianPrice: number, highlights: Map<string, number>): RankedProduct {
  const price = finiteNumber(row.price);
  const originalPrice = finiteNumber(row.original_price);
  const discountPercentage = price && originalPrice && originalPrice > price ? Math.round((1 - price / originalPrice) * 100) : 0;
  const soldQuantity = finiteNumber(row.sold_quantity);
  const bestSellerPosition = highlights.get(String(row.id)) || null;
  const shipping = row.shipping || {};
  const tags = Array.isArray(row.tags) ? row.tags.filter((tag: unknown) => typeof tag === "string") : [];
  const promotionDetected = discountPercentage > 0 || Boolean(row.deal_ids?.length || row.promotions?.length || tags.some((tag: string) => /deal|promotion|discount|best_price/i.test(tag)));
  const { level, power } = sellerReputation(row);
  const reasons: string[] = [];
  let score = 0;
  if (bestSellerPosition) {
    const points = Math.max(10, 30 - (bestSellerPosition - 1));
    score += points;
    reasons.push(`#${bestSellerPosition} entre os mais vendidos`);
  } else if (soldQuantity != null && soldQuantity > 0) {
    const points = Math.min(22, Math.log10(soldQuantity + 1) * 5.5);
    score += points;
    reasons.push(`${soldQuantity.toLocaleString("pt-BR")} vendidos`);
  }
  if (discountPercentage > 0) {
    score += Math.min(25, discountPercentage * 0.65);
    reasons.push(`${discountPercentage}% de desconto`);
  }
  if (price && medianPrice > 0) {
    const ratio = medianPrice / price;
    const points = Math.max(0, Math.min(15, 7.5 + (ratio - 1) * 12));
    score += points;
    if (price < medianPrice * 0.9) reasons.push("preço abaixo da mediana");
  }
  if (shipping.free_shipping) { score += 6; reasons.push("frete grátis"); }
  const logisticType = typeof shipping.logistic_type === "string" ? shipping.logistic_type : null;
  const full = logisticType === "fulfillment" || tags.includes("fulfillment");
  if (full) { score += 4; reasons.push("envio Full"); }
  score += reputationPoints(level, power);
  if (power) reasons.push(`vendedor ${power}`);
  const installments = row.installments && finiteNumber(row.installments.quantity) ? {
    quantity: Number(row.installments.quantity),
    amount: finiteNumber(row.installments.amount),
    rate: finiteNumber(row.installments.rate),
  } : null;
  if (installments && (installments.rate === 0 || installments.rate == null)) { score += 5; reasons.push(`${installments.quantity}x sem juros`); }
  if (row.official_store_name) { score += 3; reasons.push("loja oficial"); }

  return {
    id: String(row.id || row.catalog_product_id || crypto.randomUUID()),
    position: 0,
    score: Math.round(Math.min(100, score)),
    reasons: reasons.slice(0, 5),
    title: String(row.title || "Produto sem título"),
    url: typeof row.permalink === "string" ? row.permalink : null,
    imageUrl: imageUrl(row.thumbnail),
    price,
    originalPrice,
    discountPercentage,
    currency: typeof row.currency_id === "string" ? row.currency_id : "BRL",
    availableQuantity: finiteNumber(row.available_quantity),
    soldQuantity,
    condition: typeof row.condition === "string" ? row.condition : null,
    categoryId: typeof row.category_id === "string" ? row.category_id : null,
    catalogProductId: typeof row.catalog_product_id === "string" ? row.catalog_product_id : null,
    officialStore: typeof row.official_store_name === "string" ? row.official_store_name : null,
    seller: {
      id: row.seller?.id ?? null,
      nickname: typeof row.seller?.nickname === "string" ? row.seller.nickname : null,
      reputation: level,
      powerSellerStatus: power,
    },
    shipping: { free: Boolean(shipping.free_shipping), full, logisticType },
    installments,
    attributes: Array.isArray(row.attributes) ? row.attributes.slice(0, 60) : [],
    tags,
    promotionDetected,
    bestSellerPosition,
    raw: row,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { url?: unknown; maxPages?: unknown };
    if (typeof body.url !== "string" || !body.url.trim()) return NextResponse.json({ error: "Cole a URL de uma listagem do Mercado Livre." }, { status: 400 });
    let sourceUrl: URL;
    try { sourceUrl = new URL(body.url.trim()); } catch { return NextResponse.json({ error: "A URL informada não é válida." }, { status: 400 }); }
    const host = sourceUrl.hostname.toLowerCase();
    if (sourceUrl.protocol !== "https:" || !(host === "mercadolivre.com.br" || host.endsWith(".mercadolivre.com.br"))) {
      return NextResponse.json({ error: "Use uma URL HTTPS do Mercado Livre Brasil." }, { status: 400 });
    }
    const maxPages = Math.max(1, Math.min(20, Math.floor(Number(body.maxPages) || 5)));
    const query = deriveQuery(sourceUrl);
    const explicitCategory = categoryFromUrl(sourceUrl);
    const limit = Math.min(50, Math.max(10, maxPages * 10));
    const search = await searchMercadoLivreOffers(explicitCategory || query, limit);
    const discovery = {
      categoryId: explicitCategory || search.category?.id || null,
      categoryName: search.category?.name || null,
      domainId: search.domainId || null,
    };
    const rows = search.items.map((offer) => ({
      id: offer.itemId || offer.id,
      catalog_product_id: offer.catalogProductId,
      title: offer.title,
      permalink: offer.url,
      thumbnail: offer.imageUrl,
      price: offer.price,
      original_price: offer.originalPrice,
      currency_id: offer.currency,
      available_quantity: offer.availableQuantity,
      sold_quantity: offer.soldQuantity,
      condition: offer.condition,
      category_id: offer.categoryId,
      official_store_name: offer.officialStore,
      seller: { id: offer.sellerId, nickname: offer.seller, seller_reputation: { level_id: offer.sellerReputation, power_seller_status: offer.sellerReputation } },
      shipping: { free_shipping: offer.freeShipping, logistic_type: offer.logisticType },
      installments: offer.installments,
      attributes: offer.attributes,
      tags: offer.tags,
      deal_ids: offer.promotionType ? [offer.promotionType] : [],
      _bestSellerPosition: offer.bestSellerPosition,
      raw_offer: offer.raw,
    }));
    const total = search.total || rows.length;
    const prices = rows.map((row) => finiteNumber(row.price)).filter((value): value is number => value != null && value > 0).sort((a, b) => a - b);
    const medianPrice = prices.length ? prices[Math.floor(prices.length / 2)] : 0;
    const highlights = new Map<string, number>(rows.flatMap((row) => row._bestSellerPosition ? [[String(row.id), Number(row._bestSellerPosition)] as [string, number]] : []));
    const products = rows.map((row) => normalize(row, medianPrice, highlights)).sort((a, b) => b.score - a.score || b.discountPercentage - a.discountPercentage).map((product, index) => ({ ...product, position: index + 1 }));
    const averageDiscount = products.length ? Math.round(products.reduce((sum, product) => sum + product.discountPercentage, 0) / products.length) : 0;
    return NextResponse.json({
      sourceUrl: sourceUrl.href,
      query,
      category: discovery,
      total,
      scanned: products.length,
      pagesScanned: 1,
      pageLimit: maxPages,
      truncated: true,
      medianPrice,
      averageDiscount,
      products,
      scoring: "Heurística Promozap: vendas/mais vendidos, desconto, preço versus mediana, frete, Full, reputação, parcelamento e loja oficial.",
      warning: `Ranking criado com ${products.length.toLocaleString("pt-BR")} ofertas ativas, combinando catálogo, oferta vencedora e mais vendidos oficiais. A URL de listagem é interpretada como categoria/termo porque a busca global antiga foi desativada pelo Mercado Livre.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível analisar a listagem.";
    const auth = /unauthorized|forbidden|access token|oauth/i.test(message);
    return NextResponse.json({ error: auth ? "Conecte novamente o aplicativo do Mercado Livre em Consultar produtos." : message }, { status: auth ? 412 : 502 });
  }
}
