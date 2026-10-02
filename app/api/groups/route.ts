import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";

const demoGroups = [
  { JID: "120363001@g.us", Name: "Ofertas Tech Brasil", Topic: "Celulares, notebooks e acessórios", ParticipantCount: 824, OwnerCanSendMessage: true },
  { JID: "120363002@g.us", Name: "Achadinhos Games", Topic: "Consoles e jogos", ParticipantCount: 516, OwnerCanSendMessage: true },
  { JID: "120363003@g.us", Name: "Promozap | Tecnologia", Topic: "Grupo oficial Promozap", ParticipantCount: 148, OwnerCanSendMessage: true },
  { JID: "120363004@g.us", Name: "Casa com Desconto", Topic: "Casa e eletrodomésticos", ParticipantCount: 632, OwnerCanSendMessage: true },
  { JID: "120363005@g.us", Name: "Promozap | Casa", Topic: "Grupo oficial Promozap", ParticipantCount: 93, OwnerCanSendMessage: true },
];

function validServerUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "uazapi.com" || host.endsWith(".uazapi.com"));
  } catch {
    return false;
  }
}

async function listGroups(baseUrl: string, token: string, search = "") {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/group/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify({ search, limit: 500, offset: 0, noParticipants: true, force: false }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    return NextResponse.json({ error: "A UAZAPI recusou a conexão.", providerStatus: response.status }, { status: 502 });
  }
  const data = await response.json() as { groups?: unknown[]; pagination?: unknown };
  return NextResponse.json({ groups: Array.isArray(data.groups) ? data.groups : [], pagination: data.pagination, connected: true });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const search = url.searchParams.get("search") ?? "";
  const baseUrl = env.UAZAPI_SERVER_URL?.replace(/\/$/, "");
  const token = env.UAZAPI_INSTANCE_TOKEN;

  if (!baseUrl || !token) {
    if (process.env.NODE_ENV !== "production") {
      return NextResponse.json({ groups: demoGroups, demo: true });
    }
    return NextResponse.json({ error: "A conexão com o WhatsApp ainda não foi configurada." }, { status: 503 });
  }

  try {
    return await listGroups(baseUrl, token, search);
  } catch {
    return NextResponse.json({ error: "A conexão com o WhatsApp não respondeu." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { serverUrl?: unknown; token?: unknown; search?: unknown } | null;
  const serverUrl = typeof body?.serverUrl === "string" ? body.serverUrl.trim() : "";
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const search = typeof body?.search === "string" ? body.search.trim() : "";
  if (!validServerUrl(serverUrl) || !token || token.length > 500) {
    return NextResponse.json({ error: "Informe uma URL UAZAPI válida e o token da instância." }, { status: 400 });
  }
  try {
    return await listGroups(serverUrl, token, search);
  } catch {
    return NextResponse.json({ error: "A conexão com a UAZAPI não respondeu." }, { status: 502 });
  }
}
