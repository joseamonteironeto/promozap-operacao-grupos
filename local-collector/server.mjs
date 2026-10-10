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
  `http://127.0.0.1:${collectorPort}`,
  `http://localhost:${collectorPort}`,
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

function localPanelHtml() {
  const safeToken = JSON.stringify(localToken).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Promozap — Coletor Mercado Livre</title><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#050806;color:#edf7ef}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% 0,#12351d 0,transparent 34rem),#050806;min-height:100vh}.wrap{width:min(1120px,calc(100% - 28px));margin:0 auto;padding:28px 0 64px}.hero{display:flex;gap:16px;align-items:center;margin-bottom:24px}.logo{width:56px;height:56px;border-radius:18px;background:#22c55e;display:grid;place-items:center;color:#04140a;font-weight:1000;font-size:20px;box-shadow:0 0 40px #22c55e33}.eyebrow{color:#62ef8b;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}h1{margin:4px 0 0;font-size:clamp(24px,5vw,38px);letter-spacing:-.04em}.panel{border:1px solid #27372c;background:#0a100cdd;border-radius:22px;padding:20px;box-shadow:0 24px 70px #0008}.status{display:inline-flex;align-items:center;gap:8px;background:#12351d;color:#8af3a5;border:1px solid #286d3b;border-radius:999px;padding:7px 12px;font-size:12px;font-weight:800}.dot{width:8px;height:8px;border-radius:99px;background:#31df66;box-shadow:0 0 12px #31df66}label{display:block;margin:18px 0 8px;font-size:13px;font-weight:800;color:#bed0c2}input{width:100%;height:54px;border:1px solid #34483a;background:#050806;color:white;border-radius:14px;padding:0 15px;font-size:15px;outline:none}input:focus{border-color:#31df66;box-shadow:0 0 0 3px #31df6622}.actions{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap}button,a.button{border:0;border-radius:13px;height:48px;padding:0 18px;font-weight:900;font-size:14px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;text-decoration:none}.primary{background:#24c75a;color:#04140a;flex:1}.secondary{background:#151f18;color:#eaf5ec;border:1px solid #34483a}button:disabled{opacity:.55;cursor:wait}.hint{margin:14px 0 0;color:#85968a;font-size:12px;line-height:1.65}.error{margin-top:16px;border:1px solid #7e4138;background:#24110e;color:#ffb8ad;padding:13px;border-radius:13px}.result{margin-top:20px;display:none}.result.show{display:block}.product{display:grid;gap:20px;grid-template-columns:250px 1fr}.image{aspect-ratio:1;background:white;border-radius:18px;padding:12px;display:grid;place-items:center}.image img{width:100%;height:100%;object-fit:contain}.badges{display:flex;gap:8px;flex-wrap:wrap}.badge{border-radius:999px;background:#153520;color:#8af3a5;padding:6px 10px;font-size:11px;font-weight:800}.badge.yellow{background:#ffe600;color:#211e00}.title{font-size:24px;line-height:1.2;margin:12px 0 16px}.prices{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.price{background:#101812;border:1px solid #26362b;border-radius:14px;padding:13px}.price small{display:block;color:#7f9184;margin-bottom:5px}.price strong{font-size:19px;color:#69f08f}.details{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:12px}.detail{background:#0d140f;border-radius:12px;padding:12px}.detail small{color:#738177}.detail div{font-weight:750;margin-top:5px;word-break:break-word}.attrs{margin-top:18px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.attr{border:1px solid #26362b;background:#0d140f;border-radius:11px;padding:10px}.attr small{color:#738177}.attr div{margin-top:4px;font-weight:700}.json{margin-top:16px}pre{max-height:360px;overflow:auto;background:#030503;border:1px solid #26362b;border-radius:14px;padding:14px;color:#8fe5a8;font-size:11px;white-space:pre-wrap;word-break:break-word}@media(max-width:760px){.product{grid-template-columns:1fr}.image{max-width:310px}.prices{grid-template-columns:repeat(2,1fr)}.details,.attrs{grid-template-columns:1fr}.actions>*{width:100%}}
</style></head><body><main class="wrap"><div class="hero"><div class="logo">%</div><div><div class="eyebrow">Promozap</div><h1>Coletor Mercado Livre</h1></div></div><section class="panel"><span class="status"><i class="dot"></i> Coletor ligado neste computador</span><label for="input">URL completa ou código MLB</label><input id="input" value="https://www.mercadolivre.com.br/o-boticario-zaad-infinity-eau-de-parfum-95ml/up/MLBU4815336108" placeholder="Cole a URL ou MLB123456789"><div class="actions"><button id="collect" class="primary">Abrir Chrome e extrair dados</button><a class="button secondary" href="https://promozap-operacao-grupos.joseattax.chatgpt.site/?v=41" target="_blank" rel="noreferrer">Voltar ao painel online</a></div><p class="hint">O fragmento depois de # é removido. Para MLBU, cole a URL completa. Se aparecer login ou CAPTCHA, resolva na janela do Chrome e tente novamente.</p><div id="error" class="error" hidden></div></section><section id="result" class="panel result"><div class="product"><div class="image"><img id="image" alt="Imagem oficial do produto"></div><div><div class="badges"><span id="item" class="badge yellow"></span><span id="discount" class="badge"></span><span id="store" class="badge"></span></div><h2 id="title" class="title"></h2><div id="prices" class="prices"></div><div id="details" class="details"></div></div></div><div id="attrs" class="attrs"></div><details class="json"><summary>Resposta completa (JSON)</summary><div class="actions"><button id="copy" class="secondary">Copiar JSON</button></div><pre id="json"></pre></details></section></main><script>
const token=${safeToken};const input=document.querySelector('#input'),button=document.querySelector('#collect'),error=document.querySelector('#error'),result=document.querySelector('#result');let last=null;
const money=(v,c='BRL')=>v==null?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:c}).format(v);const esc=(v)=>String(v??'—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
button.onclick=async()=>{button.disabled=true;button.textContent='Lendo a página...';error.hidden=true;result.classList.remove('show');try{const response=await fetch('/scrape',{method:'POST',headers:{'Content-Type':'application/json','X-Promozap-Local-Token':token},body:JSON.stringify({input:input.value})});const data=await response.json();if(!response.ok||!data.product?.ok)throw new Error(data.product?.userActionMessage||data.error||'Falha na coleta.');render(data.product)}catch(e){error.textContent=e.message;error.hidden=false}finally{button.disabled=false;button.textContent='Abrir Chrome e extrair dados'}};
function render(p){last=p;const currency=p.currency||'BRL';document.querySelector('#image').src=p.imageUrl||'';document.querySelector('#item').textContent=[p.itemId,p.userProductId].filter(Boolean).join(' · ');document.querySelector('#discount').textContent=p.discountPercentage?p.discountPercentage+'% OFF':'Sem desconto informado';document.querySelector('#store').textContent=p.officialStore?'Loja oficial: '+p.officialStore:(p.seller||'Vendedor não informado');document.querySelector('#title').textContent=p.title;const prices=[['No Pix',p.pixPrice],['Normal',p.standardPrice],['Anterior',p.originalPrice],['Com cupom',p.coupon?.price]];document.querySelector('#prices').innerHTML=prices.map(([l,v])=>'<div class="price"><small>'+l+'</small><strong>'+money(v,currency)+'</strong></div>').join('');const details=[['Parcelamento',p.installments?.text],['Estoque',p.stockText],['Vendidos',p.soldText],['Entrega',p.deliveryText],['Avaliação',p.ratingText],['Capturado em',new Date(p.capturedAt).toLocaleString('pt-BR')]];document.querySelector('#details').innerHTML=details.map(([l,v])=>'<div class="detail"><small>'+esc(l)+'</small><div>'+esc(v)+'</div></div>').join('');document.querySelector('#attrs').innerHTML=(p.attributes||[]).map(a=>'<div class="attr"><small>'+esc(a.name)+'</small><div>'+esc(a.value_name)+'</div></div>').join('');document.querySelector('#json').textContent=JSON.stringify(p,null,2);result.classList.add('show');result.scrollIntoView({behavior:'smooth',block:'start'})}
document.querySelector('#copy').onclick=()=>last&&navigator.clipboard.writeText(JSON.stringify(last,null,2));
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

