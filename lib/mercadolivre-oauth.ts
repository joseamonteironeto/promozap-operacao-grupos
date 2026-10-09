import { deleteIntegrationSecret, readIntegrationSecret, saveIntegrationSecret } from "@/lib/integration-secret";

const TOKEN_ENDPOINT = "https://api.mercadolibre.com/oauth/token";
const EXPIRY_MARGIN_MS = 2 * 60 * 1000;
let refreshInFlight: Promise<string | null> | null = null;

type TokenPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user_id?: number | string;
  token_type?: string;
  scope?: string;
  message?: string;
  error?: string;
};

export function mercadoLivreRedirectUri(origin: string) {
  return `${origin.replace(/\/$/, "")}/api/oauth/mercadolivre/callback`;
}

export async function mercadoLivreOAuthStatus() {
  const [clientId, clientSecret, accessToken, refreshToken, expiresAt, userId] = await Promise.all([
    readIntegrationSecret("mercadolivre_client_id"),
    readIntegrationSecret("mercadolivre_client_secret"),
    readIntegrationSecret("mercadolivre_access_token"),
    readIntegrationSecret("mercadolivre_refresh_token"),
    readIntegrationSecret("mercadolivre_token_expires_at"),
    readIntegrationSecret("mercadolivre_user_id"),
  ]);
  return {
    appConfigured: Boolean(clientId && clientSecret),
    connected: Boolean(accessToken || refreshToken),
    expiresAt: expiresAt || null,
    userId: userId || null,
  };
}

async function saveTokenPayload(payload: TokenPayload) {
  if (!payload.access_token) throw new Error(payload.message || payload.error || "O Mercado Livre não retornou um Access Token.");
  const expiresAt = new Date(Date.now() + Math.max(60, Number(payload.expires_in) || 21_600) * 1000).toISOString();
  await Promise.all([
    saveIntegrationSecret("mercadolivre_access_token", payload.access_token),
    saveIntegrationSecret("mercadolivre_token_expires_at", expiresAt),
    payload.refresh_token ? saveIntegrationSecret("mercadolivre_refresh_token", payload.refresh_token) : Promise.resolve(),
    payload.user_id != null ? saveIntegrationSecret("mercadolivre_user_id", String(payload.user_id)) : Promise.resolve(),
  ]);
  return payload.access_token;
}

async function requestToken(params: Record<string, string>) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as TokenPayload;
  if (!response.ok) throw new Error(payload.message || payload.error || `Falha OAuth do Mercado Livre (HTTP ${response.status}).`);
  return saveTokenPayload(payload);
}

export async function exchangeMercadoLivreCode(code: string, redirectUri: string) {
  const [clientId, clientSecret] = await Promise.all([
    readIntegrationSecret("mercadolivre_client_id"),
    readIntegrationSecret("mercadolivre_client_secret"),
  ]);
  if (!clientId || !clientSecret) throw new Error("Salve o Client ID e o Client Secret antes de conectar.");
  return requestToken({ grant_type: "authorization_code", client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri });
}

export async function getMercadoLivreAccessToken() {
  const [accessToken, refreshToken, expiresAt, clientId, clientSecret] = await Promise.all([
    readIntegrationSecret("mercadolivre_access_token"),
    readIntegrationSecret("mercadolivre_refresh_token"),
    readIntegrationSecret("mercadolivre_token_expires_at"),
    readIntegrationSecret("mercadolivre_client_id"),
    readIntegrationSecret("mercadolivre_client_secret"),
  ]);
  const validUntil = expiresAt ? Date.parse(expiresAt) : 0;
  if (accessToken && (!validUntil || validUntil > Date.now() + EXPIRY_MARGIN_MS)) return accessToken;
  if (!refreshToken || !clientId || !clientSecret) return accessToken || null;
  return refreshMercadoLivreAccessToken();
}

export async function refreshMercadoLivreAccessToken() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const [refreshToken, clientId, clientSecret] = await Promise.all([
      readIntegrationSecret("mercadolivre_refresh_token"),
      readIntegrationSecret("mercadolivre_client_id"),
      readIntegrationSecret("mercadolivre_client_secret"),
    ]);
    if (!refreshToken || !clientId || !clientSecret) return null;
    try {
      return await requestToken({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken });
    } catch {
      await Promise.all([
        deleteIntegrationSecret("mercadolivre_access_token"),
        deleteIntegrationSecret("mercadolivre_refresh_token"),
        deleteIntegrationSecret("mercadolivre_token_expires_at"),
      ]);
      return null;
    }
  })();
  try { return await refreshInFlight; }
  finally { refreshInFlight = null; }
}

export async function disconnectMercadoLivreOAuth() {
  await Promise.all([
    deleteIntegrationSecret("mercadolivre_access_token"),
    deleteIntegrationSecret("mercadolivre_refresh_token"),
    deleteIntegrationSecret("mercadolivre_token_expires_at"),
    deleteIntegrationSecret("mercadolivre_user_id"),
    deleteIntegrationSecret("mercadolivre_oauth_state"),
  ]);
}
