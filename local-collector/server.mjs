import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const stateDir = join(here, "state");
const profileDir = join(stateDir, "chrome-profile");
const tokenFile = join(stateDir, "token.txt");
const priceHistoryFile = join(stateDir, "price-history.json");
const collectorPort = Number(process.env.PROMOZAP_COLLECTOR_PORT || 8765);
const debugPort = Number(process.env.PROMOZAP_CHROME_DEBUG_PORT || 9223);
const allowedOrigins = new Set([
  "https://promozap-operacao-grupos.joseattax.chatgpt.site",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  `http://127.0.0.1:${collectorPort}`,
  `http://localhost:${collectorPort}`,
]);

mkdirSync(stateDir, { recursive: true });
mkdirSync(profileDir, { recursive: true });
const localToken = process.env.PROMOZAP_LOCAL_TOKEN || (existsSync(tokenFile)
  ? readFileSync(tokenFile, "utf8").trim()
  : randomBytes(24).toString("hex"));
if (!existsSync(tokenFile)) writeFileSync(tokenFile, `${localToken}\n`, { mode: 0o600 });

function readPriceHistory() {
  try { return JSON.parse(readFileSync(priceHistoryFile, "utf8")); } catch { return {}; }
}

function recordPriceHistory(product) {
  const key = product.itemId || product.userProductId || product.canonicalUrl || product.url;
  const price = product.coupon?.price || product.pixPrice || product.standardPrice || product.price;
  if (!key || !Number.isFinite(price)) return [];
  const database = readPriceHistory();
  const rows = Array.isArray(database[key]) ? database[key] : [];
  const point = {
    capturedAt: product.capturedAt || new Date().toISOString(),
    price,
    pixPrice: product.pixPrice || null,
    standardPrice: product.standardPrice || null,
    originalPrice: product.originalPrice || null,
    couponPrice: product.coupon?.price || null,
  };
  const last = rows.at(-1);
  const sixHours = 6 * 60 * 60 * 1000;
  if (!last || last.price !== point.price || Date.parse(point.capturedAt) - Date.parse(last.capturedAt) >= sixHours) rows.push(point);
  database[key] = rows.filter((row) => Date.now() - Date.parse(row.capturedAt) <= 180 * 24 * 60 * 60 * 1000).slice(-200);
  writeFileSync(priceHistoryFile, JSON.stringify(database, null, 2), "utf8");
  return database[key];
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : "",
  ].filter(Boolean);
  return candidates.find(existsSync) || null;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureChrome() {
  try {
    const current = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(800) });
    if (current.ok) return;
  } catch {}

  const chrome = findChrome();
  if (!chrome) throw new Error("Google Chrome não foi encontrado neste computador.");
  const child = spawn(chrome, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "about:blank",
  ], { detached: true, stdio: "ignore" });
  child.unref();

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(800) });
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error("O Chrome foi aberto, mas o coletor não conseguiu se conectar a ele.");
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Tempo excedido ao conectar ao Chrome.")), 5000);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Falha ao conectar ao Chrome.")); }, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  waitFor(method, timeout = 20000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeout);
      const listener = (params) => {
        clearTimeout(timer);
        this.listeners.set(method, (this.listeners.get(method) || []).filter((item) => item !== listener));
        resolve(params);
      };
      this.listeners.set(method, [...(this.listeners.get(method) || []), listener]);
    });
  }

  close() {
    this.ws?.close();
  }
}

function normalizeInput(input) {
  const value = String(input || "").trim();
  if (!value) throw new Error("Cole uma URL ou um código MLB.");
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    const allowed = url.hostname === "mercadolivre.com.br" || url.hostname.endsWith(".mercadolivre.com.br");
    if (url.protocol !== "https:" || !allowed) throw new Error("Use uma URL HTTPS do Mercado Livre Brasil.");
    url.hash = "";
    return url.toString();
  }
  const item = value.match(/\bMLB-?(\d{7,})\b/i);
  if (item) return `https://produto.mercadolivre.com.br/MLB-${item[1]}`;
  if (/\bMLBU\d{7,}\b/i.test(value)) {
    throw new Error("O código MLBU isolado não informa o endereço completo. Cole a URL /up/MLBU...; depois da primeira coleta o painel também exibirá o MLB real do anúncio.");
  }
  throw new Error("Não reconheci esse valor. Cole a URL completa, MLB123... ou MLB-123....");
}

