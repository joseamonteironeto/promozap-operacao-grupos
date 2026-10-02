import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { automationLog } from "@/lib/automation-log";

function validServerUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "uazapi.com" || url.hostname.endsWith(".uazapi.com"));
  } catch {
    return false;
  }
}

async function configure(baseUrl: string, token: string, webhookUrl: string) {
  const body = JSON.stringify({
    enabled: true,
    url: webhookUrl,
    events: ["messages"],
    excludeMessages: ["wasSentByApi", "fromMeYes", "isGroupNo"],
    // UAZAPI appends the event name to the configured URL when this is true.
    // Our signed endpoint uses a query-string key, so that suffix corrupts the
    // key ("?key=.../messages") and the receiver correctly returns 401.
    addUrlEvents: false,
    addUrlTypesMessages: false,
  });
  const options: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body,
    signal: AbortSignal.timeout(15_000),
  };
  let response = await fetch(`${baseUrl}/webhook`, options);
  if (response.status === 404) response = await fetch(`${baseUrl}/webhook/set`, options);
  return response;
}

export async function GET() {
  const runtime = env as unknown as { UAZAPI_SERVER_URL?: string; UAZAPI_INSTANCE_TOKEN?: string };
  const baseUrl = runtime.UAZAPI_SERVER_URL?.replace(/\/$/, "") || "";
  const token = runtime.UAZAPI_INSTANCE_TOKEN || "";
  if (!baseUrl || !token) return NextResponse.json({ configured: false, message: "Credenciais UAZAPI não configuradas no servidor." });
  try {
    const response = await fetch(`${baseUrl}/webhook`, { headers: { token }, signal: AbortSignal.timeout(10_000) });
    await response.arrayBuffer().catch(() => null);
    return NextResponse.json({ configured: response.ok, providerStatus: response.status });
  } catch {
    return NextResponse.json({ configured: false, message: "A UAZAPI não respondeu à consulta do webhook." });
  }
}

export async function POST(request: Request) {
  const runtime = env as unknown as { UAZAPI_SERVER_URL?: string; UAZAPI_INSTANCE_TOKEN?: string; PROMOZAP_WEBHOOK_SECRET?: string };
  const body = await request.json().catch(() => null) as { serverUrl?: unknown; token?: unknown } | null;
  const baseUrl = (typeof body?.serverUrl === "string" ? body.serverUrl : runtime.UAZAPI_SERVER_URL || "").trim().replace(/\/$/, "");
  const token = (typeof body?.token === "string" ? body.token : runtime.UAZAPI_INSTANCE_TOKEN || "").trim();
  const secret = runtime.PROMOZAP_WEBHOOK_SECRET || "";
  if (!validServerUrl(baseUrl) || !token || !secret) {
    await automationLog({ level: "error", stage: "webhook_setup", message: "Configuração incompleta para ativar o webhook." });
    return NextResponse.json({ ok: false, message: "Servidor, token ou segredo do webhook não configurado." }, { status: 400 });
  }
  const origin = new URL(request.url).origin;
  const webhookUrl = `${origin}/api/webhooks/uazapi?key=${encodeURIComponent(secret)}`;
  try {
    const response = await configure(baseUrl, token, webhookUrl);
    const responseText = await response.text();
    await automationLog({
      level: response.ok ? "success" : "error",
      stage: "webhook_setup",
      message: response.ok ? "Webhook da UAZAPI ativado." : `A UAZAPI recusou o webhook (HTTP ${response.status}).`,
      details: { providerStatus: response.status, responseBytes: responseText.length },
    });
    return NextResponse.json({ ok: response.ok, providerStatus: response.status, message: response.ok ? "Webhook ativado para mensagens de grupos." : "A UAZAPI recusou a configuração." }, { status: response.ok ? 200 : 502 });
  } catch {
    await automationLog({ level: "error", stage: "webhook_setup", message: "A UAZAPI não respondeu durante a ativação do webhook." });
    return NextResponse.json({ ok: false, message: "A UAZAPI não respondeu durante a ativação." }, { status: 502 });
  }
}
