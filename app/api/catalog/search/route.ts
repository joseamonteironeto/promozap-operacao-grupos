import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { searchAmazonProducts } from "@/lib/amazon-creators";
import { readIntegrationSecret } from "@/lib/integration-secret";

function numberParam(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function mlImage(url: unknown) {
  return typeof url === "string" ? url.replace(/^http:/, "https:").replace(/-I\.jpg$/i, "-O.jpg") : null;
}

async function searchMercadoLivre(params: URLSearchParams) {
  const token = await readIntegrationSecret("mercadolivre_access_token");
  const headers: HeadersInit = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let query = params.get("q")?.trim() || "";
  if (!query) {
    const trendsResponse = await fetch("https://api.mercadolibre.com/trends/MLB?limit=20", { headers, signal: AbortSignal.timeout(10_000) });
    if (trendsResponse.ok) {
      const trends = await trendsResponse.json() as Array<{ keyword?: string }>;
      query = trends.find((item) => item.keyword)?.keyword || "ofertas";
    } else query = "ofertas";
  }
  const target = new URL("https://api.mercadolibre.com/sites/MLB/search");
  target.searchParams.set("q", query);
  target.searchParams.set("limit", "24");
  for (const name of ["sort", "category", "shipping_cost", "condition", "official_store", "price"]) {
    const value = params.get(name);
    if (value) target.searchParams.set(name, value);
  }
  const minPrice = numberParam(params.get("minPrice"));
  const maxPrice = numberParam(params.get("maxPrice"));
  if (minPrice || maxPrice) target.searchParams.set("price", `${minPrice || "*"}-${maxPrice || "*"}`);
  const response = await fetch(target, { headers, signal: AbortSignal.timeout(15_000) });
  const data = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) {
    if (!token && (response.status === 401 || response.status === 403)) {
      throw new Error("O Mercado Livre exige um Access Token oficial para esta consulta. Crie uma aplicação no DevCenter e salve o token nesta aba.");
    }
    throw new Error(data.message || `O Mercado Livre recusou a consulta (HTTP ${response.status}).`);
  }
  const items = (data.results || []).map((item: Record<string, any>) => ({
    id: item.id,
    title: item.title,
    imageUrl: mlImage(item.thumbnail),
    url: item.permalink,
    price: item.price ?? null,
    originalPrice: item.original_price ?? null,
    currency: item.currency_id || "BRL",
    condition: item.condition || null,
    availableQuantity: item.available_quantity ?? null,
    soldQuantity: item.sold_quantity ?? null,
    freeShipping: Boolean(item.shipping?.free_shipping),
    seller: item.seller?.nickname || item.seller?.id || null,
    categoryId: item.category_id || null,
    officialStore: item.official_store_name || null,
    installments: item.installments || null,
    attributes: item.attributes || [],
    raw: item,
  }));
  return {
    store: "mercadolivre",
    query,
    items,
    total: data.paging?.total || items.length,
    filters: data.available_filters || [],
    appliedFilters: data.filters || [],
    sorts: data.available_sorts || [],
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