const extractor = String.raw`(() => {
  const text = (selector) => document.querySelector(selector)?.textContent?.trim() || null;
  const allText = (selector) => [...document.querySelectorAll(selector)].map((node) => node.textContent?.trim()).filter(Boolean);
  const money = (value) => {
    const match = String(value || '').match(/(?:R\$\s*)?([\d.]+(?:,\d{1,2})?)/);
    return match ? Number(match[1].replace(/\./g, '').replace(',', '.')) : null;
  };
  const moneyAll = (value) => [...String(value || '').matchAll(/R\$\s*([\d.]+(?:,\d{1,2})?)/g)]
    .map((match) => Number(match[1].replace(/\./g, '').replace(',', '.'))).filter(Number.isFinite);
  const number = (value) => {
    const match = String(value || '').match(/([\d.,]+)/);
    if (!match) return null;
    const amount = Number(match[1].replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(amount) ? amount : null;
  };
  const meta = (name) => document.querySelector('meta[property="' + name + '"],meta[name="' + name + '"]')?.content || null;
  const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')].map((node) => {
    try { return JSON.parse(node.textContent || 'null'); } catch { return null; }
  }).filter(Boolean);
  const productJson = jsonLd.find((entry) => entry && entry['@type'] === 'Product') || {};
  const nordicScript = [...document.scripts].find((node) => (node.textContent || '').startsWith('_n.ctx.r='));
  const parseNordicState = () => {
    if (!nordicScript) return null;
    const raw = nordicScript.textContent.slice('_n.ctx.r='.length);
    let depth = 0, inString = false, escaped = false, end = -1;
    for (let index = 0; index < raw.length; index += 1) {
      const char = raw[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}' && --depth === 0) { end = index + 1; break; }
    }
    try { return end > 0 ? JSON.parse(raw.slice(0, end)) : null; } catch { return null; }
  };
  const nordicState = parseNordicState();
  const trackedProduct = nordicState?.appProps?.pageProps?.initialState?.components?.track?.melidata_event?.event_data || {};
  const trackedPricing = trackedProduct?.credit_view_components?.pricing || {};
  const pageText = document.body?.innerText || '';
  const priceContainer = document.querySelector('.ui-pdp-container__row--price, .ui-pdp-price');
  const priceText = priceContainer?.textContent || '';
  const originalPrice = money(text('.ui-pdp-price__original-value')) || trackedPricing.original_price || trackedProduct.original_price || null;
  const pixPrice = money(text('.ui-pdp-price__price-breakdown-inline .andes-money-amount')) || money(productJson?.offers?.price);
  const subtitlePrices = allText('[class*="pricing_price_subtitle"] .andes-money-amount').map(money).filter((value) => value != null);
  const standardPrice = subtitlePrices[0] || money(priceText.match(/ou\s*(R\$\s*[\d.,]+)/i)?.[1]) || trackedPricing.actual_price || trackedProduct.price || null;
  const installmentAmount = subtitlePrices[1] || money(priceText.match(/\d+x\s*(R\$\s*[\d.,]+)/i)?.[1]) || null;
  const promotionTexts = (trackedPricing.promotions || []).map((item) => item?.payment_method || item?.text).filter(Boolean);
  const couponCondition = promotionTexts.find((value) => /cupom|ganhe\s+R\$/i.test(value)) || null;
  const couponText = allText('button, a, [class*="coupon"], [class*="rebate"]').find((value) => /cupom/i.test(value))
    || pageText.match(/(?:R\$\s*[\d.,]+\s+OFF\s+com\s+Cupom|R\$\s*[\d.,]+\s+com\s+cupom)/i)?.[0]
    || couponCondition;
  const couponAmounts = moneyAll(couponText);
  const explicitCouponPrice = /com\s+cupom/i.test(couponText || '') && !/OFF\s+com\s+cupom/i.test(couponText || '') ? couponAmounts.at(-1) : null;
  const amountOff = money((couponText || '').match(/(?:ganhe\s+)?R\$\s*[\d.,]+\s+OFF/i)?.[0]);
  const minimumPurchase = money((couponText || '').match(/(?:compre|acima de)\s+R\$\s*[\d.,]+/i)?.[0]);
  const couponAppliesToSingleItem = !minimumPurchase || (standardPrice && standardPrice >= minimumPurchase);
  const couponPrice = explicitCouponPrice || (amountOff && standardPrice && couponAppliesToSingleItem ? Math.max(0, standardPrice - amountOff) : null);
  const couponCode = pageText.match(/(?:cupom|código)\s*[:\-]?\s*([A-Z0-9]{4,20})/i)?.[1] || null;
  const discountText = text('.andes-money-amount__discount') || priceContainer?.textContent?.match(/\d+%\s*OFF/i)?.[0] || null;
  const discountPercentage = number(discountText);
  const headerTop = text('.ui-pdp-header__subtitle, .ui-pdp-header__subtitle-container') || '';
  const soldText = headerTop.match(/(?:\+|mais de\s+)?[\d.,]+\s*(?:mil\s+)?vendidos?/i)?.[0] || null;
  const condition = headerTop.split('|')[0]?.trim() || null;
  const itemId = (meta('twitter:app:url:iphone') || meta('twitter:app:url:googleplay') || pageText).match(/MLB\d{7,}/i)?.[0]?.toUpperCase() || null;
  const userProductId = location.pathname.match(/\/up\/(MLBU\d+)/i)?.[1]?.toUpperCase() || productJson.sku || null;
  const canonicalUrl = document.querySelector('link[rel="canonical"]')?.href || location.href.split('#')[0];
  const images = [...new Set([
    productJson.image,
    meta('og:image'),
    ...[...document.querySelectorAll('.ui-pdp-gallery img, img.ui-pdp-image')].flatMap((img) => [img.currentSrc, img.src]),
  ].filter(Boolean))];
  const attributes = [...document.querySelectorAll('.ui-vpp-highlighted-specs table tr, .andes-table tbody tr')].map((row) => {
    const cells = [...row.querySelectorAll('th,td')].map((cell) => cell.textContent?.trim()).filter(Boolean);
    return cells.length >= 2 ? { name: cells[0], value_name: cells.slice(1).join(' ') } : null;
  }).filter(Boolean);
  const highlighted = allText('.ui-vpp-highlighted-specs__features-list-item');
  const sellerBox = document.querySelector('.ui-pdp-seller-summary');
  const sellerName = text('.ui-pdp-seller-summary__link, .ui-pdp-seller-summary__link-trigger-button');
  const sellerSales = text('.ui-pdp-seller-summary__header__subtitle');
  const officialStore = /loja oficial/i.test(sellerBox?.textContent || '') ? sellerName : null;
  const stockText = document.querySelector('#quantity-selector')?.textContent?.trim() || allText('*').find((value) => /^Estoque disponível$/i.test(value)) || null;
  const availableQuantity = number(stockText?.match(/\+?[\d.,]+\s+dispon/i)?.[0]);
  const deliveryText = [...document.querySelectorAll('[class*="shipping"], [class*="delivery"], [id*="shipping"]')]
    .map((node) => node.textContent?.trim()).find((value) => /chegar|frete|entrega/i.test(value || '') && (value || '').length < 300) || null;
  const ratingLabel = [...document.querySelectorAll('a[aria-label], button[aria-label]')].map((node) => node.getAttribute('aria-label')).find((value) => /avaliação/i.test(value || '')) || null;
  const installmentText = priceContainer?.textContent?.match(/\d+x\s*R\$\s*[\d.,]+(?:\s*sem juros)?/i)?.[0] || null;
  const installmentCount = number(installmentText);
  const categories = [...document.querySelectorAll('nav a, .ui-pdp-breadcrumb a')].filter((a) => /mercadolivre\.com\.br\/(?:c|.*categoria|.*beleza|.*perfume)/i.test(a.href || '')).slice(0, 8).map((a) => a.textContent?.trim()).filter(Boolean);
  const description = text('.ui-pdp-description__content') || productJson.description || meta('og:description');
  const title = text('h1') || productJson.name || meta('og:title')?.replace(/\s+-\s+R\$.*$/, '') || document.title;
  const captcha = /confirme que você é humano|valide sua identidade|não sou um robô|captcha/i.test(pageText);
  const login = /\/login\//i.test(location.pathname);
  return {
    ok: !captcha && !login,
    needsUserAction: captcha || login,
    userActionMessage: captcha ? 'O Mercado Livre pediu uma validação. Resolva-a na janela do Chrome e tente novamente.' : login ? 'Entre na sua conta na janela do Chrome e tente novamente.' : null,
    capturedAt: new Date().toISOString(),
    source: 'mercadolivre_browser_page',
    url: location.href,
    canonicalUrl,
    title,
    itemId,
    userProductId,
    brand: productJson.brand || attributes.find((item) => /marca/i.test(item.name))?.value_name || null,
    currency: productJson?.offers?.priceCurrency || 'BRL',
    price: pixPrice || standardPrice,
    pixPrice,
    standardPrice,
    originalPrice,
    discountPercentage,
    discountText,
    coupon: couponText ? {
      available: true,
      text: couponText,
      code: couponCode,
      price: couponPrice,
      amountOff,
      percentageOff: amountOff && standardPrice ? Math.round((amountOff / standardPrice) * 1000) / 10 : null,
      minimumPurchase,
      appliesToSingleItem: couponAppliesToSingleItem,
      automatic: !couponCode,
      conditions: promotionTexts,
      personalized: Boolean(trackedProduct.user_type && trackedProduct.user_type !== 'not_apply'),
    } : null,
    installments: installmentText ? { text: installmentText, quantity: installmentCount, amount: installmentAmount, noInterest: /sem juros/i.test(installmentText) } : null,
    availability: productJson?.offers?.availability || null,
    priceValidUntil: productJson?.offers?.priceValidUntil || null,
    condition,
    soldText,
    availableQuantity: availableQuantity || trackedProduct.quantity || null,
    stockText,
    seller: sellerName || trackedProduct.seller_name || null,
    sellerSales,
    officialStore,
    deliveryText,
    freeShipping: /grátis|gratis/i.test(deliveryText || '') || productJson?.offers?.shippingDetails?.shippingRate?.value === 0,
    ratingText: ratingLabel,
    images,
    imageUrl: images[0] || null,
    categories: [...new Set(categories)],
    highlighted,
    attributes,
    description,
    personalizedContext: {
      loggedIn: Boolean(document.querySelector('[class*="user-menu"]')),
      postalCode: document.body?.innerText.match(/\b\d{5}-?\d{3}\b/)?.[0] || null,
      firstPurchaseBenefit: /primeira compra/i.test(pageText),
      meliPlus: /meli\+/i.test(pageText),
    },
    promotions: trackedProduct.available_promotions || [],
    structuredData: productJson,
  };
})()`;

