const endpoint = "https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink";

type BrowserCookie = {
  name?: unknown;
  value?: unknown;
  domain?: unknown;
  expirationDate?: unknown;
  path?: unknown;
  secure?: unknown;
  httpOnly?: unknown;
  sameSite?: unknown;
  [key: string]: unknown;
};

export type GeneratedLink = {
  origin_url?: string;
  short_url?: string;
  long_url?: string;
  created?: boolean;
};

export function parseMercadoLivreCookies(value: unknown) {
  if (typeof value !== "string" || value.length > 100_000) return null;
  let parsed: BrowserCookie[];
  try {
    parsed = JSON.parse(value) as BrowserCookie[];
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 200) return null;

  const now = Date.now() / 1000;
  const valid = parsed.filter((item) => {
    if (typeof item.name !== "string" || typeof item.value !== "string") return false;
    if (/[;\r\n]/.test(item.name) || /[\r\n]/.test(item.value)) return false;
    const domain = typeof item.domain === "string" ? item.domain.replace(/^\./, "") : "";
    if (domain !== "mercadolivre.com.br" && domain !== "www.mercadolivre.com.br") return false;
    if (typeof item.expirationDate === "number" && item.expirationDate < now) return false;
    return true;
  });
  if (!valid.length) return null;
  const header = valid.map((item) => `${item.name}=${item.value}`).join("; ");
  return header.length <= 32_000 ? { header, count: valid.length } : null;
}

function responseCookies(headers: Headers) {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  const values = extended.getSetCookie?.() || [];
  if (values.length) return values;
  const combined = headers.get("set-cookie");
  return combined ? combined.split(/,(?=\s*[^;,=\s]+=[^;,]*)/) : [];
}

function parseCookieExpiry(attributes: string[]) {
  const maxAge = attributes.find((attribute) => /^max-age=/i.test(attribute));
  if (maxAge) {
    const seconds = Number(maxAge.slice(maxAge.indexOf("=") + 1));
    if (Number.isFinite(seconds)) return Math.floor(Date.now() / 1000) + seconds;
  }
  const expires = attributes.find((attribute) => /^expires=/i.test(attribute));
  if (!expires) return null;
  const timestamp = Date.parse(expires.slice(expires.indexOf("=") + 1));
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
}

export function mergeMercadoLivreCookies(value: unknown, setCookieHeaders: string[]) {
  if (typeof value !== "string" || !setCookieHeaders.length) return null;
  let cookies: BrowserCookie[];
  try {
    cookies = JSON.parse(value) as BrowserCookie[];
  } catch {
    return null;
  }
  if (!Array.isArray(cookies)) return null;

  let changed = false;
  for (const header of setCookieHeaders) {
    const parts = header.split(";").map((part) => part.trim()).filter(Boolean);
    const separator = parts[0]?.indexOf("=") ?? -1;
    if (separator <= 0) continue;
    const name = parts[0].slice(0, separator);
    const cookieValue = parts[0].slice(separator + 1);
    if (!name || /[;\r\n]/.test(name) || /[\r\n]/.test(cookieValue)) continue;
    const domainAttribute = parts.find((part) => /^domain=/i.test(part));
    const rawDomain = domainAttribute?.slice(domainAttribute.indexOf("=") + 1) || ".mercadolivre.com.br";
    const normalizedDomain = rawDomain.replace(/^\./, "").toLowerCase();
    if (normalizedDomain !== "mercadolivre.com.br" && normalizedDomain !== "www.mercadolivre.com.br") continue;
    const pathAttribute = parts.find((part) => /^path=/i.test(part));
    const path = pathAttribute?.slice(pathAttribute.indexOf("=") + 1) || "/";
    const expiry = parseCookieExpiry(parts.slice(1));
    const existingIndex = cookies.findIndex((cookie) => cookie.name === name
      && String(cookie.domain || "").replace(/^\./, "").toLowerCase() === normalizedDomain
      && String(cookie.path || "/") === path);
    if (!cookieValue || (expiry !== null && expiry <= Date.now() / 1000)) {
      if (existingIndex >= 0) {
        cookies.splice(existingIndex, 1);
        changed = true;
      }
      continue;
    }
    const next: BrowserCookie = {
      ...(existingIndex >= 0 ? cookies[existingIndex] : {}),
      name,
      value: cookieValue,
      domain: rawDomain,
      path,
      secure: parts.some((part) => /^secure$/i.test(part)),
      httpOnly: parts.some((part) => /^httponly$/i.test(part)),
    };
    if (expiry !== null) next.expirationDate = expiry;
    const sameSite = parts.find((part) => /^samesite=/i.test(part));
    if (sameSite) next.sameSite = sameSite.slice(sameSite.indexOf("=") + 1).toLowerCase();
    if (existingIndex >= 0) cookies[existingIndex] = next;
    else cookies.push(next);
    changed = true;
  }

  if (!changed) return null;
  const refreshed = JSON.stringify(cookies);
  return parseMercadoLivreCookies(refreshed) ? refreshed : null;
}

function decodeResponse(value: string) {
  try {
    return JSON.parse(value) as { status?: number; urls?: GeneratedLink[]; message?: string };
  } catch {
    try {
      return JSON.parse(atob(value)) as { status?: number; urls?: GeneratedLink[]; message?: string };
    } catch {
      return null;
    }
  }
}

export async function generateMercadoLivreLinks(urls: string[], tag: string, cookies: unknown) {
  const session = parseMercadoLivreCookies(cookies);
  if (!session) return { ok: false as const, connected: false, message: "A sessão do Mercado Livre não foi informada, é inválida ou expirou." };

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: session.header,
        Origin: "https://www.mercadolivre.com.br",
        Referer: "https://www.mercadolivre.com.br/afiliados/linkbuilder",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
        "X-CSRF-Token": crypto.randomUUID(),
      },
      body: JSON.stringify({ urls, tag }),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    const decoded = decodeResponse(await upstream.text());
    const refreshedCookies = mergeMercadoLivreCookies(cookies, responseCookies(upstream.headers));
    if (upstream.ok && decoded?.status === 200 && Array.isArray(decoded.urls)) {
      return { ok: true as const, connected: true, cookieCount: session.count, upstreamStatus: upstream.status, results: decoded.urls, refreshedCookies };
    }
    const expired = upstream.status === 401 || upstream.status === 403 || upstream.status === 302;
    return {
      ok: false as const,
      connected: false,
      upstreamStatus: upstream.status,
      refreshedCookies,
      message: expired ? "A sessão foi recusada ou expirou. Exporte cookies novos." : decoded?.message || "O Mercado Livre não gerou o link.",
    };
  } catch {
    return { ok: false as const, connected: false, message: "Não foi possível acessar o Mercado Livre agora." };
  }
}
