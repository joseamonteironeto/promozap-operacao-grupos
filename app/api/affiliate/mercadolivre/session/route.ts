import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { deleteIntegrationSecret, saveIntegrationSecret } from "@/lib/integration-secret";
import { parseMercadoLivreCookies } from "@/lib/mercadolivre-affiliate";

const secretName = "mercadolivre_session_cookies";

function authorized(request: Request) {
  const supplied = request.headers.get("x-promozap-admin-token") || "";
  const expected = (env as unknown as { UAZAPI_INSTANCE_TOKEN?: string }).UAZAPI_INSTANCE_TOKEN || "";
  if (!supplied || supplied.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < supplied.length; index += 1) difference |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false, message: "Token administrativo inválido." }, { status: 401 });
  const body = await request.json().catch(() => null) as { cookies?: unknown } | null;
  if (typeof body?.cookies !== "string" || !parseMercadoLivreCookies(body.cookies)) {
    return NextResponse.json({ ok: false, message: "O JSON de cookies é inválido ou já expirou." }, { status: 400 });
  }
  await saveIntegrationSecret(secretName, body.cookies);
  return NextResponse.json({ ok: true, message: "Sessão salva com criptografia para a automação." });
}

export async function DELETE(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false, message: "Token administrativo inválido." }, { status: 401 });
  await deleteIntegrationSecret(secretName);
  return NextResponse.json({ ok: true });
}
