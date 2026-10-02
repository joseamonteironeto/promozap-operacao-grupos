import { readIntegrationSecret } from "@/lib/integration-secret";

type AmazonToken = { value: string; expiresAt: number };
let cachedToken: AmazonToken | null = null;

function pickImage(item: Record<string, any>) {
  const primary = item.images?.primary || {};
  return primary.hiRes?.url || primary.large?.url || primary.medium?.url || primary.small?.url || null;
}

function pickListing(item: Record<string, any>) {
  const listings = item.offersV2?.listings || item.offers?.listings || [];
  return Array.isArray(listings) ? listings[0] || null : null;
}

function amount(value: any): number | null {
  const candidate = value?.money?.amount ?? value?.amount ?? value?.price?.amount ?? value?.displayAmount;
  const parsed = typeof candidate === "number" ? candidate : Number(String(candidate || "").replace(/[^\d,.-]/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

async function credentials() {
  const [clientId, clientSecret] = await Promise.all([
    readIntegrationSecret("amazon_creators_client_id"),
    readIntegrationSecret("amazon_creators_client_secret"),
  ]);
  return { clientId, clientSecret };
}

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const { clientId, clientSecret } = await credentials();
  if (!clientId || !clientSecret) throw new Error("AMAZON_CREDENTIALS_REQUIRED");
  const response = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "creatorsapi::default",
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const result = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string; message?: string };
  if (!response.ok || !result.access_token) throw new Error(result.error_description || result.message || `A Amazon recusou a autenticação (HTTP ${response.status}).`);
  cachedToken = { value: result.access_token, expiresAt: Date.now() + Math.max(300, result.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

export async function amazonCredentialsStatus() {
  const { clientId, clientSecret } = await credentials();
  return { configured: Boolean(clientId && clientSecret) };
}

export async function searchAmazonProducts(input: {
  keywords: string;
  partnerTag: string;
  searchIndex?: string;
  sortBy?: string;
  minPrice?: number;
  maxPrice?: number;
  brand?: string;
  itemCount?: number;
}) {
  const token = await accessToken();
  const payload: Record<string, unknown> = {
    marketplace: "www.amazon.com.br",
    partnerTag: input.partnerTag,
    keywords: input.keywords,
    searchIndex: input.searchIndex || "All",
    itemCount: Math.min(10, Math.max(1, input.itemCount || 10)),
    resources: [
      "images.primary.large", "images.primary.medium", "itemInfo.title", "itemInfo.byLineInfo",
      "itemInfo.features", "itemInfo.productInfo", "offersV2.listings.price", "offersV2.listings.availability",
      "offersV2.listings.condition", "offersV2.listings.dealDetails", "offersV2.listings.merchantInfo",
      "browseNodeInfo", "parentASIN", "searchRefinements",
    ],
  };
  if (input.sortBy) payload.sortBy = input.sortBy;
  if (input.brand) payload.brand = input.brand;
  if (input.minPrice && input.minPrice > 0) payload.minPrice = Math.round(input.minPrice * 100);
  if (input.maxPrice && input.maxPrice > 0) payload.maxPrice = Math.round(input.maxPrice * 100);

  const response = await fetch("https://creatorsapi.amazon/catalog/v1/searchItems", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-marketplace": "www.amazon.com.br" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) {
    const message = data?.errors?.[0]?.message || data?.message || `A Amazon recusou a consulta (HTTP ${response.status}).`;
    throw new Error(message);
  }
  const result = data.searchResult || {};
  const items = (result.items || []).map((item: Record<string, any>) => {
    const listing = pickListing(item);
    return {
      id: item.asin,
      title: item.itemInfo?.title?.displayValue || item.asin,
      imageUrl: pickImage(item),
      url: item.detailPageURL,
      price: amount(listing?.price),
      originalPrice: amount(listing?.dealDetails?.listPrice),
      currency: listing?.price?.money?.currency || "BRL",
      brand: item.itemInfo?.byLineInfo?.brand?.displayValue || null,
      condition: listing?.condition?.displayValue || listing?.condition?.value || null,
      availability: listing?.availability?.message || listing?.availability?.type || null,
      seller: listing?.merchantInfo?.name || null,
      parentId: item.parentASIN || null,
      features: item.itemInfo?.features?.displayValues || [],
      raw: item,
    };
  });
  return { items, total: result.totalResultCount || items.length, filters: result.searchRefinements || {}, searchUrl: result.searchURL || null };
}
