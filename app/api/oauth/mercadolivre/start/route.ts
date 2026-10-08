import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { readIntegrationSecret, saveIntegrationSecret } from "@/lib/integration-secret";
import { mercadoLivreRedirectUri } from "@/lib/mercadolivre-oauth";

function authorized(request: Request) {
  const runtime = env as unknown as { UAZAPI_INSTANCE_TOKEN?: string };
  return Boolean(runtime.UAZAPI_INSTANCE_TOKEN && request.headers.get("x-promozap-admin-token") === runtime.UAZAPI_INSTANCE_TOKEN);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Token administrativo inválido." }, { status: 401 });
  const clientId = await readIntegrationSecret("mercadolivre_client_id");
  if (!clientId || !await readIntegrationSecret("mercadolivre_client_secret")) {
    return NextResponse.json({ error: "Salve o Client ID e o Client Secret do aplicativo antes de conectar." }, { status: 412 });
  }
  const state = crypto.randomUUID();
  await saveIntegrationSecret("mercadolivre_oauth_state", JSON.stringify({ state, expiresAt: Date.now() + 10 * 60 * 1000 }));
  const origin = new URL(request.url).origin;
  const authorizationUrl = new URL("https://auth.mercadolivre.com.br/authorization");
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", mercadoLivreRedirectUri(origin));
  authorizationUrl.searchParams.set("state", state);
  return NextResponse.json({ authorizationUrl: authorizationUrl.href });
}