const reviewExtractor = String.raw`(() => {
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const comments = [...document.querySelectorAll('.ui-review-capability-comments__comment, article')]
    .filter((node) => node.querySelector('[class*="comment__content"], [data-testid*="comment"]'))
    .slice(0, 10);
  const reviews = comments.map((comment, index) => {
    const ratingLabel = comment.querySelector('[aria-label*="Avaliação" i]')?.getAttribute('aria-label')
      || comment.querySelector('.ui-review-capability-comments__comment__rating')?.textContent || '';
    const rating = Number(ratingLabel.match(/([1-5](?:[.,]\d)?)\s*(?:de\s*5)?/i)?.[1]?.replace(',', '.')) || null;
    const date = clean(comment.querySelector('.ui-review-capability-comments__comment__date, time')?.textContent);
    const contentNode = comment.querySelector('.ui-review-capability-comments__comment__content, [class*="comment__content"]');
    const text = clean(contentNode?.textContent?.replace(/Traduzido|Ver original/gi, ' '));
    const headerLines = (comment.querySelector('.ui-review-capability-comments__comment__header')?.innerText || '')
      .split('\n').map(clean).filter(Boolean);
    const country = headerLines.find((line) => !/avaliação|há\s+\d|ontem|hoje|traduzido/i.test(line) && !/^\d(?:[.,]\d)?$/.test(line)) || null;
    const images = [...new Set([...comment.querySelectorAll('img[alt*="Foto do produto compartilhada" i], img[src*="mlstatic.com"]')]
      .map((img) => img.currentSrc || img.src).filter(Boolean))].slice(0, 12);
    const usefulLabel = [...comment.querySelectorAll('[aria-label]')].map((node) => node.getAttribute('aria-label'))
      .find((value) => /pessoa.*achou|útil/i.test(value || '')) || '';
    const usefulCount = Number(usefulLabel.match(/(\d+)/)?.[1]) || 0;
    return { position: index + 1, rating, country, date, text, images, usefulCount };
  }).filter((review) => review.text || review.images.length);
  const pageText = document.body?.innerText || '';
  const total = Number(pageText.match(/Todas as opiniões\s*\(([\d.]+)\)/i)?.[1]?.replace(/\./g, ''))
    || Number(pageText.match(/([\d.]+)\s+opiniões/i)?.[1]?.replace(/\./g, '')) || null;
  return { reviews, total, sourceUrl: location.href, capturedAt: new Date().toISOString() };
})()`;

const dealsExtractor = String.raw`(() => {
  const amount = (root) => {
    if (!root) return null;
    const label = root.getAttribute?.('aria-label');
    if (label) {
      const reais = label.match(/([\d.]+)\s+reais?/i)?.[1];
      const cents = label.match(/(\d+)\s+centavos?/i)?.[1];
      if (reais) return Number(reais.replace(/\./g, '')) + (cents ? Number(cents) / 100 : 0);
    }
    const fraction = root.querySelector?.('.andes-money-amount__fraction')?.textContent || root.textContent || '';
    const cents = root.querySelector?.('.andes-money-amount__cents')?.textContent || '';
    const value = Number(fraction.replace(/[^\d]/g, '')) + (cents ? Number(cents.replace(/\D/g, '')) / 100 : 0);
    return Number.isFinite(value) && value > 0 ? value : null;
  };
  const categories = [...document.querySelectorAll('.list-filter__list-element')].map((node) => {
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    const count = Number(text.match(/\((\d+)\)/)?.[1] || 0);
    return { name: text.replace(/\s*\(\d+\)\s*$/, ''), count };
  }).filter((item) => item.name && !/R\$|Parcelamento|Grátis/i.test(item.name));
  const cards = [...document.querySelectorAll('.poly-card')].map((card, index) => {
    const link = card.querySelector('a.poly-component__title, h2 a, h3 a');
    const title = link?.textContent?.trim();
    if (!title || !link?.href) return null;
    const previous = amount(card.querySelector('.andes-money-amount--previous'));
    const current = amount(card.querySelector('.poly-price__current .poly-price__amount, .poly-price__current .andes-money-amount'));
    const discountText = card.querySelector('.poly-price__discount-polylabel, [class*="discount"]')?.textContent?.trim() || '';
    const discountPercentage = Number(discountText.match(/(\d+)\s*%\s*OFF/i)?.[1] || 0) || null;
    const text = (card.innerText || '').replace(/\s+/g, ' ').trim();
    const couponMatch = text.match(/R\$\s*([\d.,]+)\s*OFF\s+com\s+Cupom/i);
    const couponAmount = couponMatch ? Number(couponMatch[1].replace(/\./g, '').replace(',', '.')) : null;
    const coupon = /com\s+Cupom/i.test(text) ? {
      available: true,
      text: couponMatch?.[0] || 'Preço promocional com cupom',
      amountOff: couponAmount,
      price: couponAmount && current ? Math.max(0, current - couponAmount) : (/com\s+Cupom/i.test(discountText) ? current : null),
      automatic: true,
    } : null;
    const ratingText = card.querySelector('[aria-label*="Classificação"]')?.getAttribute('aria-label') || '';
    const seller = card.querySelector('.poly-component__seller')?.textContent?.replace(/\s+/g, ' ').trim() || null;
    const image = card.querySelector('img');
    return {
      position: index + 1,
      title,
      url: link.href.split('#')[0],
      imageUrl: image?.currentSrc || image?.src || null,
      originalPrice: previous,
      price: current,
      pixPrice: /no Pix/i.test(text) ? current : null,
      discountPercentage,
      discountText,
      coupon,
      seller,
      officialStore: /Loja oficial/i.test(text) || Boolean(card.querySelector('img[alt*="Loja oficial" i], [aria-label*="Loja oficial" i]')),
      rating: Number(ratingText.match(/([\d.,]+)\s+de\s+5/i)?.[1]?.replace(',', '.') || text.match(/\b([1-5][.,]\d)\s*\|/)?.[1]?.replace(',', '.')) || null,
      soldText: text.match(/\+?[\d.,]+\s*(?:mil\s+)?vendidos/i)?.[0] || null,
      freeShipping: /frete grátis|chegará grátis/i.test(text),
      dealOfDay: /OFERTA DO DIA/i.test(text),
      sourceText: text,
    };
  }).filter(Boolean);
  const nextUrl = document.querySelector('.andes-pagination__button--next a, a[aria-label*="Seguinte"], a[title*="Seguinte"]')?.href || null;
  return { url: location.href, categories, cards, nextUrl, totalText: document.querySelector('.results-quantity')?.textContent?.trim() || null };
})()`;

let scrapeQueue = Promise.resolve();

function normalizeDealsUrl(input) {
  const value = String(input || "https://www.mercadolivre.com.br/ofertas?promotion_type=deal_of_the_day").trim();
  const url = new URL(value);
  const allowed = url.hostname === "mercadolivre.com.br" || url.hostname.endsWith(".mercadolivre.com.br");
  if (url.protocol !== "https:" || !allowed || !url.pathname.startsWith("/ofertas")) {
    throw new Error("Use uma URL HTTPS da área /ofertas do Mercado Livre Brasil.");
  }
  url.hash = "";
  return url.toString();
}

async function createChromeTarget(url = "about:blank") {
  await ensureChrome();
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!response.ok) throw new Error("Não foi possível abrir uma aba controlada no Chrome.");
  const target = await response.json();
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  return { target, client };
}

