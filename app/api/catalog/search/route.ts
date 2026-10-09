import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { searchAmazonProducts } from "@/lib/amazon-creators";
import { searchMercadoLivreOffers } from "@/lib/mercadolivre-api";

function numberParam(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function searchMercadoLivre(params: URLSearchParams) {
  let query = params.get("q")?.trim() || "";
  if (!query) {
    const trendsResponse = await fetch("https://api.mercadolibre.com/trends/MLB?limit=20", { signal: AbortSignal.timeout(10_000) });
    if (trendsResponse.ok) {
      const trends = await trendsResponse.json() as Array<{ keyword?: string }>;
      query = trends.find((item) => item.keyword)?.keyword || "ofertas";
    } else query = "ofertas";
  }
  const minPrice = numberParam(params.get("minPrice"));
  const maxPrice = numberParam(params.get("maxPrice"));
  const quality = params.get("quality") || "all";
  const result = await searchMercadoLivreOffers(query, 20);
  const qualifies = (item: (typeof result.items)[number]) => {
    if (quality === "priced") return item.price != null;
    if (quality === "good_deal") return item.price != null && (item.discountPercentage >= 10 || Boolean(item.coupon) || Boolean(item.bestSellerPosition) || (item.soldQuantity || 0) >= 100);
    if (quality === "coupon") return Boolean(item.coupon);
    if (quality === "free_shipping") return item.freeShipping;
    if (quality === "full") return item.full;
    if (quality === "official_store") return Boolean(item.officialStore);
    return true;
  };
  const items = result.items
    .filter((item) => (!minPrice || (item.price != null && item.price >= minPrice)) && (!maxPrice || (item.price != null && item.price <= maxPrice)) && qualifies(item));
  const sort = params.get("sort") || "relevance";
  if (sort === "price_asc") items.sort((a, b) => (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY));
  if (sort === "price_desc") items.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
  if (sort === "discount_desc") items.sort((a, b) => b.discountPercentage - a.discountPercentage);
  if (sort === "sold_desc") items.sort((a, b) => (b.soldQuantity || 0) - (a.soldQuantity || 0));
  return {
    store: "mercadolivre",
    query,
    items,
    total: result.total,
    filters: result.category ? [{ id: "category", name: "Categoria detectada", values: [{ id: result.category.categoryId, name: result.category.categoryName || result.category.domainName }] }] : [],
    appliedFilters: [],
    sorts: [
      { id: "relevance", name: "Relevância" },
      { id: "discount_desc", name: "Maior desconto" },
      { id: "sold_desc", name: "Mais vendidos" },
      { id: "price_asc", name: "Menor preço" },
      { id: "price_desc", name: "Maior preço" },
    ],
    source: result.mode,
    category: result.category,
    warning: result.marketplaceWarning,
  };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const store = params.get("store") || "mercadolivre";
  try {
    if (store === "amazon") {
      if (!env.DB) return NextResponse.json({ error: "Banco de dados indisponível." }, { status: 503 });
      const settings = await env.DB.prepare("SELECT amazon_tracking_id AS amazonTrackingId FROM affiliate_settings WHERE id = 1")
        .first<{ amazonTrackingId: string }>();
      if (!settings?.amazonTrackingId) return NextResponse.json({ error: "Informe primeiro seu Tracking ID da Amazon em Afiliados." }, { status: 412 });
      const q = params.get("q")?.trim();
      if (!q) return NextResponse.json({ error: "Na Amazon, informe uma palavra-chave para consultar o catálogo oficial." }, { status: 400 });
      const result = await searchAmazonProducts({
        keywords: q,
        partnerTag: settings.amazonTrackingId,
        searchIndex: params.get("searchIndex") || "All",
        sortBy: params.get("sort") || undefined,
        brand: params.get("brand") || undefined,
        minPrice: numberParam(params.get("minPrice")),
        maxPrice: numberParam(params.get("maxPrice")),
      });
      return NextResponse.json({ store: "amazon", query: q, sorts: ["Relevance", "Price:LowToHigh", "Price:HighToLow", "AvgCustomerReviews", "Featured"], ...result });
    }
    return NextResponse.json(await searchMercadoLivre(params));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível consultar o catálogo.";
    const credentialsRequired = message === "AMAZON_CREDENTIALS_REQUIRED";
    return NextResponse.json({ error: credentialsRequired ? "A Creators API da Amazon ainda não está conectada. Salve o Credential ID e o Secret quando sua conta for aprovada." : message, credentialsRequired }, { status: credentialsRequired ? 412 : 502 });
  }
}
