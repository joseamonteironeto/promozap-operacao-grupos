import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { amazonCredentialsStatus } from "@/lib/amazon-creators";
import { deleteIntegrationSecret, readIntegrationSecret, saveIntegrationSecret } from "@/lib/integration-secret";
import { disconnectMercadoLivreOAuth, mercadoLivreOAuthStatus } from "@/lib/mercadolivre-oauth";

function authorized(request: Request) {
  const runtime = env as unknown as { UAZAPI_INSTANCE_TOKEN?: string };
  return Boolean(runtime.UAZAPI_INSTANCE_TOKEN && request.headers.get("x-promozap-admin-token") === runtime.UAZAPI_INSTANCE_TOKEN);
}

export async function GET() {
  const [amazon, mercadoLivre] = await Promise.all([amazonCredentialsStatus(), mercadoLivreOAuthStatus()]);
  return NextResponse.json({ amazonConfigured: amazon.configured, mercadoLivreConfigured: mercadoLivre.connected, mercadoLivreAppConfigured: mercadoLivre.appConfigured, mercadoLivreExpiresAt: mercadoLivre.expiresAt, mercadoLivreUserId: mercadoLivre.userId });
}

export async function PUT(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Token administrativo inválido." }, { status: 401 });
  const body = await request.json() as { amazonClientId?: string; amazonClientSecret?: string; mercadoLivreClientId?: string; mercadoLivreClientSecret?: string; mercadoLivreAccessToken?: string };
  if (body.amazonClientId?.trim()) await saveIntegrationSecret("amazon_creators_client_id", body.amazonClientId.trim());
  if (body.amazonClientSecret?.trim()) await saveIntegrationSecret("amazon_creators_client_secret", body.amazonClientSecret.trim());
  if (body.mercadoLivreAccessToken?.trim()) await saveIntegrationSecret("mercadolivre_access_token", body.mercadoLivreAccessToken.trim());
  if (body.mercadoLivreClientId?.trim()) await saveIntegrationSecret("mercadolivre_client_id", body.mercadoLivreClientId.trim());
  if (body.mercadoLivreClientSecret?.trim()) await saveIntegrationSecret("mercadolivre_client_secret", body.mercadoLivreClientSecret.trim());
  return NextResponse.json({ ok: true, amazonConfigured: Boolean(body.amazonClientId?.trim() && body.amazonClientSecret?.trim()) });
}

export async function DELETE(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Token administrativo inválido." }, { status: 401 });
  const store = new URL(request.url).searchParams.get("store");
  if (store === "amazon") {
    await Promise.all([deleteIntegrationSecret("amazon_creators_client_id"), deleteIntegrationSecret("amazon_creators_client_secret")]);
  } else if (store === "mercadolivre") {
    await disconnectMercadoLivreOAuth();
    if (new URL(request.url).searchParams.get("app") === "true") {
      await Promise.all([deleteIntegrationSecret("mercadolivre_client_id"), deleteIntegrationSecret("mercadolivre_client_secret")]);
    }
  }
  return NextResponse.json({ ok: true });
}
