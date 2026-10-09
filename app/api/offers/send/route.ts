import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { automationLog } from "@/lib/automation-log";

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function trustedImage(value: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    const allowed = host === "mlstatic.com" || host.endsWith(".mlstatic.com") || host === "media-amazon.com" || host.endsWith(".media-amazon.com") || host === "ssl-images-amazon.com" || host.endsWith(".ssl-images-amazon.com");
    return allowed ? url.href : null;
  } catch { return null; }
}

export async function POST(request: Request) {
  const runtime = env as unknown as { UAZAPI_SERVER_URL?: string; UAZAPI_INSTANCE_TOKEN?: string };
  const adminToken = request.headers.get("x-promozap-admin-token") || "";
  if (!runtime.UAZAPI_INSTANCE_TOKEN || adminToken !== runtime.UAZAPI_INSTANCE_TOKEN) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  if (!env.DB) return NextResponse.json({ error: "Banco de dados indisponível." }, { status: 503 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const destinationJid = clean(body.destinationJid, 160);
  const text = clean(body.text, 4096);
  const imageUrl = body.includeImage === false ? null : trustedImage(clean(body.imageUrl, 4000));
  const productId = clean(body.productId, 100);
  if (!destinationJid || !text) return NextResponse.json({ error: "Escolha o grupo e escreva a mensagem." }, { status: 400 });
  const destination = await env.DB.prepare("SELECT jid, name FROM group_configs WHERE jid = ? AND role = 'destination' AND enabled = 1")
    .bind(destinationJid).first<{ jid: string; name: string }>();
  if (!destination) return NextResponse.json({ error: "O grupo escolhido não está configurado como destino ativo." }, { status: 422 });
  const serverUrl = (runtime.UAZAPI_SERVER_URL || "").replace(/\/$/, "");
  if (!serverUrl) return NextResponse.json({ error: "Servidor UAZAPI não configurado." }, { status: 503 });
  const endpoint = imageUrl ? "/send/media" : "/send/text";
  const payload = imageUrl ? {
    number: destinationJid,
    type: "image",
    file: imageUrl,
    text,
    mimetype: imageUrl.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg",
    async: true,
    track_source: "promozap_manual",
    track_id: productId || crypto.randomUUID(),
  } : {
    number: destinationJid,
    text,
    linkPreview: true,
    async: true,
    track_source: "promozap_manual",
    track_id: productId || crypto.randomUUID(),
  };
  try {
    const response = await fetch(`${serverUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: runtime.UAZAPI_INSTANCE_TOKEN },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const providerResponse = await response.text();
    if (!response.ok) throw new Error(`UAZAPI respondeu HTTP ${response.status}: ${providerResponse.slice(0, 240)}`);
    await automationLog({ level: "success", stage: "manual_send", message: `Oferta enviada manualmente para ${destination.name || destination.jid}.`, groupJid: destination.jid, productId: productId || undefined, details: { withImage: Boolean(imageUrl), providerStatus: response.status } });
    return NextResponse.json({ ok: true, destination: destination.name || destination.jid, withImage: Boolean(imageUrl) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao enviar a oferta.";
    await automationLog({ level: "error", stage: "manual_send", message, groupJid: destinationJid, productId: productId || undefined });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