async function closeChromeTarget(target, client) {
  client?.close();
  if (!target?.id) return;
  try { await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`); } catch {}
}

async function waitForPage(client, selectorExpression, timeout = 30000) {
  for (let elapsed = 0; elapsed < timeout; elapsed += 300) {
    const state = await client.call("Runtime.evaluate", { expression: selectorExpression, returnByValue: true });
    if (state?.result?.value) return true;
    await sleep(300);
  }
  return false;
}

function scoreDeal(product) {
  const effectivePrice = product.coupon?.price || product.pixPrice || product.price;
  const referencePrice = product.originalPrice;
  const realDiscount = referencePrice && effectivePrice && referencePrice > effectivePrice
    ? Math.round(((referencePrice - effectivePrice) / referencePrice) * 1000) / 10
    : product.discountPercentage || 0;
  let score = Math.min(60, realDiscount * 1.15);
  if (product.coupon) score += 14;
  if (product.dealOfDay) score += 8;
  if (product.freeShipping) score += 6;
  if (product.officialStore) score += 5;
  if ((product.rating || 0) >= 4.7) score += 4;
  if (/mil vendidos/i.test(product.soldText || "")) score += 3;
  const reasons = [];
  if (realDiscount) reasons.push(`${realDiscount}% abaixo do preço anterior`);
  if (product.coupon) reasons.push(product.coupon.text);
  if (product.freeShipping) reasons.push("frete grátis");
  if (product.officialStore) reasons.push("loja oficial");
  return {
    ...product,
    effectivePrice,
    realDiscountPercentage: realDiscount || null,
    isRealDeal: Boolean(referencePrice && effectivePrice && referencePrice > effectivePrice && realDiscount >= 5),
    dealScore: Math.max(0, Math.min(100, Math.round(score))),
    scoreReasons: reasons,
  };
}

async function scanDeals(options = {}) {
  const startUrl = normalizeDealsUrl(options.url);
  const rawCategory = String(options.category || "").trim();
  const requestedCategory = /^geral$/i.test(rawCategory) ? "" : rawCategory;
  const limit = Math.max(1, Math.min(80, Number(options.limit) || 20));
  const minDiscount = Math.max(0, Math.min(95, Number(options.minDiscount) || 0));
  const couponsOnly = Boolean(options.couponsOnly);
  const { target, client } = await createChromeTarget();
  const collected = [];
  let categories = [];
  let currentUrl = startUrl;
  let totalText = null;
  try {
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    for (let page = 0; page < 20 && currentUrl && collected.length < limit; page += 1) {
      const loaded = client.waitFor("Page.loadEventFired", 30000);
      await client.call("Page.navigate", { url: currentUrl });
      await loaded;
      const ready = await waitForPage(client, "Boolean(document.querySelector('.poly-card') || /captcha|confirme que você é humano|valide sua identidade/i.test(document.body?.innerText || ''))", 35000);
      if (!ready) throw new Error("A página de ofertas demorou demais para carregar.");
      const blocked = await client.call("Runtime.evaluate", { expression: "/captcha|confirme que você é humano|valide sua identidade/i.test(document.body?.innerText || '')", returnByValue: true });
      if (blocked?.result?.value) throw new Error("O Mercado Livre pediu validação. Resolva o CAPTCHA na janela do Chrome e tente novamente.");

      if (page === 0 && requestedCategory) {
        const clickResult = await client.call("Runtime.evaluate", {
          expression: `(() => { const wanted=${JSON.stringify(requestedCategory.toLocaleLowerCase("pt-BR"))}; const norm=(v)=>String(v||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase(); const node=[...document.querySelectorAll('.list-filter__list-element')].find((item)=>norm(item.textContent).includes(norm(wanted))); if(!node)return false; node.click(); return true; })()`,
          returnByValue: true,
        });
        if (!clickResult?.result?.value) throw new Error(`A categoria “${requestedCategory}” não apareceu nos filtros desta página.`);
        await sleep(2500);
        await waitForPage(client, "Boolean(document.querySelector('.poly-card'))", 15000);
      }

      const result = await client.call("Runtime.evaluate", { expression: dealsExtractor, returnByValue: true });
      if (result?.exceptionDetails) throw new Error("Não foi possível ler os cartões da página de ofertas.");
      const pageData = result.result.value;
      if (!categories.length) categories = pageData.categories || [];
      totalText ||= pageData.totalText;
      for (const card of pageData.cards || []) {
        const scored = scoreDeal(card);
        if ((scored.realDiscountPercentage || 0) < minDiscount) continue;
        if (couponsOnly && !scored.coupon) continue;
        if (!collected.some((item) => item.url === scored.url)) collected.push(scored);
        if (collected.length >= limit) break;
      }
      currentUrl = pageData.nextUrl;
    }
    collected.sort((a, b) => b.dealScore - a.dealScore || (b.realDiscountPercentage || 0) - (a.realDiscountPercentage || 0));
    return {
      ok: true,
      capturedAt: new Date().toISOString(),
      sourceUrl: startUrl,
      category: requestedCategory || "Geral",
      totalText,
      categories,
      products: collected,
      criteria: { limit, minDiscount, couponsOnly },
    };
  } finally {
    await closeChromeTarget(target, client);
  }
}

async function scrapeProduct(input) {
  const targetUrl = normalizeInput(input);
  const { target, client } = await createChromeTarget();
  try {
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    const loaded = client.waitFor("Page.loadEventFired", 25000);
    await client.call("Page.navigate", { url: targetUrl });
    await loaded;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const state = await client.call("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
      if (state?.result?.value === "complete") break;
      await sleep(300);
    }
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const rendered = await client.call("Runtime.evaluate", {
        expression: "Boolean(document.querySelector('.ui-pdp-price, .ui-pdp-container__row--price') || /confirme que você é humano|valide sua identidade|captcha/i.test(document.body?.innerText || ''))",
        returnByValue: true,
      });
      if (rendered?.result?.value) break;
      await sleep(300);
    }
    await sleep(500);
    const result = await client.call("Runtime.evaluate", { expression: extractor, awaitPromise: true, returnByValue: true });
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text || "Falha ao ler a página.");
    const product = result.result.value;
    if (!product?.ok) return product;

    let reviewsResult = null;
    const openReviews = await client.call("Runtime.evaluate", {
      expression: `(() => { const button=[...document.querySelectorAll('button,a')].find((node)=>/Mostrar todas as opiniões/i.test(node.textContent||'')); if(!button)return false; button.click(); return true; })()`,
      returnByValue: true,
    });
    if (openReviews?.result?.value) {
      const iframeReady = await waitForPage(client, "Boolean(document.querySelector('iframe.ui-pdp-iframe-reviews__content[src], iframe[src*=\"/catalog/reviews/\"]'))", 12000);
      if (iframeReady) {
        const iframeResult = await client.call("Runtime.evaluate", {
          expression: "document.querySelector('iframe.ui-pdp-iframe-reviews__content[src], iframe[src*=\"/catalog/reviews/\"]')?.src || null",
          returnByValue: true,
        });
        const reviewsUrl = iframeResult?.result?.value;
        if (reviewsUrl) {
          const reviewsLoaded = client.waitFor("Page.loadEventFired", 25000);
          await client.call("Page.navigate", { url: reviewsUrl });
          await reviewsLoaded;
          await waitForPage(client, "Boolean(document.querySelector('.ui-review-capability-comments__comment, article') || /captcha|confirme que você é humano/i.test(document.body?.innerText||''))", 25000);
          const reviewEvaluation = await client.call("Runtime.evaluate", { expression: reviewExtractor, returnByValue: true });
          if (!reviewEvaluation?.exceptionDetails) reviewsResult = reviewEvaluation?.result?.value;
        }
      }
    }
    if (!reviewsResult) {
      const inlineEvaluation = await client.call("Runtime.evaluate", { expression: reviewExtractor, returnByValue: true });
      if (!inlineEvaluation?.exceptionDetails) reviewsResult = inlineEvaluation?.result?.value;
    }
    const enrichedProduct = {
      ...product,
      reviews: reviewsResult?.reviews || [],
      reviewsTotal: reviewsResult?.total || null,
      reviewsSourceUrl: reviewsResult?.sourceUrl || null,
      reviewsCapturedAt: reviewsResult?.capturedAt || null,
    };
    enrichedProduct.priceHistory = recordPriceHistory(enrichedProduct);
    return enrichedProduct;
  } finally {
    await closeChromeTarget(target, client);
  }
}

function corsHeaders(request) {
  const origin = request.headers.origin || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "null",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Promozap-Local-Token",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}

function respond(response, status, payload, headers) {
  response.writeHead(status, headers);
  response.end(JSON.stringify(payload));
}

function localPanelHtml() {
  const safeToken = JSON.stringify(localToken).replace(/</g, "\\u003c");
  const marketCategories = [
    "Geral", "Acessórios para Veículos", "Agro", "Alimentos e Bebidas", "Animais", "Antiguidades e Coleções",
    "Arte, Papelaria e Armarinho", "Bebês", "Beleza e Cuidado Pessoal", "Brinquedos e Hobbies",
    "Calçados, Roupas e Bolsas", "Casa, Móveis e Decoração", "Celulares e Telefones", "Construção",
    "Câmeras e Acessórios", "Eletrodomésticos", "Eletrônicos, Áudio e Vídeo", "Esportes e Fitness",
    "Ferramentas", "Festas e Lembrancinhas", "Games", "Indústria e Comércio", "Informática", "Ingressos",
    "Instrumentos Musicais", "Joias e Relógios", "Livros, Revistas e Comics", "Música, Filmes e Seriados",
    "Pet Shop", "Saúde", "Serviços",
  ];
  const categoryOptions = marketCategories.map((category) => `<option value="${category}">${category}</option>`).join("");
  const categoryButtons = marketCategories.map((category) => `<button class="category-link${category === "Geral" ? " active" : ""}" data-category="${category}">${category}</button>`).join("");
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Promozap — Coletor Mercado Livre</title><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#050806;color:#edf7ef}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% 0,#12351d 0,transparent 34rem),#050806;min-height:100vh}.wrap{width:min(1380px,calc(100% - 28px));margin:0 auto;padding:28px 0 64px}.hero{display:flex;gap:16px;align-items:center;margin-bottom:24px}.logo{width:56px;height:56px;border-radius:18px;background:#22c55e;display:grid;place-items:center;color:#04140a;font-weight:1000;font-size:20px;box-shadow:0 0 40px #22c55e33}.eyebrow{color:#62ef8b;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}h1{margin:4px 0 0;font-size:clamp(24px,5vw,38px);letter-spacing:-.04em}.panel{border:1px solid #27372c;background:#0a100cdd;border-radius:22px;padding:20px;box-shadow:0 24px 70px #0008}.status{display:inline-flex;align-items:center;gap:8px;background:#12351d;color:#8af3a5;border:1px solid #286d3b;border-radius:999px;padding:7px 12px;font-size:12px;font-weight:800}.dot{width:8px;height:8px;border-radius:99px;background:#31df66;box-shadow:0 0 12px #31df66}label{display:block;margin:18px 0 8px;font-size:13px;font-weight:800;color:#bed0c2}input,select{width:100%;height:54px;border:1px solid #34483a;background:#050806;color:white;border-radius:14px;padding:0 15px;font-size:15px;outline:none}input:focus,select:focus{border-color:#31df66;box-shadow:0 0 0 3px #31df6622}.actions{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap}button,a.button{border:0;border-radius:13px;height:48px;padding:0 18px;font-weight:900;font-size:14px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;text-decoration:none}.primary{background:#24c75a;color:#04140a;flex:1}.secondary{background:#151f18;color:#eaf5ec;border:1px solid #34483a}button:disabled{opacity:.55;cursor:wait}.hint{margin:14px 0 0;color:#85968a;font-size:12px;line-height:1.65}.error{margin-top:16px;border:1px solid #7e4138;background:#24110e;color:#ffb8ad;padding:13px;border-radius:13px}.result{margin-top:20px;display:none}.result.show{display:block}.product{display:grid;gap:26px;grid-template-columns:330px 1fr}.image{aspect-ratio:1;background:white;border-radius:18px;padding:12px;display:grid;place-items:center}.image img{width:100%;height:100%;object-fit:contain}.badges{display:flex;gap:8px;flex-wrap:wrap}.badge{border-radius:999px;background:#153520;color:#8af3a5;padding:6px 10px;font-size:11px;font-weight:800}.badge.yellow{background:#ffe600;color:#211e00}.badge.coupon{background:#3b3008;color:#ffe974}.title{font-size:clamp(22px,3vw,32px);line-height:1.16;margin:12px 0 16px;max-width:34ch}.prices{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.price{background:#101812;border:1px solid #26362b;border-radius:14px;padding:13px}.price small{display:block;color:#7f9184;margin-bottom:5px}.price strong{font-size:22px;color:#69f08f}.details{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:12px}.detail{background:#0d140f;border-radius:12px;padding:12px}.detail small{color:#738177}.detail div{font-weight:750;margin-top:5px;word-break:break-word}.history-block{margin-top:22px;padding-top:20px;border-top:1px solid #27372c}.history-heading{display:flex;justify-content:space-between;align-items:start;gap:16px}.history-heading h3{font-size:22px;margin:0}.history-heading p{color:#85968a;margin:6px 0 0;font-size:13px}.history-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}.history-chart{min-height:250px;border:1px solid #27372c;border-radius:16px;background:#07100a;padding:10px;overflow:hidden}.history-chart svg{width:100%;height:240px;display:block}.chart-grid{stroke:#1f3526;stroke-width:1}.chart-line{fill:none;stroke:#36d96b;stroke-width:4;stroke-linecap:round;stroke-linejoin:round}.chart-area{fill:url(#priceArea)}.chart-reference{stroke:#ffe600;stroke-width:2;stroke-dasharray:7 7}.chart-point{fill:#050806;stroke:#69f08f;stroke-width:4}.chart-label{fill:#91a696;font-size:11px}.attrs{margin-top:18px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.attr{border:1px solid #26362b;background:#0d140f;border-radius:11px;padding:10px}.attr small{color:#738177}.attr div{margin-top:4px;font-weight:700}.reviews-title{margin:24px 0 10px}.reviews{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.review{border:1px solid #26362b;background:#0d140f;border-radius:15px;padding:14px}.review-head{display:flex;justify-content:space-between;gap:12px;font-size:12px;color:#9daf9f}.stars{color:#ffe04a;letter-spacing:1px}.review p{line-height:1.5;margin:10px 0;color:#e9f2eb}.review-images{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.review-images img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:9px;border:1px solid #34483a}.json{margin-top:16px}pre{max-height:360px;overflow:auto;background:#030503;border:1px solid #26362b;border-radius:14px;padding:14px;color:#8fe5a8;font-size:11px;white-space:pre-wrap;word-break:break-word}.catalog-panel{margin-top:22px}.filters{display:grid;grid-template-columns:2fr 1fr 130px 160px;gap:10px;align-items:end}.filters label{margin-top:0}.check{height:54px;display:flex;align-items:center;gap:8px;border:1px solid #34483a;border-radius:14px;padding:0 12px;background:#050806}.check input{width:18px;height:18px}.monitor{display:flex;align-items:center;gap:10px;margin-top:12px;flex-wrap:wrap}.monitor select{width:170px}.catalog-layout{display:grid;grid-template-columns:230px 1fr;gap:16px;margin-top:18px;align-items:start}.category-rail{position:sticky;top:16px;border:1px solid #27372c;background:#0a100c;border-radius:18px;padding:16px}.category-rail h3{margin:0 0 10px}.category-links{display:grid;gap:3px;max-height:72vh;overflow:auto}.category-link{height:auto;text-align:left;justify-content:flex-start;border-radius:9px;padding:9px 10px;background:transparent;color:#bfd0c2;font-weight:650}.category-link:hover,.category-link.active{background:#16351f;color:#79f098}.catalog-meta{color:#85968a;font-size:13px;margin:0 0 10px}.catalog{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.deal-card{border:1px solid #27372c;background:#0a100c;border-radius:16px;overflow:hidden;display:flex;flex-direction:column}.deal-card:hover{border-color:#42a45e}.deal-image{aspect-ratio:1;background:white;padding:10px}.deal-image img{width:100%;height:100%;object-fit:contain}.deal-body{padding:12px;display:flex;flex-direction:column;gap:8px;flex:1}.deal-body h3{font-size:14px;line-height:1.35;margin:0;min-height:57px}.old{text-decoration:line-through;color:#728077;font-size:12px}.current{font-size:21px;font-weight:950;color:#69f08f}.reasons{font-size:11px;color:#a0b0a4}.deal-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:auto}.deal-actions>*{height:40px!important;padding:0 9px!important}.empty{grid-column:1/-1;text-align:center;color:#839087;border:1px dashed #34483a;border-radius:18px;padding:42px}@media(max-width:1100px){.catalog{grid-template-columns:repeat(3,1fr)}}@media(max-width:880px){.filters{grid-template-columns:1fr 1fr}.catalog-layout{grid-template-columns:1fr}.category-rail{position:static;padding:12px}.category-links{display:flex;overflow:auto;max-height:none}.category-link{white-space:nowrap;border:1px solid #27372c}.catalog{grid-template-columns:repeat(2,1fr)}}@media(max-width:760px){.product{grid-template-columns:1fr}.image{max-width:350px}.prices,.history-stats{grid-template-columns:repeat(2,1fr)}.details,.attrs,.filters,.reviews{grid-template-columns:1fr}.actions>*{width:100%}}@media(max-width:430px){.catalog{gap:8px}.deal-body{padding:9px}.deal-body h3{font-size:12px}.current{font-size:17px}.deal-actions{grid-template-columns:1fr}.history-chart{padding:4px}}
</style></head><body><main class="wrap"><div class="hero"><div class="logo">%</div><div><div class="eyebrow">Promozap</div><h1>Inteligência de ofertas Mercado Livre</h1></div></div><section class="panel"><span class="status"><i class="dot"></i> Coletor ligado neste computador</span><label for="input">URL completa ou código MLB</label><input id="input" value="https://www.mercadolivre.com.br/o-boticario-zaad-infinity-eau-de-parfum-95ml/up/MLBU4815336108" placeholder="Cole a URL ou MLB123456789"><div class="actions"><button id="collect" class="primary">Abrir Chrome e extrair dados</button><a class="button secondary" href="https://promozap-operacao-grupos.joseattax.chatgpt.site/?v=45" target="_blank" rel="noreferrer">Voltar ao painel online</a></div><p class="hint">Além de preço e cupom, o coletor abre as opiniões do anúncio e reúne até 10 avaliações com as fotos publicadas por cada comprador.</p><div id="error" class="error" hidden></div></section><section id="result" class="panel result"><div class="product"><div class="image"><img id="image" alt="Imagem oficial do produto"></div><div><div class="badges"><span id="item" class="badge yellow"></span><span id="discount" class="badge"></span><span id="store" class="badge"></span><span id="coupon-badge" class="badge coupon" hidden></span></div><h2 id="title" class="title"></h2><div id="prices" class="prices"></div><div id="details" class="details"></div></div></div><section class="history-block"><div class="history-heading"><div><h3>Histórico de preço</h3><p id="history-note">O coletor começa a guardar as medições a partir da primeira consulta.</p></div><span id="history-verdict" class="badge"></span></div><div id="history-stats" class="history-stats"></div><div id="history-chart" class="history-chart"></div></section><div id="attrs" class="attrs"></div><h3 id="reviews-title" class="reviews-title"></h3><div id="reviews" class="reviews"></div><details class="json"><summary>Resposta completa (JSON)</summary><div class="actions"><button id="copy" class="secondary">Copiar JSON</button></div><pre id="json"></pre></details></section><section class="panel catalog-panel"><span class="status"><i class="dot"></i> Catálogo automático de promoções</span><h2>Buscar ofertas reais por categoria</h2><div class="filters"><div><label for="deals-url">Página de ofertas</label><input id="deals-url" value="https://www.mercadolivre.com.br/ofertas?container_id=MLB779362-1&promotion_type=deal_of_the_day"></div><div><label for="category">Categoria</label><select id="category">${categoryOptions}</select></div><div><label for="limit">Máximo</label><select id="limit"><option>8</option><option selected>20</option><option>40</option><option>80</option></select></div><div><label>Regra</label><label class="check"><input id="coupons-only" type="checkbox"> Só com cupom</label></div></div><div class="filters" style="grid-template-columns:190px 1fr"><div><label for="min-discount">Desconto mínimo</label><select id="min-discount"><option value="0">Qualquer</option><option value="10">10% ou mais</option><option value="20" selected>20% ou mais</option><option value="30">30% ou mais</option><option value="40">40% ou mais</option></select></div><div class="actions"><button id="scan" class="primary">Buscar e ranquear ofertas</button></div></div><div class="monitor"><button id="monitor-toggle" class="secondary">Iniciar monitoramento</button><select id="monitor-interval"><option value="15">a cada 15 min</option><option value="30" selected>a cada 30 min</option><option value="60">a cada 1 hora</option></select><span id="monitor-note" class="hint">Funciona enquanto o coletor estiver aberto.</span></div><p class="hint">Escolha “Geral” para percorrer todas as ofertas do dia. Em cada cartão, “Dados + avaliações” abre preço, cupom, ficha técnica, histórico e opiniões com fotos.</p><div id="catalog-error" class="error" hidden></div></section><div class="catalog-layout"><aside class="category-rail"><h3>Categorias</h3><div class="category-links">${categoryButtons}</div></aside><div class="catalog-main"><div id="catalog-meta" class="catalog-meta">Faça uma busca para preencher o catálogo.</div><section id="catalog" class="catalog"><div class="empty">Nenhuma oferta carregada.</div></section></div></div></main><script>
const token=${safeToken};const input=document.querySelector('#input'),button=document.querySelector('#collect'),error=document.querySelector('#error'),result=document.querySelector('#result');let last=null;
const productDialog=document.createElement('dialog');productDialog.className='product-dialog';const closeProduct=document.createElement('button');closeProduct.className='dialog-close';closeProduct.type='button';closeProduct.setAttribute('aria-label','Fechar janela');closeProduct.textContent='×';result.replaceWith(productDialog);productDialog.append(closeProduct,result);const sendStrip=document.createElement('div');sendStrip.className='send-strip';sendStrip.innerHTML='<div><strong>Gostou desta oferta?</strong><span>Abra o painel com este produto pronto para escolher o grupo.</span></div><button type="button" class="primary">Enviar para meu grupo</button>';result.querySelector('.product').after(sendStrip);closeProduct.onclick=()=>productDialog.close();productDialog.onclick=event=>{if(event.target===productDialog)productDialog.close()};sendStrip.querySelector('button').onclick=()=>{const productUrl=last?.canonicalUrl||last?.url||input.value;navigator.clipboard?.writeText(productUrl);window.open('https://promozap-operacao-grupos.joseattax.chatgpt.site/?product='+encodeURIComponent(productUrl)+'#consultar-produtos','_blank','noopener')};const modalStyle=document.createElement('style');modalStyle.textContent='.product-dialog{width:min(1180px,calc(100vw - 24px));max-height:94vh;padding:0;border:0;border-radius:22px;background:#fff;color:#263746;box-shadow:0 30px 90px rgba(16,34,49,.28);overflow:auto}.product-dialog::backdrop{background:rgba(15,28,39,.65);backdrop-filter:blur(5px)}.product-dialog .result{display:block;margin:0;border:0;border-radius:0;background:#fff}.dialog-close{position:sticky;z-index:8;top:12px;float:right;margin:12px 12px -54px 0;width:42px;height:42px;padding:0;border-radius:999px;background:#edf2f5;color:#263746;font-size:30px;line-height:1}.send-strip{margin-top:18px;display:flex;gap:18px;align-items:center;justify-content:space-between;border:1px solid #d7e3ec;border-radius:16px;background:#eef8ff;padding:16px}.send-strip div{display:grid;gap:4px}.send-strip span{color:#667788;font-size:13px}.product-dialog .price,.product-dialog .detail,.product-dialog .attr,.product-dialog .review,.product-dialog .history-chart{background:#f8fafb;border-color:#dce4ea}.product-dialog .price strong,.product-dialog .current{color:#087bd3}.product-dialog .review p{color:#34495a}.product-dialog pre{background:#17232e;color:#b7f7c7}@media(max-width:620px){.send-strip{align-items:stretch;flex-direction:column}.send-strip button{width:100%}}';document.head.append(modalStyle);
const catalogTheme=document.createElement('style');catalogTheme.textContent='body{background:#f4f6f8;color:#263746}.panel,.category-rail,.deal-card{background:#fff;border-color:#dce4ea;box-shadow:0 7px 25px rgba(31,54,76,.07)}input,select,.check{background:#fff;color:#263746;border-color:#cfd9e0}.secondary{background:#fff;color:#34495a;border-color:#cfd9e0}.category-link{color:#526778}.category-link:hover,.category-link.active{background:#eef8ff;color:#087bd3}.deal-card:hover{border-color:#8fc5ea}.current{color:#087bd3}.hint,.catalog-meta,.reasons{color:#6e7f8d}.badge{background:#e8f8ef;color:#138244}.badge.yellow{background:#087bd3;color:#fff}.badge.coupon{background:#fff1bf;color:#795d00}.logo,.primary{background:#087bd3;color:#fff}.primary:hover{background:#076bb7}';document.head.append(catalogTheme);
const money=(v,c='BRL')=>v==null?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:c}).format(v);const esc=(v)=>String(v??'—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
async function loadProduct(value,sourceButton=button){const previous=sourceButton.textContent;sourceButton.disabled=true;sourceButton.textContent='Lendo dados e avaliações...';error.hidden=true;try{const response=await fetch('/scrape',{method:'POST',headers:{'Content-Type':'application/json','X-Promozap-Local-Token':token},body:JSON.stringify({input:value})});const data=await response.json();if(!response.ok||!data.product?.ok)throw new Error(data.product?.userActionMessage||data.error||'Falha na coleta.');render(data.product);renderHistory(data.product);if(!productDialog.open)productDialog.showModal();productDialog.scrollTop=0}catch(e){error.textContent=e.message;error.hidden=false;error.scrollIntoView({behavior:'smooth',block:'center'})}finally{sourceButton.disabled=false;sourceButton.textContent=previous}}
button.onclick=()=>loadProduct(input.value,button);
function renderHistory(p){const rows=(p.priceHistory||[]).filter(row=>Number.isFinite(row.price));const current=p.coupon?.price||p.pixPrice||p.standardPrice||p.price;const observed=rows.map(row=>row.price);const reference=p.originalPrice;const lowest=observed.length?Math.min(...observed):current;const highest=observed.length?Math.max(...observed):current;document.querySelector('#history-stats').innerHTML=[['Valor atual',current],['Menor observado',lowest],['Maior observado',highest],['Preço de referência',reference]].map(([label,value])=>'<div class="price"><small>'+label+'</small><strong>'+money(value,p.currency||'BRL')+'</strong></div>').join('');const verdict=document.querySelector('#history-verdict');const saving=reference&&current&&reference>current?Math.round((1-current/reference)*100):0;verdict.textContent=saving?'Preço atual '+saving+'% abaixo da referência':rows.length>1&&current===lowest?'Menor preço observado':'Acompanhando preço';document.querySelector('#history-note').textContent=rows.length>1?'Histórico real salvo neste computador: '+rows.length+' medições.':'Primeira medição salva. As próximas consultas formarão o histórico real.';const values=[...observed,...(Number.isFinite(reference)?[reference]:[])].filter(Number.isFinite);if(!values.length){document.querySelector('#history-chart').innerHTML='<div class="empty">Preço ainda não disponível para formar o gráfico.</div>';return}const width=900,height=240,padX=58,padY=28;let min=Math.min(...values),max=Math.max(...values);if(min===max){min*=.95;max*=1.05}const gap=(max-min)*.14;min=Math.max(0,min-gap);max+=gap;const x=index=>rows.length<=1?width/2:padX+index*(width-padX*2)/(rows.length-1);const y=value=>height-padY-(value-min)*(height-padY*2)/(max-min);const points=rows.map((row,index)=>[x(index),y(row.price)]);const line=points.map((point,index)=>(index?'L':'M')+point[0].toFixed(1)+' '+point[1].toFixed(1)).join(' ');const area=points.length>1?line+' L '+points.at(-1)[0].toFixed(1)+' '+(height-padY)+' L '+points[0][0].toFixed(1)+' '+(height-padY)+' Z':'';const grid=[0,.25,.5,.75,1].map(step=>{const value=max-(max-min)*step;const gy=padY+(height-padY*2)*step;return '<line class="chart-grid" x1="'+padX+'" y1="'+gy+'" x2="'+(width-padX)+'" y2="'+gy+'"/><text class="chart-label" x="4" y="'+(gy+4)+'">'+money(value,p.currency||'BRL')+'</text>'}).join('');const referenceLine=Number.isFinite(reference)?'<line class="chart-reference" x1="'+padX+'" y1="'+y(reference)+'" x2="'+(width-padX)+'" y2="'+y(reference)+'"/><text class="chart-label" x="'+(width-155)+'" y="'+(y(reference)-7)+'">referência '+money(reference,p.currency||'BRL')+'</text>':'';const dots=points.map((point,index)=>'<circle class="chart-point" cx="'+point[0]+'" cy="'+point[1]+'" r="5"><title>'+new Date(rows[index].capturedAt).toLocaleString('pt-BR')+' — '+money(rows[index].price,p.currency||'BRL')+'</title></circle>').join('');document.querySelector('#history-chart').innerHTML='<svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Gráfico do histórico de preço"><defs><linearGradient id="priceArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#36d96b" stop-opacity=".32"/><stop offset="1" stop-color="#36d96b" stop-opacity="0"/></linearGradient></defs>'+grid+referenceLine+(area?'<path class="chart-area" d="'+area+'"/>':'')+(line?'<path class="chart-line" d="'+line+'"/>':'')+dots+'</svg>'}
function render(p){last=p;const currency=p.currency||'BRL';document.querySelector('#image').src=p.imageUrl||'';document.querySelector('#item').textContent=[p.itemId,p.userProductId].filter(Boolean).join(' · ');document.querySelector('#discount').textContent=p.discountPercentage?p.discountPercentage+'% OFF':'Sem desconto informado';document.querySelector('#store').textContent=p.officialStore?'Loja oficial: '+p.officialStore:(p.seller||'Vendedor não informado');const couponBadge=document.querySelector('#coupon-badge');couponBadge.hidden=!p.coupon;couponBadge.textContent=p.coupon?(p.coupon.code?'Cupom '+p.coupon.code:p.coupon.text):'';document.querySelector('#title').textContent=p.title;const prices=[['No Pix',p.pixPrice],['Normal',p.standardPrice],['Anterior',p.originalPrice],['Com cupom',p.coupon?.price]];document.querySelector('#prices').innerHTML=prices.map(([l,v])=>'<div class="price"><small>'+l+'</small><strong>'+money(v,currency)+'</strong></div>').join('');const details=[['Benefício do cupom',p.coupon?.amountOff?money(p.coupon.amountOff):p.coupon?.text],['Compra mínima',p.coupon?.minimumPurchase?money(p.coupon.minimumPurchase):null],['Código',p.coupon?.code||(p.coupon?.automatic?'Automático/sem código visível':null)],['Parcelamento',p.installments?.text],['Estoque',p.stockText],['Vendidos',p.soldText],['Entrega',p.deliveryText],['Avaliação',p.ratingText],['Total de opiniões',p.reviewsTotal],['Capturado em',new Date(p.capturedAt).toLocaleString('pt-BR')]];document.querySelector('#details').innerHTML=details.map(([l,v])=>'<div class="detail"><small>'+esc(l)+'</small><div>'+esc(v)+'</div></div>').join('');document.querySelector('#attrs').innerHTML=(p.attributes||[]).map(a=>'<div class="attr"><small>'+esc(a.name)+'</small><div>'+esc(a.value_name)+'</div></div>').join('');const reviews=p.reviews||[];document.querySelector('#reviews-title').textContent=reviews.length?'10 primeiras avaliações encontradas ('+reviews.length+' exibidas)':'Avaliações';document.querySelector('#reviews').innerHTML=reviews.map(r=>'<article class="review"><div class="review-head"><span class="stars">'+('★'.repeat(Math.round(r.rating||0)))+('☆'.repeat(Math.max(0,5-Math.round(r.rating||0))))+'</span><span>'+esc([...new Set([r.country,r.date].filter(Boolean))].join(' · '))+'</span></div><p>'+esc(r.text||'Avaliação publicada somente com foto.')+'</p>'+(r.images?.length?'<div class="review-images">'+r.images.map(url=>'<a href="'+esc(url)+'" target="_blank" rel="noreferrer"><img loading="lazy" src="'+esc(url)+'" alt="Foto enviada nesta avaliação"></a>').join('')+'</div>':'')+(r.usefulCount?'<div class="hint">'+r.usefulCount+' pessoas acharam útil</div>':'')+'</article>').join('')||'<div class="empty">Este anúncio não exibiu avaliações públicas para o coletor.</div>';document.querySelector('#json').textContent=JSON.stringify(p,null,2);result.classList.add('show');result.scrollIntoView({behavior:'smooth',block:'start'})}
document.querySelector('#copy').onclick=()=>last&&navigator.clipboard.writeText(JSON.stringify(last,null,2));
const scanButton=document.querySelector('#scan'),catalogError=document.querySelector('#catalog-error'),catalog=document.querySelector('#catalog');let monitorTimer=null;
async function runCatalog(silent=false){scanButton.disabled=true;scanButton.textContent='Lendo ofertas...';catalogError.hidden=true;if(!silent)catalog.innerHTML='<div class="empty">O Chrome está percorrendo as ofertas. Aguarde…</div>';try{const payload={url:document.querySelector('#deals-url').value,category:document.querySelector('#category').value,limit:Number(document.querySelector('#limit').value),minDiscount:Number(document.querySelector('#min-discount').value),couponsOnly:document.querySelector('#coupons-only').checked};const response=await fetch('/scan-deals',{method:'POST',headers:{'Content-Type':'application/json','X-Promozap-Local-Token':token},body:JSON.stringify(payload)});const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'Falha ao pesquisar ofertas.');renderCatalog(data)}catch(e){catalogError.textContent=e.message;catalogError.hidden=false;if(!silent)catalog.innerHTML='<div class="empty">Não foi possível concluir a busca.</div>'}finally{scanButton.disabled=false;scanButton.textContent='Buscar e ranquear ofertas'}}
function renderCatalog(data){document.querySelector('#catalog-meta').textContent=(data.products?.length||0)+' ofertas em '+data.category+' · atualizado '+new Date(data.capturedAt).toLocaleString('pt-BR')+(data.totalText?' · '+data.totalText:'');catalog.innerHTML=(data.products||[]).map((p,i)=>'<article class="deal-card"><div class="deal-image"><img loading="lazy" src="'+esc(p.imageUrl||'')+'" alt=""></div><div class="deal-body"><div class="badges"><span class="badge yellow">#'+(i+1)+' · '+p.dealScore+' pts</span>'+(p.coupon?'<span class="badge coupon">CUPOM</span>':'')+'</div><h3>'+esc(p.title)+'</h3><div><span class="old">'+money(p.originalPrice)+'</span><div class="current">'+money(p.effectivePrice)+'</div></div><div class="reasons">'+esc((p.scoreReasons||[]).join(' · '))+'</div>'+(p.coupon?'<div class="reasons">🏷️ '+esc(p.coupon.text)+(p.coupon.amountOff?' — economiza '+money(p.coupon.amountOff):'')+'</div>':'')+'<div class="deal-actions"><button class="primary detail-product" data-url="'+esc(p.url)+'">Dados + avaliações</button><a class="button secondary" href="'+esc(p.url)+'" target="_blank" rel="noreferrer">Abrir página</a></div></div></article>').join('')||'<div class="empty">Nenhum produto passou pelos filtros.</div>';catalog.querySelectorAll('.detail-product').forEach(btn=>btn.onclick=()=>loadProduct(btn.dataset.url,btn))}
document.querySelectorAll('.category-link').forEach(categoryButton=>categoryButton.onclick=()=>{document.querySelector('#category').value=categoryButton.dataset.category;document.querySelectorAll('.category-link').forEach(item=>item.classList.toggle('active',item===categoryButton));runCatalog(false)});document.querySelector('#category').onchange=event=>{document.querySelectorAll('.category-link').forEach(item=>item.classList.toggle('active',item.dataset.category===event.target.value))};scanButton.onclick=()=>runCatalog(false);const monitorButton=document.querySelector('#monitor-toggle');monitorButton.onclick=()=>{if(monitorTimer){clearInterval(monitorTimer);monitorTimer=null;monitorButton.textContent='Iniciar monitoramento';document.querySelector('#monitor-note').textContent='Monitoramento parado.';return}const minutes=Number(document.querySelector('#monitor-interval').value);runCatalog(false);monitorTimer=setInterval(()=>runCatalog(true),minutes*60000);monitorButton.textContent='Parar monitoramento';document.querySelector('#monitor-note').textContent='Monitorando a cada '+minutes+' min enquanto esta janela estiver aberta.'};
</script></body></html>`;
}

const server = createServer(async (request, response) => {
  const headers = corsHeaders(request);
  if (request.method === "OPTIONS") {
    response.writeHead(204, headers);
    response.end();
    return;
  }
  const origin = request.headers.origin || "";
  if (origin && !allowedOrigins.has(origin)) return respond(response, 403, { error: "Origem não autorizada." }, headers);
  if ((request.url === "/" || request.url === "/index.html") && request.method === "GET") {
    response.writeHead(200, { ...headers, "Content-Type": "text/html; charset=utf-8" });
    response.end(localPanelHtml());
    return;
  }
  if (request.url === "/health" && request.method === "GET") return respond(response, 200, { ok: true, service: "Promozap Coletor Local", version: 2 }, headers);
  const isScrape = request.url === "/scrape" && request.method === "POST";
  const isDealsScan = request.url === "/scan-deals" && request.method === "POST";
  if (!isScrape && !isDealsScan) return respond(response, 404, { error: "Rota não encontrada." }, headers);
  if (request.headers["x-promozap-local-token"] !== localToken) return respond(response, 401, { error: "Token local inválido." }, headers);

  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 100_000) return respond(response, 413, { error: "Requisição muito grande." }, headers);
  }
  try {
    const body = JSON.parse(raw || "{}");
    const task = scrapeQueue.then(() => isDealsScan ? scanDeals(body) : scrapeProduct(body.input));
    scrapeQueue = task.catch(() => undefined);
    const result = await task;
    if (isDealsScan) respond(response, result.ok ? 200 : 409, result, headers);
    else respond(response, result.ok ? 200 : 409, { ok: result.ok, product: result }, headers);
  } catch (error) {
    respond(response, 400, { ok: false, error: error instanceof Error ? error.message : "Falha na coleta." }, headers);
  }
});

server.listen(collectorPort, "127.0.0.1", () => {
  console.log("\nPromozap Coletor Local está pronto.");
  console.log(`Endereço: http://127.0.0.1:${collectorPort}`);
  console.log(`Token local: ${localToken}`);
  console.log("Cole esse token na seção Coletor pelo navegador do painel.\n");
  if (process.platform === "win32" && process.env.PROMOZAP_NO_AUTO_OPEN !== "1") {
    const opener = spawn("cmd.exe", ["/d", "/c", "start", "", `http://127.0.0.1:${collectorPort}`], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    opener.unref();
  }
});

