import { NextResponse } from "next/server";
import { getMercadoLivreAccessToken } from "@/lib/mercadolivre-oauth";

type CategoryRow = { id?: unknown; name?: unknown };

function categories(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: CategoryRow) => typeof row.id === "string" && typeof row.name === "string"
    ? [{ id: row.id, name: row.name }]
    : []);
}

async function mlJson(path: string, token: string) {
  const response = await fetch(`https://api.mercadolibre.com${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : `HTTP ${response.status}`);
  return body;
}

export async function GET(request: Request) {
  try {
    const token = await getMercadoLivreAccessToken();
    if (!token) return NextResponse.json({ error: "Conecte o Mercado Livre para carregar as categorias oficiais." }, { status: 412 });
    const parent = new URL(request.url).searchParams.get("parent")?.trim().toUpperCase();
    if (parent) {
      if (!/^MLB\d+$/.test(parent)) return NextResponse.json({ error: "Categoria inválida." }, { status: 400 });
      const detail = await mlJson(`/categories/${encodeURIComponent(parent)}`, token);
      return NextResponse.json({ parent: { id: detail.id, name: detail.name }, categories: categories(detail.children_categories) });
    }
    return NextResponse.json({ categories: categories(await mlJson("/sites/MLB/categories", token)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível carregar as categorias." }, { status: 502 });
  }
}
