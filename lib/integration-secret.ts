import { env } from "cloudflare:workers";

function runtimeSecret() {
  return (env as unknown as { PROMOZAP_WEBHOOK_SECRET?: string }).PROMOZAP_WEBHOOK_SECRET || "";
}

function toBase64(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function key() {
  const secret = runtimeSecret();
  if (!secret) throw new Error("Chave de proteção do painel não configurada.");
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function saveIntegrationSecret(name: string, value: string) {
  if (!env.DB) throw new Error("Banco de dados indisponível.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(value));
  await env.DB.prepare(`
    INSERT INTO integration_secrets (name, encrypted_value, iv, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET encrypted_value = excluded.encrypted_value, iv = excluded.iv, updated_at = excluded.updated_at
  `).bind(name, toBase64(new Uint8Array(encrypted)), toBase64(iv), new Date().toISOString()).run();
}

export async function readIntegrationSecret(name: string) {
  if (!env.DB) return null;
  let row: { encryptedValue: string; iv: string } | null;
  try {
    row = await env.DB.prepare("SELECT encrypted_value AS encryptedValue, iv FROM integration_secrets WHERE name = ?")
      .bind(name).first<{ encryptedValue: string; iv: string }>();
  } catch {
    return null;
  }
  if (!row) return null;
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(row.iv) },
      await key(),
      fromBase64(row.encryptedValue),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

export async function deleteIntegrationSecret(name: string) {
  if (!env.DB) return;
  await env.DB.prepare("DELETE FROM integration_secrets WHERE name = ?").bind(name).run();
}
