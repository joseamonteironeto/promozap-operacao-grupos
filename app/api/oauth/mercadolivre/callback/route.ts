import { NextResponse } from "next/server";
import { deleteIntegrationSecret, readIntegrationSecret } from "@/lib/integration-secret";
import { exchangeMercadoLivreCode, mercadoLivreRedirectUri } from "@/lib/mercadolivre-oauth";

function panelRedirect(request: Request, status: "success" | "error", message?: string) {
  const target = new URL("/", request.url);
  target.searchParams.set("ml_oauth", status);
  if (message) target.searchParams.set("ml_message", message.slice(0, 180));
  target.hash = "consultar-produtos";
  return NextResponse.redirect(target);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const denied = params.get("error");
  if (denied) return panelRedirect(request, "error", "A autorização foi cancelada no Mercado Livre.");
  const stored = await readIntegrationSecret("mercadolivre_oauth_state");
  await deleteIntegrationSecret("mercadolivre_oauth_state");
  let expected: { state?: string; expiresAt?: number } = {};
  try { expected = stored ? JSON.parse(stored) : {}; } catch {}
  if (!code || !state || state !== expected.state || !expected.expiresAt || expected.expiresAt < Date.now()) {
    return panelRedirect(request, "error", "A autorização expirou ou não pôde ser validada. Tente conectar novamente.");
  }
  try {
    await exchangeMercadoLivreCode(code, mercadoLivreRedirectUri(new URL(request.url).origin));
    return panelRedirect(request, "success");
  } catch (error) {
    return panelRedirect(request, "error", error instanceof Error ? error.message : "Falha ao concluir a autorização.");
  }
}
