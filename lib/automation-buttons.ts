import { env } from "cloudflare:workers";

export const defaultAutomationButtonLabels = [
  "COMPRAR AGORA",
  "ADQUIRA JÁ",
  "LINK COM DESCONTO",
  "APROVEITAR OFERTA",
  "VER PROMOÇÃO",
];

export type AutomationButtonSettings = {
  enabled: boolean;
  labels: string[];
};

export function normalizeButtonLabels(value: unknown) {
  if (!Array.isArray(value)) return [];
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const label = item.trim().replace(/\s+/g, " ").slice(0, 25);
    const key = label.toLocaleUpperCase("pt-BR");
    if (label.length < 2 || label.includes("|") || /[\r\n]/.test(label) || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
    if (labels.length === 8) break;
  }
  return labels;
}

export async function getAutomationButtonSettings(): Promise<AutomationButtonSettings> {
  if (!env.DB) return { enabled: true, labels: defaultAutomationButtonLabels };
  try {
    const row = await env.DB.prepare("SELECT enabled, labels_json AS labelsJson FROM automation_button_settings WHERE id = 1")
      .first<{ enabled: number; labelsJson: string }>();
    if (!row) return { enabled: true, labels: defaultAutomationButtonLabels };
    const labels = normalizeButtonLabels(JSON.parse(row.labelsJson));
    return { enabled: Boolean(row.enabled), labels: labels.length ? labels : defaultAutomationButtonLabels };
  } catch {
    return { enabled: true, labels: defaultAutomationButtonLabels };
  }
}
