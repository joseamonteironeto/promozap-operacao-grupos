import { parseMercadoLivreCookies } from "@/lib/mercadolivre-affiliate";
import { readIntegrationSecret } from "@/lib/integration-secret";
import type { MercadoLivreOffer } from "@/lib/mercadolivre-api";

type Row = Record<string, any>;

export type MercadoLivreMarketplaceResult = {
  items: MercadoLivreOffer[];
  pagesScanned: number;
  requestedPages: number;
  finalUrl: string | null;
  blocked: boolean;
  warning: string | null;
};

const browserHeaders = (cookie?: string): HeadersInit => ({
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
  "Cache-Control": "no-cache",
  ...(cookie ? { Cookie: cookie } : {}),
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36",
});

function decodeHtml(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("\\/", "/")
    .trim();
}

function textContent(html: string) {
  return decodeHtml(html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function attribute(tag: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return decodeHtml(tag.match(new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] || "") || null;
}

function classFragment(html: string, className: string) {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<([a-z0-9]+)\\b[^>]*class=["'][^"']*${escaped}[^"']*["'][^>]*>[\\s\\S]*?<\\/\\1>`, "i"));
  return match?.[0] || "";
}

function moneyFromLabel(value: string | null) {
  if (!value) return null;
  const normalized = decodeHtml(value).replace(/^Antes:\s*/i, "");
  const reais = normalized.match(/([\d.]+)\s*reais?/i)?.[1];
  if (!reais) return null;
  const integer = Number(reais.replaceAll(".", ""));
  const cents = Number(normalized.match(/com\s+(\d{1,2})\s+centavos?/i)?.[1] || 0);
  return Number.isFinite(integer) ? integer + cents / 100 : null;
}

function ariaMoney(html: string) {
  for (const match of html.matchAll(/aria-label=["']([^"']*(?:reais?|R\$)[^"']*)["']/gi)) {
    const amount = moneyFromLabel(match[1]);
    if (amount != null) return amount;
  }
  const fraction = html.match(/andes-money-amount__fraction[^>]*>([\d.]+)</i)?.[1];
  const cents = html.match(/andes-money-amount__cents[^>]*>(\d{1,2})</i)?.[1];
  if (!fraction) return null;
  const integer = Number(fraction.replaceAll(".", ""));
  return Number.isFinite(integer) ? integer + Number(cents || 0) / 100 : null;
}

function itemIdFrom(value: string) {
  const decoded = decodeURIComponent(value);
  const match = decoded.match(/(?:item_id[:=]|wid=|\/MLB-?)(MLB)?-?(\d{7,})/i) || decoded.match(/\b(MLB)(\d{7,})\b/i);
  return match ? `MLB${match[2]}`.toUpperCase() : null;
}

function soldQuantity(text: string) {
  const match = text.match(/(?:mais de\s+)?([\d.,]+)\s*(mil)?\s+(?:produtos?\s+)?vendidos?/i);
  if (!match) return null;
  const base = Number(match[1].replaceAll(".", "").replace(",", "."));
  return Number.isFinite(base) ? Math.round(base * (match[2] ? 1000 : 1)) : null;
}

function imageFromCard(card: string) {
  const tag = card.match(/<img\b[^>]*class=["'][^"']*poly-component__picture[^"']*["'][^>]*>/i)?.[0]
    || card.match(/<img\b[^>]*(?:data-src|src)=["'][^"']+mlstatic[^"']*["'][^>]*>/i)?.[0]
    || "";
  const value = attribute(tag, "data-src") || attribute(tag, "src");
  if (!value) return null;
  try {
    const url = new URL(value.replace(/^http:/, "https:"));
    return url.protocol === "https:" ? url.href.replace(/-I\.jpg$/i, "-O.jpg") : null;
  } catch { return null; }
}

function parseCard(card: string, position: number): MercadoLivreOffer | null {
  const titleTag = card.match(/<a\b[^>]*class=["'][^"']*poly-component__title[^"']*["'][^>]*>[\s\S]*?<\/a>/i)?.[0] || "";
  const href = attribute(titleTag, "href") || attribute(card.match(/<a\b[^>]*href=["'][^"']+["'][^>]*>/i)?.[0] || "", "href");
  const itemId = itemIdFrom(`${href || ""} ${card}`);
  const title = textContent(titleTag) || textContent(classFragment(card, "poly-component__title"));
  if (!itemId || !title) return null;
  const currentBlock = classFragment(card, "poly-price__current");
  const previousBlock = classFragment(card, "andes-money-amount--previous");
  const price = ariaMoney(currentBlock);
  const originalPrice = ariaMoney(previousBlock);
  const cardText = textContent(card);
  const discountPercentage = Number(cardText.match(/(\d{1,3})%\s*OFF/i)?.[1] || 0);
  const couponBlock = classFragment(card, "poly-component__coupons");
  const couponText = textContent(couponBlock);
  const couponPrice = ariaMoney(couponBlock);
  const installmentBlock = classFragment(card, "poly-price__installments");
  const installmentText = textContent(installmentBlock);
  const installmentQuantity = Number(installmentText.match(/(\d+)x/i)?.[1] || 0);
  const sellerText = textContent(classFragment(card, "poly-component__seller"));
  const canonicalUrl = `https://produto.mercadolivre.com.br/MLB-${itemId.slice(3)}`;
  const imageUrl = imageFromCard(card);
  const full = /enviado pelo full|mercado envios full/i.test(cardText);
  const freeShipping = /frete gr[aá]tis|chegar[aá] gr[aá]tis/i.test(cardText);
  const officialStore = /loja oficial/i.test(cardText) ? (sellerText || "Loja oficial") : null;
  const promotionType = couponText ? "MARKETPLACE_COUPON" : discountPercentage > 0 ? "MARKETPLACE_DISCOUNT" : null;
  return {
    id: itemId,
    itemId,
    catalogProductId: null,
    title,
    imageUrl,
    url: canonicalUrl,
    price,
    originalPrice: originalPrice != null && (price == null || originalPrice > price) ? originalPrice : null,
    discountPercentage: discountPercentage || (price && originalPrice && originalPrice > price ? Math.round((1 - price / originalPrice) * 100) : 0),
    currency: "BRL",
    condition: /usado/i.test(cardText) ? "used" : /recondicionado/i.test(cardText) ? "refurbished" : "new",
    availableQuantity: null,
    soldQuantity: soldQuantity(cardText),
    freeShipping,
    full,
    logisticType: full ? "fulfillment" : null,
    seller: sellerText.replace(/^por\s+/i, "") || null,
    sellerId: null,
    sellerReputation: null,
    categoryId: null,
    categoryName: null,
    officialStore,
    installments: installmentQuantity ? { quantity: installmentQuantity, amount: ariaMoney(installmentBlock), rate: /sem juros/i.test(installmentText) ? 0 : null } : null,
    warranty: null,
    attributes: [],
    pictures: imageUrl ? [{ id: null, url: imageUrl, secure_url: imageUrl }] : [],
    saleTerms: [],
    tags: [freeShipping ? "free_shipping" : "", full ? "fulfillment" : "", couponText ? "coupon" : ""].filter(Boolean),
    bestSellerPosition: /mais vendido/i.test(cardText) ? position : null,
    promotionType,
    promotionId: null,
    priceId: null,
    priceSource: "marketplace_page",
    priceUpdatedAt: new Date().toISOString(),
    promotions: promotionType ? [{ type: promotionType, status: "active", text: couponText || `${discountPercentage}% OFF` }] : [],
    coupon: couponText ? { code: null, text: couponText, price: couponPrice, source: "marketplace_page" } : null,
    source: "web_search",
    raw: { source: "marketplace_page", position, cardText, couponText: couponText || null, couponPrice },
  };
}

function pageUrl(source: URL, page: number) {
  const url = new URL(source.href);
  url.hash = "";
  url.pathname = url.pathname.replace(/_Desde_\d+(?:_NoIndex_True)?/i, "");
  if (page > 1) url.pathname = `${url.pathname.replace(/\/$/, "")}_Desde_${1 + (page - 1) * 48}_NoIndex_True`;
  return url;
}

function listingCards(html: string) {
  return [...html.matchAll(/<li\b[^>]*class=["'][^"']*ui-search-layout__item[^"']*["'][^>]*>[\s\S]*?<\/li>/gi)].map((match) => match[0]);
}

async function cookieHeader() {
  const stored = await readIntegrationSecret("mercadolivre_session_cookies");
  return stored ? parseMercadoLivreCookies(stored)?.header : undefined;
}

export function mercadoLivreListingUrl(query: string) {
  const slug = query.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return `https://lista.mercadolivre.com.br/${slug || "ofertas"}`;
}

export async function scrapeMercadoLivreListing(sourceInput: string, maxPages = 1, maxItems = 50): Promise<MercadoLivreMarketplaceResult> {
  const source = new URL(sourceInput);
  if (source.protocol !== "https:" || !(source.hostname === "mercadolivre.com.br" || source.hostname.endsWith(".mercadolivre.com.br"))) {
    throw new Error("A consulta por página aceita somente URLs HTTPS do Mercado Livre Brasil.");
  }
  const requestedPages = Math.max(1, Math.min(20, Math.floor(maxPages)));
  const cookie = await cookieHeader();
  const items = new Map<string, MercadoLivreOffer>();
  let pagesScanned = 0;
  let finalUrl: string | null = null;
  let blocked = false;
  for (let page = 1; page <= requestedPages && items.size < maxItems; page += 1) {
    const response = await fetch(pageUrl(source, page), {
      headers: browserHeaders(cookie), redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    finalUrl = response.url;
    const html = await response.text();
    if (!response.ok || /account-verification|identification|captcha/i.test(response.url) || /robot|captcha/i.test(html.slice(0, 80_000))) {
      blocked = true;
      break;
    }
    const cards = listingCards(html);
    if (!cards.length) break;
    pagesScanned += 1;
    for (const card of cards) {
      const offer = parseCard(card, items.size + 1);
      if (offer && !items.has(offer.id)) items.set(offer.id, offer);
      if (items.size >= maxItems) break;
    }
    if (cards.length < 10) break;
  }
  return {
    items: [...items.values()], pagesScanned, requestedPages, finalUrl, blocked,
    warning: blocked ? "O Mercado Livre pediu uma validação de sessão. Atualize os cookies em Afiliados e tente novamente." : !items.size ? "Nenhum cartão de produto foi encontrado nessa página." : null,
  };
}

