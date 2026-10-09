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
const collectorPort = Number(process.env.PROMOZAP_COLLECTOR_PORT || 8765);
const debugPort = Number(process.env.PROMOZAP_CHROME_DEBUG_PORT || 9223);
const allowedOrigins = new Set([
  "https://promozap-operacao-grupos.joseattax.chatgpt.site",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
]);

mkdirSync(stateDir, { recursive: true });
mkdirSync(profileDir, { recursive: true });
const localToken = process.env.PROMOZAP_LOCAL_TOKEN || (existsSync(tokenFile)
  ? readFileSync(tokenFile, "utf8").trim()
  : randomBytes(24).toString("hex"));
if (!existsSync(tokenFile)) writeFileSync(tokenFile, `${localToken}\n`, { mode: 0o600 });

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
  const pageText = document.body?.innerText || '';
  const priceContainer = document.querySelector('.ui-pdp-container__row--price, .ui-pdp-price');
  const priceText = priceContainer?.textContent || '';
  const originalPrice = money(text('.ui-pdp-price__original-value'));
  const pixPrice = money(text('.ui-pdp-price__price-breakdown-inline .andes-money-amount')) || money(productJson?.offers?.price);
  const subtitlePrices = allText('[class*="pricing_price_subtitle"] .andes-money-amount').map(money).filter((value) => value != null);
  const standardPrice = subtitlePrices[0] || money(priceText.match(/ou\s*(R\$\s*[\d.,]+)/i)?.[1]) || null;
  const installmentAmount = subtitlePrices[1] || money(priceText.match(/\d+x\s*(R\$\s*[\d.,]+)/i)?.[1]) || null;
  const couponText = allText('button, a').find((value) => /R\$\s*[\d.,]+\s+com\s+cupom/i.test(value)) || null;
  const couponAmounts = moneyAll(couponText);
  const couponPrice = couponAmounts.at(-1) || money(couponText);
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
    coupon: couponText ? { text: couponText, price: couponPrice } : null,
    installments: installmentText ? { text: installmentText, quantity: installmentCount, amount: installmentAmount, noInterest: /sem juros/i.test(installmentText) } : null,
    availability: productJson?.offers?.availability || null,
    priceValidUntil: productJson?.offers?.priceValidUntil || null,
    condition,
    soldText,
    availableQuantity,
    stockText,
    seller: sellerName,
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
    structuredData: productJson,
  };
})()`;

let scrapeQueue = Promise.resolve();

async function scrapeProduct(input) {
  const targetUrl = normalizeInput(input);
  await ensureChrome();
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
  if (!response.ok) throw new Error("Não foi possível abrir uma aba controlada no Chrome.");
  const target = await response.json();
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
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
    return result.result.value;
  } finally {
    client.close();
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

const server = createServer(async (request, response) => {
  const headers = corsHeaders(request);
  if (request.method === "OPTIONS") {
    response.writeHead(204, headers);
    response.end();
    return;
  }
  const origin = request.headers.origin || "";
  if (origin && !allowedOrigins.has(origin)) return respond(response, 403, { error: "Origem não autorizada." }, headers);
  if (request.url === "/health" && request.method === "GET") return respond(response, 200, { ok: true, service: "Promozap Coletor Local", version: 1 }, headers);
  if (request.url !== "/scrape" || request.method !== "POST") return respond(response, 404, { error: "Rota não encontrada." }, headers);
  if (request.headers["x-promozap-local-token"] !== localToken) return respond(response, 401, { error: "Token local inválido." }, headers);

  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 100_000) return respond(response, 413, { error: "Requisição muito grande." }, headers);
  }
  try {
    const body = JSON.parse(raw || "{}");
    const task = scrapeQueue.then(() => scrapeProduct(body.input));
    scrapeQueue = task.catch(() => undefined);
    const product = await task;
    respond(response, product.ok ? 200 : 409, { ok: product.ok, product }, headers);
  } catch (error) {
    respond(response, 400, { ok: false, error: error instanceof Error ? error.message : "Falha ao coletar o produto." }, headers);
  }
});

server.listen(collectorPort, "127.0.0.1", () => {
  console.log("\nPromozap Coletor Local está pronto.");
  console.log(`Endereço: http://127.0.0.1:${collectorPort}`);
  console.log(`Token local: ${localToken}`);
  console.log("Cole esse token na seção Coletor pelo navegador do painel.\n");
});

