"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Bell,
  Bot,
  Check,
  CircleAlert,
  Copy,
  Cookie,
  Database,
  Eye,
  EyeOff,
  ExternalLink,
  KeyRound,
  Link2,
  LoaderCircle,
  Moon,
  MessageCircleMore,
  PackageSearch,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  ScrollText,
  Sun,
  UsersRound,
  Webhook,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";

type Group = {
  JID: string;
  Name: string;
  Topic?: string;
  ParticipantCount?: number;
  OwnerCanSendMessage?: boolean;
  image_preview_url?: string;
};

type Role = "source" | "destination" | "ignored";

type GroupConfig = {
  jid: string;
  name: string;
  role: Role;
  category: string;
  destinationJid: string;
  enabled: boolean;
};

type AffiliateSettings = {
  amazonTrackingId: string;
  mercadoLivreLabel: string;
  redirectDomain: string;
  amazonEnabled: boolean;
  mercadoLivreEnabled: boolean;
};

type WhatsAppSettings = {
  serverUrl: string;
  instanceToken: string;
};

type AutomationButtonSettings = {
  enabled: boolean;
  labels: string[];
};

type MercadoLivreTestResult = {
  ok: boolean;
  connected?: boolean;
  sessionRefreshed?: boolean;
  cookieCount?: number;
  upstreamStatus?: number;
  message: string;
  results?: Array<{
    originUrl: string;
    shortUrl: string;
    longUrl: string;
    created: boolean;
  }>;
};

type AmazonTestResult = {
  ok: boolean;
  trackingId?: string;
  message: string;
  results?: Array<{
    originUrl: string;
    ok: boolean;
    asin?: string | null;
    title?: string | null;
    resolvedUrl?: string;
    affiliateUrl?: string;
    redirectCount?: number;
    message?: string;
  }>;
};

type ProductRecord = {
  id: string;
  store: "amazon" | "mercadolivre" | "unknown";
  productCode?: string | null;
  title?: string | null;
  imageUrl?: string | null;
  productDataJson?: string | null;
  dataSource?: string | null;
  sourceUrl: string;
  resolvedUrl?: string | null;
  affiliateUrl?: string | null;
  status: "found" | "converted" | "waiting_credentials" | "unsupported" | "error" | "sent";
  sourceGroup?: string | null;
  destinationGroup?: string | null;
  messageExcerpt?: string | null;
  redirectCount: number;
  occurrences: number;
  errorMessage?: string | null;
  foundAt: string;
  lastSeenAt: string;
  sentAt?: string | null;
  updatedAt?: string | null;
};

type AutomationLog = {
  id: string;
  level: "info" | "success" | "warning" | "error";
  stage: string;
  message: string;
  detailsJson?: string | null;
  groupJid?: string | null;
  productId?: string | null;
  createdAt: string;
};

type CatalogItem = {
  id: string;
  title: string;
  imageUrl?: string | null;
  url?: string | null;
  price?: number | null;
  originalPrice?: number | null;
  currency?: string | null;
  brand?: string | null;
  condition?: string | null;
  availability?: string | null;
  availableQuantity?: number | null;
  soldQuantity?: number | null;
  freeShipping?: boolean;
  seller?: string | number | null;
  categoryId?: string | null;
  officialStore?: string | null;
};

type CatalogSearchResponse = {
  store?: "amazon" | "mercadolivre";
  query?: string;
  items?: CatalogItem[];
  total?: number;
  filters?: unknown;
  sorts?: Array<string | { id: string; name: string }>;
  error?: string;
  credentialsRequired?: boolean;
};

type ModelContext = {
  registerTool: (tool: {
    name: string;
    title: string;
    description: string;
    inputSchema: object;
    annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
    execute: (input: unknown) => Promise<unknown>;
  }, options?: { signal?: AbortSignal }) => void | Promise<void>;
};

const categories = [
  ["geral", "Ofertas gerais"],
  ["tecnologia", "Celulares e tecnologia"],
  ["games", "Games"],
  ["casa", "Casa e cozinha"],
  ["eletro", "Eletrodomésticos"],
  ["tv", "TVs"],
  ["pc", "PCs e notebooks"],
] as const;

const emptyAffiliate: AffiliateSettings = {
  amazonTrackingId: "",
  mercadoLivreLabel: "",
  redirectDomain: "",
  amazonEnabled: true,
  mercadoLivreEnabled: false,
};

const emptyWhatsApp: WhatsAppSettings = {
  serverUrl: "https://free.uazapi.com",
  instanceToken: "",
};

const defaultAutomationButtons: AutomationButtonSettings = {
  enabled: true,
  labels: ["COMPRAR AGORA", "ADQUIRA JÁ", "LINK COM DESCONTO", "APROVEITAR OFERTA", "VER PROMOÇÃO"],
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function roleLabel(role: Role) {
  if (role === "source") return "Monitorar";
  if (role === "destination") return "Meu grupo";
  return "Ignorar";
}

function productStatusLabel(status: ProductRecord["status"]) {
  return ({
    found: "Identificado",
    converted: "Convertido",
    waiting_credentials: "Aguardando sessão",
    unsupported: "Não reconhecido",
    error: "Erro",
    sent: "Enviado",
  } as const)[status];
}

function productStatusClass(status: ProductRecord["status"]) {
  if (status === "sent") return "border-[#2d8a4b] bg-[#153520] text-[#8af3a5]";
  if (status === "converted") return "border-[#2b6840] bg-[#102a19] text-[#62ef8b]";
  if (status === "waiting_credentials") return "border-[#725f22] bg-[#2a230c] text-[#f4d35e]";
  if (status === "unsupported") return "border-[#4c5650] bg-[#202622] text-[#c0c9c3]";
  if (status === "error") return "border-[#764239] bg-[#2a1612] text-[#ff9b92]";
  return "border-[#365044] bg-[#17231c] text-[#b2c9ba]";
}

function renderWhatsAppLine(line: string, lineIndex: number) {
  const pattern = /(https?:\/\/[^\s]+|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|`[^`\n]+`)/g;
  const parts = line.split(pattern).filter((part) => part.length > 0);
  return (
    <span key={`line-${lineIndex}`}>
      {parts.map((part, index) => {
        const key = `${lineIndex}-${index}`;
        if (/^https?:\/\//i.test(part)) return <a key={key} href={part} target="_blank" rel="noreferrer" className="break-all text-[#53bdeb] underline decoration-[#427d91] underline-offset-2">{part}</a>;
        if (part.startsWith("*") && part.endsWith("*")) return <strong key={key} className="font-bold text-white">{part.slice(1, -1)}</strong>;
        if (part.startsWith("_") && part.endsWith("_")) return <em key={key}>{part.slice(1, -1)}</em>;
        if (part.startsWith("~") && part.endsWith("~")) return <s key={key} className="text-[#9caaa1]">{part.slice(1, -1)}</s>;
        if (part.startsWith("`") && part.endsWith("`")) return <code key={key} className="rounded bg-black/30 px-1 py-0.5 text-[0.9em]">{part.slice(1, -1)}</code>;
        return <span key={key}>{part}</span>;
      })}
    </span>
  );
}

function WhatsAppMessage({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="whitespace-pre-wrap break-words text-[15px] leading-6 text-[#eef5f0]">
      {lines.map((line, index) => (
        <span key={index}>{renderWhatsAppLine(line, index)}{index < lines.length - 1 && <br />}</span>
      ))}
    </div>
  );
}

function parseProductData(value?: string | null) {
  if (!value) return null;
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return null; }
}

const productDataLabels: Record<string, string> = {
  id: "ID retornado", asin: "ASIN", siteId: "Site", title: "Título da API", name: "Nome", familyName: "Família",
  status: "Status", domainId: "Domínio", categoryId: "Categoria", sellerId: "Vendedor", officialStoreId: "Loja oficial",
  price: "Preço", basePrice: "Preço-base", originalPrice: "Preço original", currencyId: "Moeda", availableQuantity: "Quantidade disponível",
  soldQuantity: "Quantidade vendida", condition: "Condição", catalogProductId: "Produto de catálogo", parentId: "Produto-pai",
  permalink: "Página oficial", buyingMode: "Modo de compra", listingTypeId: "Tipo de anúncio", warranty: "Garantia", health: "Qualidade do anúncio",
  brand: "Marca", description: "Descrição", sku: "SKU", mpn: "MPN", gtin: "GTIN/EAN", category: "Categoria", color: "Cor",
  size: "Tamanho", material: "Material", model: "Modelo", apiStatus: "Situação da API", apiNote: "Observação da API",
};

function productDataValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function catalogFilterLabels(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => {
    const row = item as { name?: string; displayName?: string; id?: string };
    return row.name || row.displayName || row.id || "Filtro";
  }).filter(Boolean);
  if (value && typeof value === "object") {
    const rows = value as Record<string, { displayName?: string; id?: string }>;
    return Object.entries(rows).map(([key, item]) => item?.displayName || item?.id || key);
  }
  return [];
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("groups");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [groups, setGroups] = useState<Group[]>([]);
  const [configs, setConfigs] = useState<Record<string, GroupConfig>>({});
  const [affiliate, setAffiliate] = useState<AffiliateSettings>(emptyAffiliate);
  const [whatsapp, setWhatsapp] = useState<WhatsAppSettings>(emptyWhatsApp);
  const [whatsappLoaded, setWhatsappLoaded] = useState(false);
  const [whatsappTesting, setWhatsappTesting] = useState(false);
  const [whatsappTokenVisible, setWhatsappTokenVisible] = useState(false);
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [demo, setDemo] = useState(false);
  const [testUrl, setTestUrl] = useState("https://www.amazon.com.br/dp/B0D1234567");
  const [amazonTestUrls, setAmazonTestUrls] = useState("https://www.amazon.com.br/Cabo-DisplayPort-Premium-Performance-Metros/dp/B08LY1BKFT/ref=sr_1_4");
  const [amazonTestLoading, setAmazonTestLoading] = useState(false);
  const [amazonTestResult, setAmazonTestResult] = useState<AmazonTestResult | null>(null);
  const [mlTestUrls, setMlTestUrls] = useState("https://produto.mercadolivre.com.br/MLB-1010954920");
  const [mlSessionCookies, setMlSessionCookies] = useState("");
  const [mlCookiesLoaded, setMlCookiesLoaded] = useState(false);
  const [mlCookiesVisible, setMlCookiesVisible] = useState(false);
  const [mlTestLoading, setMlTestLoading] = useState(false);
  const [mlTestResult, setMlTestResult] = useState<MercadoLivreTestResult | null>(null);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [productTotals, setProductTotals] = useState<Record<string, number>>({});
  const [productInput, setProductInput] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [productStatus, setProductStatus] = useState("all");
  const [catalogStore, setCatalogStore] = useState("all");
  const [productsLoading, setProductsLoading] = useState(false);
  const [enrichingProductId, setEnrichingProductId] = useState("");
  const [productResolving, setProductResolving] = useState(false);
  const [productsError, setProductsError] = useState("");
  const [automationLogs, setAutomationLogs] = useState<AutomationLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [webhookSettingUp, setWebhookSettingUp] = useState(false);
  const [webhookActive, setWebhookActive] = useState(false);
  const [buttonSettings, setButtonSettings] = useState<AutomationButtonSettings>(defaultAutomationButtons);
  const [buttonDraft, setButtonDraft] = useState("");
  const [buttonSettingsSaving, setButtonSettingsSaving] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogSearchStore, setCatalogSearchStore] = useState<"mercadolivre" | "amazon">("mercadolivre");
  const [catalogSort, setCatalogSort] = useState("");
  const [catalogMinPrice, setCatalogMinPrice] = useState("");
  const [catalogMaxPrice, setCatalogMaxPrice] = useState("");
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [catalogFilters, setCatalogFilters] = useState<unknown>(null);
  const [catalogSorts, setCatalogSorts] = useState<Array<string | { id: string; name: string }>>([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogSearching, setCatalogSearching] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [catalogCredentials, setCatalogCredentials] = useState({ amazonConfigured: false, mercadoLivreConfigured: false });
  const [amazonClientId, setAmazonClientId] = useState("");
  const [amazonClientSecret, setAmazonClientSecret] = useState("");
  const [mercadoLivreAccessToken, setMercadoLivreAccessToken] = useState("");
  const [catalogCredentialsSaving, setCatalogCredentialsSaving] = useState(false);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const groupsRequest = whatsapp.instanceToken.trim()
        ? fetch("/api/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serverUrl: whatsapp.serverUrl, token: whatsapp.instanceToken, search }) })
        : fetch("/api/groups");
      const [groupsResponse, configResponse, affiliateResponse, buttonResponse] = await Promise.all([
        groupsRequest,
        fetch("/api/config"),
        fetch("/api/affiliate"),
        fetch("/api/automation/buttons"),
      ]);
      const groupsData = await groupsResponse.json() as { groups?: Group[]; demo?: boolean; connected?: boolean; error?: string };
      const configData = await configResponse.json() as { configs?: GroupConfig[] };
      const affiliateData = await affiliateResponse.json() as { settings?: Partial<AffiliateSettings> };
      const buttonData = await buttonResponse.json() as { settings?: Partial<AutomationButtonSettings> };
      if (!groupsResponse.ok) throw new Error(groupsData.error || "Não foi possível carregar os grupos.");
      const nextGroups = groupsData.groups || [];
      const saved = new Map<string, GroupConfig>((configData.configs || []).map((item: GroupConfig) => [item.jid, item]));
      const merged: Record<string, GroupConfig> = {};
      for (const group of nextGroups) {
        const item = saved.get(group.JID);
        merged[group.JID] = item ? { ...item, enabled: Boolean(item.enabled), destinationJid: item.destinationJid || "" } : {
          jid: group.JID,
          name: group.Name || group.JID,
          role: "ignored",
          category: "geral",
          destinationJid: "",
          enabled: false,
        };
      }
      setGroups(nextGroups);
      setWhatsappConnected(Boolean(groupsData.connected));
      setConfigs(merged);
      setAffiliate({ ...emptyAffiliate, ...(affiliateData.settings || {}), amazonEnabled: Boolean(affiliateData.settings?.amazonEnabled ?? true), mercadoLivreEnabled: Boolean(affiliateData.settings?.mercadoLivreEnabled) });
      setButtonSettings({
        enabled: Boolean(buttonData.settings?.enabled ?? true),
        labels: Array.isArray(buttonData.settings?.labels) && buttonData.settings.labels.length ? buttonData.settings.labels : defaultAutomationButtons.labels,
      });
      setDemo(Boolean(groupsData.demo));
    } catch (caught) {
      setWhatsappConnected(false);
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar o painel.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const saved = window.localStorage.getItem("promozap.whatsapp.settings.v1");
    if (saved) {
      try { setWhatsapp({ ...emptyWhatsApp, ...JSON.parse(saved) as Partial<WhatsAppSettings> }); } catch {}
    }
    setWhatsappLoaded(true);
  }, []);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("promozap.theme");
    if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("promozap.theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!whatsappLoaded) return;
    window.localStorage.setItem("promozap.whatsapp.settings.v1", JSON.stringify(whatsapp));
  }, [whatsapp, whatsappLoaded]);

  useEffect(() => { if (whatsappLoaded) void loadData(); }, [whatsappLoaded]);

  useEffect(() => {
    const saved = window.localStorage.getItem("promozap.ml.sessionCookies.v1");
    if (saved) setMlSessionCookies(saved);
    setMlCookiesLoaded(true);
  }, []);

  useEffect(() => {
    if (!mlCookiesLoaded) return;
    if (mlSessionCookies) window.localStorage.setItem("promozap.ml.sessionCookies.v1", mlSessionCookies);
    else window.localStorage.removeItem("promozap.ml.sessionCookies.v1");
  }, [mlSessionCookies, mlCookiesLoaded]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool || groups.length === 0) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: "configure_group_route",
      title: "Configurar rota de grupo",
      description: "Define um grupo existente como fonte, destino ou ignorado e atualiza sua categoria no painel.",
      inputSchema: {
        type: "object",
        properties: {
          jid: { type: "string" },
          role: { type: "string", enum: ["source", "destination", "ignored"] },
          category: { type: "string", enum: categories.map(([value]) => value) },
          destinationJid: { type: "string" },
        },
        required: ["jid", "role", "category"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const value = input as Partial<GroupConfig>;
        const group = groups.find((item) => item.JID === value.jid);
        if (!group || !["source", "destination", "ignored"].includes(value.role || "")) throw new Error("Grupo ou função inválida.");
        const next: GroupConfig = {
          ...configs[group.JID],
          role: value.role as Role,
          category: value.category || "geral",
          destinationJid: value.destinationJid || "",
          enabled: value.role !== "ignored",
        };
        setConfigs((current) => ({ ...current, [group.JID]: next }));
        return { jid: group.JID, name: group.Name, role: next.role, category: next.category, destinationJid: next.destinationJid };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [groups, configs]);

  const destinationGroups = useMemo(() => groups.filter((group) => configs[group.JID]?.role === "destination"), [groups, configs]);
  const filteredGroups = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return groups;
    return groups.filter((group) => `${group.Name} ${group.Topic || ""} ${group.JID}`.toLowerCase().includes(value));
  }, [groups, search]);

  const stats = useMemo(() => ({
    sources: Object.values(configs).filter((item) => item.role === "source" && item.enabled).length,
    destinations: Object.values(configs).filter((item) => item.role === "destination").length,
    routes: Object.values(configs).filter((item) => item.role === "source" && item.destinationJid).length,
  }), [configs]);
  const statItems = [
    { value: stats.sources, label: "fontes ativas", Icon: Activity },
    { value: stats.destinations, label: "meus grupos", Icon: MessageCircleMore },
    { value: stats.routes, label: "rotas prontas", Icon: ArrowRight },
  ];
  const productStatItems = [
    { value: products.length, label: "produtos no histórico", Icon: PackageSearch },
    { value: productTotals.converted || 0, label: "links convertidos", Icon: Link2 },
    { value: productTotals.sent || 0, label: "ofertas enviadas", Icon: Send },
  ];
  const catalogProducts = useMemo(() => products.filter((product) =>
    product.status === "sent"
    && (product.store === "amazon" || product.store === "mercadolivre")
    && (catalogStore === "all" || product.store === catalogStore)
  ), [products, catalogStore]);
  const catalogStatItems = [
    { value: catalogProducts.length, label: "produtos enviados", Icon: Database },
    { value: catalogProducts.filter((product) => product.store === "mercadolivre").length, label: "Mercado Livre", Icon: ShoppingBag },
    { value: catalogProducts.filter((product) => product.store === "amazon").length, label: "Amazon", Icon: PackageSearch },
  ];
  const discoveryStatItems = [
    { value: catalogItems.length, label: "resultados exibidos", Icon: Search },
    { value: catalogTotal, label: "produtos encontrados", Icon: PackageSearch },
    { value: catalogSorts.length, label: "ordenações disponíveis", Icon: Settings2 },
  ];

  const convertedAmazonUrl = useMemo(() => {
    const asin = testUrl.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1]?.toUpperCase();
    if (!asin || !affiliate.amazonTrackingId) return "";
    return `https://www.amazon.com.br/dp/${asin}?tag=${encodeURIComponent(affiliate.amazonTrackingId)}`;
  }, [testUrl, affiliate.amazonTrackingId]);

  function patchConfig(jid: string, patch: Partial<GroupConfig>) {
    setConfigs((current) => ({ ...current, [jid]: { ...current[jid], ...patch } }));
  }

  async function saveGroups() {
    setSaving(true);
    try {
      const response = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ configs: Object.values(configs) }) });
      if (!response.ok) throw new Error();
      toast.success("Organização dos grupos salva.");
    } catch {
      toast.error("Não foi possível salvar os grupos.");
    } finally {
      setSaving(false);
    }
  }

  async function saveAffiliate() {
    setSaving(true);
    try {
      const response = await fetch("/api/affiliate", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(affiliate) });
      if (!response.ok) throw new Error();
      if (mlSessionCookies.trim()) {
        if (!whatsapp.instanceToken.trim()) throw new Error("Conecte a UAZAPI para autorizar o salvamento da sessão.");
        const sessionResponse = await fetch("/api/affiliate/mercadolivre/session", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Promozap-Admin-Token": whatsapp.instanceToken.trim() },
          body: JSON.stringify({ cookies: mlSessionCookies }),
        });
        const sessionResult = await sessionResponse.json() as { message?: string };
        if (!sessionResponse.ok) throw new Error(sessionResult.message || "Não foi possível salvar a sessão.");
      }
      toast.success(mlSessionCookies.trim() ? "Tag e sessão da automação salvas." : "Configurações de afiliado salvas.");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Não foi possível salvar as configurações.");
    } finally {
      setSaving(false);
    }
  }

  async function testMercadoLivreRequest() {
    const urls = mlTestUrls.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (!urls.length) {
      toast.error("Cole pelo menos um link de produto.");
      return;
    }
    if (!mlSessionCookies.trim()) {
      toast.error("Cole os cookies da sessão do Mercado Livre.");
      return;
    }
    setMlTestLoading(true);
    setMlTestResult(null);
    try {
      const response = await fetch("/api/affiliate/mercadolivre/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(whatsapp.instanceToken.trim() ? { "X-Promozap-Admin-Token": whatsapp.instanceToken.trim() } : {}),
        },
        body: JSON.stringify({ urls, tag: affiliate.mercadoLivreLabel.trim() || "promozap", cookies: mlSessionCookies }),
      });
      const result = await response.json() as MercadoLivreTestResult;
      setMlTestResult(result);
      if (result.ok) {
        toast.success(result.sessionRefreshed ? "Links gerados e sessão renovada automaticamente." : "Links gerados com sua sessão do Mercado Livre.");
        if (whatsapp.instanceToken.trim()) {
          await fetch("/api/affiliate/mercadolivre/session", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Promozap-Admin-Token": whatsapp.instanceToken.trim() },
            body: JSON.stringify({ cookies: mlSessionCookies }),
          });
        }
      }
      else toast.warning(result.message);
    } catch {
      setMlTestResult({ ok: false, message: "O painel não conseguiu concluir o teste agora." });
      toast.error("Não foi possível executar o teste.");
    } finally {
      setMlTestLoading(false);
    }
  }

  async function testAmazonRequest() {
    const urls = amazonTestUrls.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (!urls.length) {
      toast.error("Cole pelo menos um link da Amazon.");
      return;
    }
    setAmazonTestLoading(true);
    setAmazonTestResult(null);
    try {
      const response = await fetch("/api/affiliate/amazon/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const result = await response.json() as AmazonTestResult;
      setAmazonTestResult(result);
      if (result.ok) toast.success(result.message);
      else toast.warning(result.message);
    } catch {
      setAmazonTestResult({ ok: false, message: "O painel não conseguiu concluir a conversão agora." });
      toast.error("Não foi possível gerar os links da Amazon.");
    } finally {
      setAmazonTestLoading(false);
    }
  }

  async function loadProducts() {
    setProductsLoading(true);
    setProductsError("");
    try {
      const params = new URLSearchParams();
      const requestedStatus = activeTab === "catalog" ? "sent" : productStatus;
      if (requestedStatus !== "all") params.set("status", requestedStatus);
      if (productSearch.trim()) params.set("search", productSearch.trim());
      const response = await fetch(`/api/products?${params.toString()}`);
      const result = await response.json() as { products?: ProductRecord[]; totals?: Record<string, number>; error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível carregar os produtos.");
      setProducts(result.products || []);
      setProductTotals(result.totals || {});
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Não foi possível carregar os produtos.";
      setProductsError(message);
      toast.error(message);
    } finally {
      setProductsLoading(false);
    }
  }

  async function loadAutomationLogs() {
    setLogsLoading(true);
    try {
      const response = await fetch("/api/logs?limit=150", { cache: "no-store" });
      const result = await response.json() as { logs?: AutomationLog[]; error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível carregar os logs.");
      setAutomationLogs(result.logs || []);
    } catch (caught) {
      if (activeTab === "automation") toast.error(caught instanceof Error ? caught.message : "Não foi possível carregar os logs.");
    } finally {
      setLogsLoading(false);
    }
  }

  async function setupUazapiWebhook(showToast = true) {
    setWebhookSettingUp(true);
    try {
      const response = await fetch("/api/automation/uazapi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverUrl: whatsapp.serverUrl, token: whatsapp.instanceToken }),
      });
      const result = await response.json() as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message || "A UAZAPI recusou o webhook.");
      setWebhookActive(true);
      if (showToast) toast.success("Automação ativada na UAZAPI.");
      await loadAutomationLogs();
    } catch (caught) {
      setWebhookActive(false);
      if (showToast) toast.error(caught instanceof Error ? caught.message : "Não foi possível ativar o webhook.");
    } finally {
      setWebhookSettingUp(false);
    }
  }

  function addButtonLabel() {
    const label = buttonDraft.trim().replace(/\s+/g, " ");
    if (label.length < 2) return toast.error("Digite um texto para o botão.");
    if (label.length > 25) return toast.error("Use no máximo 25 caracteres.");
    if (label.includes("|")) return toast.error("O texto não pode conter o caractere |.");
    if (buttonSettings.labels.length >= 8) return toast.error("Você pode cadastrar até 8 opções.");
    if (buttonSettings.labels.some((item) => item.toLocaleUpperCase("pt-BR") === label.toLocaleUpperCase("pt-BR"))) return toast.error("Essa opção já foi adicionada.");
    setButtonSettings((current) => ({ ...current, labels: [...current.labels, label] }));
    setButtonDraft("");
  }

  async function saveButtonSettings() {
    if (!whatsapp.instanceToken.trim()) return toast.error("Informe o token da UAZAPI para autorizar o salvamento.");
    if (buttonSettings.enabled && buttonSettings.labels.length === 0) return toast.error("Adicione pelo menos uma opção de botão.");
    setButtonSettingsSaving(true);
    try {
      const response = await fetch("/api/automation/buttons", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Promozap-Admin-Token": whatsapp.instanceToken.trim() },
        body: JSON.stringify(buttonSettings),
      });
      const result = await response.json() as { error?: string; settings?: AutomationButtonSettings };
      if (!response.ok) throw new Error(result.error || "Não foi possível salvar os botões.");
      if (result.settings) setButtonSettings(result.settings);
      toast.success("Botões de compra salvos para a automação.");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Não foi possível salvar os botões.");
    } finally {
      setButtonSettingsSaving(false);
    }
  }

  async function loadCatalogCredentialStatus() {
    try {
      const response = await fetch("/api/catalog/credentials");
      const result = await response.json() as typeof catalogCredentials;
      if (response.ok) setCatalogCredentials(result);
    } catch {}
  }

  async function saveCatalogCredentials() {
    if (!whatsapp.instanceToken.trim()) return toast.error("Informe o token da UAZAPI para autorizar o salvamento seguro.");
    setCatalogCredentialsSaving(true);
    try {
      const response = await fetch("/api/catalog/credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Promozap-Admin-Token": whatsapp.instanceToken.trim() },
        body: JSON.stringify({ amazonClientId, amazonClientSecret, mercadoLivreAccessToken }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível salvar as credenciais.");
      setAmazonClientId("");
      setAmazonClientSecret("");
      setMercadoLivreAccessToken("");
      await loadCatalogCredentialStatus();
      toast.success("Credenciais de catálogo salvas com criptografia.");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Não foi possível salvar as credenciais.");
    } finally {
      setCatalogCredentialsSaving(false);
    }
  }

  async function searchCatalog() {
    if (catalogSearchStore === "amazon" && !catalogQuery.trim()) return toast.error("Informe o que deseja buscar na Amazon.");
    setCatalogSearching(true);
    setCatalogError("");
    try {
      const params = new URLSearchParams({ store: catalogSearchStore });
      if (catalogQuery.trim()) params.set("q", catalogQuery.trim());
      if (catalogSort) params.set("sort", catalogSort);
      if (catalogMinPrice) params.set("minPrice", catalogMinPrice);
      if (catalogMaxPrice) params.set("maxPrice", catalogMaxPrice);
      const response = await fetch(`/api/catalog/search?${params}`);
      const result = await response.json() as CatalogSearchResponse;
      if (!response.ok) throw new Error(result.error || "Não foi possível consultar os produtos.");
      setCatalogItems(result.items || []);
      setCatalogFilters(result.filters || null);
      setCatalogSorts(result.sorts || []);
      setCatalogTotal(result.total || 0);
      if (!catalogQuery.trim() && result.query) setCatalogQuery(result.query);
    } catch (caught) {
      setCatalogItems([]);
      setCatalogFilters(null);
      setCatalogError(caught instanceof Error ? caught.message : "Não foi possível consultar os produtos.");
    } finally {
      setCatalogSearching(false);
    }
  }

  async function analyzeProductLinks() {
    if (!productInput.trim()) {
      toast.error("Cole uma mensagem ou um link para analisar.");
      return;
    }
    setProductResolving(true);
    try {
      const response = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: productInput, cookies: mlSessionCookies }),
      });
      const result = await response.json() as { products?: ProductRecord[]; error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível analisar o link.");
      const converted = (result.products || []).filter((item) => item.status === "converted").length;
      toast.success(`${result.products?.length || 0} link(s) analisado(s)${converted ? ` · ${converted} convertido(s)` : ""}.`);
      setProductInput("");
      await loadProducts();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Não foi possível analisar o link.");
    } finally {
      setProductResolving(false);
    }
  }

  async function markProductSent(id: string) {
    try {
      const response = await fetch("/api/products", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: "sent" }) });
      if (!response.ok) throw new Error();
      toast.success("Produto marcado como enviado.");
      await loadProducts();
    } catch {
      toast.error("Não foi possível atualizar o produto.");
    }
  }

  async function refreshProductData(id: string) {
    if (!whatsapp.instanceToken.trim()) return toast.error("Informe o token da UAZAPI na configuração para autorizar a atualização.");
    setEnrichingProductId(id);
    try {
      const response = await fetch("/api/products/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Promozap-Admin-Token": whatsapp.instanceToken.trim() },
        body: JSON.stringify({ id }),
      });
      const result = await response.json() as { error?: string; source?: string };
      if (!response.ok) throw new Error(result.error || "A loja não retornou os dados.");
      toast.success(`Dados atualizados${result.source ? ` via ${result.source}` : ""}.`);
      await loadProducts();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Não foi possível atualizar os dados.");
    } finally {
      setEnrichingProductId("");
    }
  }

  useEffect(() => {
    if (activeTab === "products" || activeTab === "catalog") void loadProducts();
  }, [activeTab, productStatus]);

  useEffect(() => {
    if (activeTab !== "products" && activeTab !== "catalog") return;
    const timer = window.setInterval(() => void loadProducts(), 10_000);
    return () => window.clearInterval(timer);
  }, [activeTab, productStatus, productSearch]);

  useEffect(() => {
    if (activeTab !== "automation") return;
    void loadAutomationLogs();
    const timer = window.setInterval(() => void loadAutomationLogs(), 6_000);
    return () => window.clearInterval(timer);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "discovery") void loadCatalogCredentialStatus();
  }, [activeTab]);

  async function testWhatsappConnection() {
    if (!whatsapp.serverUrl.trim() || !whatsapp.instanceToken.trim()) {
      toast.error("Informe a URL e o token da instância.");
      return;
    }
    setWhatsappTesting(true);
    try {
      const response = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverUrl: whatsapp.serverUrl, token: whatsapp.instanceToken }),
      });
      const result = await response.json() as { groups?: Group[]; error?: string };
      if (!response.ok) throw new Error(result.error || "A conexão foi recusada.");
      const nextGroups = result.groups || [];
      setGroups(nextGroups);
      setConfigs((current) => {
        const next = { ...current };
        for (const group of nextGroups) {
          if (next[group.JID]) continue;
          next[group.JID] = {
            jid: group.JID,
            name: group.Name || group.JID,
            role: "ignored",
            category: "geral",
            destinationJid: "",
            enabled: false,
          };
        }
        return next;
      });
      setWhatsappConnected(true);
      setDemo(false);
      setError("");
      toast.success(`UAZAPI conectada: ${(result.groups || []).length} grupo(s) encontrado(s).`);
      await setupUazapiWebhook(false);
    } catch (caught) {
      setWhatsappConnected(false);
      toast.error(caught instanceof Error ? caught.message : "Não foi possível conectar à UAZAPI.");
    } finally {
      setWhatsappTesting(false);
    }
  }

  const pageMeta = {
    groups: ["Grupos", "Organize fontes, destinos e categorias da operação."],
    products: ["Produtos encontrados", "Acompanhe cada link identificado, convertido e enviado."],
    catalog: ["Dados dos produtos", "Veja tudo o que foi extraído das ofertas enviadas da Amazon e do Mercado Livre."],
    discovery: ["Consultar produtos", "Pesquise recomendações, preços e filtros nos catálogos oficiais."],
    affiliates: ["Afiliados", "Defina como os links encontrados serão convertidos."],
    amazon: ["Gerador Amazon", "Cole links longos ou encurtados e gere versões limpas com seu Tracking ID."],
    mercadolivre: ["Gerador Mercado Livre", "Gere links com sua tag e sua sessão de afiliado."],
    automation: ["Automação", "Acompanhe o fluxo das ofertas entre os grupos."],
    whatsapp: ["WhatsApp / UAZAPI", "Conecte a instância usada para ler e publicar nos grupos."],
  }[activeTab] || ["Painel Promozap", "Operação de grupos de ofertas."];

  return (
    <main className={`promozap-${theme} min-h-screen bg-background text-foreground`}>
      <Toaster position="top-center" richColors />
      <div className="min-h-screen lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="hidden border-r border-[#243029] bg-[#070a08] lg:block">
          <div className="sticky top-0 flex h-screen flex-col">
            <div className="flex h-[76px] items-center border-b border-[#243029] px-5">
              <Image src="/promozap-logo.png" width={170} height={57} alt="Promozap" className="h-auto w-[170px] object-contain" priority />
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto p-3 text-sm">
              {[
                ["groups", "Grupos", UsersRound],
                ["products", "Produtos", PackageSearch],
                ["catalog", "Dados dos produtos", Database],
                ["discovery", "Consultar produtos", Search],
                ["affiliates", "Afiliados", Link2],
                ["amazon", "Gerador Amazon", ShoppingBag],
                ["mercadolivre", "Gerador ML", KeyRound],
                ["automation", "Automação", Bot],
                ["whatsapp", "WhatsApp / UAZAPI", Smartphone],
              ].map(([value, label, Icon]) => (
                <button key={String(value)} onClick={() => setActiveTab(String(value))} className={`promozap-menu-item flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left font-semibold transition-colors ${activeTab === value ? "promozap-menu-active bg-[#62ef8b] text-[#07140b] ring-1 ring-[#80f59f]/55" : "text-[#e0e8e2] hover:bg-[#18221b] hover:text-white"}`}>
                  <Icon className="size-4 shrink-0" /><span className="truncate">{label}</span>
                </button>
              ))}
            </nav>
            <div className="border-t border-[#243029] p-3">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl bg-[#101612] px-3 py-3">
                <div className="min-w-0"><p className="truncate text-sm font-medium">José Augusto</p><p className="truncate text-xs text-[#62ef8b]">Operação Promozap</p></div>
                <button onClick={() => setActiveTab("whatsapp")} aria-label="Configurar WhatsApp" className="grid size-8 place-items-center rounded-lg text-[#94a69b] hover:bg-[#1b241e] hover:text-white"><Settings2 className="size-4" /></button>
              </div>
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-40 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[#243029] bg-[#030504]/88 px-4 py-3 backdrop-blur-xl sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <Image src="/promozap-logo.png" width={128} height={43} alt="Promozap" className="h-auto w-28 object-contain lg:hidden" priority />
              <div className="relative hidden max-w-sm flex-1 lg:block"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#718079]" /><Input value={activeTab === "groups" ? search : ""} onChange={(event) => { setActiveTab("groups"); setSearch(event.target.value); }} placeholder="Buscar grupos..." className="h-10 border-[#2a3730] bg-[#0d1310] pl-9" /></div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="icon" className="border-[#2a3730] bg-[#0d1310] text-[#94a69b] hover:bg-[#172019]" aria-label="Notificações"><Bell className="size-4" /></Button>
              <Button onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")} variant="outline" size="icon" className="border-[#2a3730] bg-[#0d1310] text-[#94a69b] hover:bg-[#172019]" aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}>{theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}</Button>
              <button onClick={() => setActiveTab("whatsapp")} className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${whatsappConnected ? "border-[#2f7042] bg-[#102218] text-[#72f295]" : "border-[#3b443e] bg-[#111512] text-[#a7afa9]"}`}><span className={`size-2 rounded-full ${whatsappConnected ? "bg-[#31d365]" : "bg-[#778078]"}`} />{whatsappConnected ? "Conectado" : "Configurar"}</button>
            </div>
          </header>

          <section className="min-w-0 space-y-6 p-4 sm:p-6">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0"><h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{pageMeta[0]}</h1><p className="mt-1 text-sm text-[#94a69b]">{pageMeta[1]}</p></div>
              <Button onClick={() => void loadData()} variant="outline" className="h-10 rounded-lg border-[#2b3830] bg-[#0d1310] text-white hover:bg-[#162019]"><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Atualizar</Button>
            </div>

          <div className="mb-6 grid grid-cols-3 overflow-hidden rounded-2xl border border-[#27322b] bg-[#0b100d] shadow-[0_18px_50px_rgba(0,0,0,.28)]">
            {(activeTab === "products" ? productStatItems : activeTab === "catalog" ? catalogStatItems : activeTab === "discovery" ? discoveryStatItems : statItems).map(({ value, label, Icon }, index) => (
              <div key={label} className={`px-3 py-4 sm:px-5 ${index ? "border-l border-[#27322b]" : ""}`}>
                <Icon className="mb-2 size-4 text-[#00a947]" />
                <p className="text-2xl font-extrabold tracking-tight">{value}</p>
                <p className="text-xs text-[#94a69b] sm:text-sm">{label}</p>
              </div>
            ))}
          </div>

          {demo && <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><CircleAlert className="mt-0.5 size-4 shrink-0" /><span>Prévia com grupos de exemplo. Na versão publicada, o painel usa os grupos da sua instância.</span></div>}
          {error && <div className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><CircleAlert className="mt-0.5 size-4 shrink-0" /><span>{error}</span></div>}

          <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-5">
            <TabsList className="h-12 w-full justify-start overflow-x-auto rounded-xl border border-[#27322b] bg-[#0b100d] p-1 lg:hidden">
              <TabsTrigger value="groups" className="h-10 min-w-28 rounded-lg px-4">Grupos</TabsTrigger>
              <TabsTrigger value="products" className="h-10 min-w-28 rounded-lg px-4">Produtos</TabsTrigger>
              <TabsTrigger value="catalog" className="h-10 min-w-40 rounded-lg px-4">Dados dos produtos</TabsTrigger>
              <TabsTrigger value="discovery" className="h-10 min-w-40 rounded-lg px-4">Consultar produtos</TabsTrigger>
              <TabsTrigger value="affiliates" className="h-10 min-w-28 rounded-lg px-4">Afiliados</TabsTrigger>
              <TabsTrigger value="amazon" className="h-10 min-w-36 rounded-lg px-4 data-[state=active]:bg-[#ff9900] data-[state=active]:text-[#111820]">Gerador Amazon</TabsTrigger>
              <TabsTrigger value="mercadolivre" className="h-10 min-w-32 rounded-lg px-4 data-[state=active]:bg-[#ffe600] data-[state=active]:text-[#231f00]">Gerador ML</TabsTrigger>
              <TabsTrigger value="automation" className="h-10 min-w-28 rounded-lg px-4">Automação</TabsTrigger>
              <TabsTrigger value="whatsapp" className="h-10 min-w-36 rounded-lg px-4">WhatsApp</TabsTrigger>
            </TabsList>

            <TabsContent value="groups" id="grupos">
              <Card className="gap-0 overflow-hidden border-[#dce7df] py-0 shadow-[0_10px_30px_rgba(7,20,22,.05)]">
                <CardHeader className="border-b border-[#e4ece7] px-4 py-5 sm:px-6">
                  <CardTitle className="text-xl">Seus grupos do WhatsApp</CardTitle>
                  <CardDescription>Marque os grupos-fonte, seus grupos de destino e a categoria de cada rota.</CardDescription>
                  <div className="relative mt-3">
                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#7a8880]" />
                    <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar grupo pelo nome" className="h-11 rounded-xl border-[#dce7df] bg-[#f8fbf9] pl-10" />
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {loading ? (
                    <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-[#66736c]"><LoaderCircle className="size-5 animate-spin text-[#00c853]" /> Carregando grupos...</div>
                  ) : filteredGroups.length === 0 ? (
                    <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center"><UsersRound className="mb-3 size-8 text-[#9bad9f]" /><p className="font-semibold">Nenhum grupo encontrado</p><p className="mt-1 text-sm text-[#66736c]">Confira a conexão ou tente outra busca.</p></div>
                  ) : filteredGroups.map((group) => {
                    const config = configs[group.JID];
                    if (!config) return null;
                    return (
                      <div key={group.JID} className="border-b border-[#edf2ee] p-4 last:border-0 sm:p-5">
                        <div className="flex items-start gap-3">
                          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#e9f9ee] text-sm font-extrabold text-[#008f3d]">{initials(group.Name || "G")}</div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate font-bold">{group.Name || "Grupo sem nome"}</p>
                              {config.role !== "ignored" && <Badge className={config.role === "source" ? "bg-[#e7f9ed] text-[#087c39]" : "bg-[#071416] text-white"}>{roleLabel(config.role)}</Badge>}
                            </div>
                            <p className="mt-1 truncate text-xs text-[#7a8880]">{group.Topic || `${group.ParticipantCount || 0} participantes`}</p>
                          </div>
                          <Switch checked={config.enabled} onCheckedChange={(enabled) => patchConfig(group.JID, { enabled })} disabled={config.role === "ignored"} aria-label={`Ativar ${group.Name}`} />
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          <label className="space-y-1.5 text-xs font-semibold text-[#526159]">
                            Função do grupo
                            <NativeSelect value={config.role} onChange={(event) => patchConfig(group.JID, { role: event.target.value as Role, enabled: event.target.value !== "ignored" })} className="h-11 w-full rounded-xl bg-white text-sm">
                              <NativeSelectOption value="ignored">Ignorar</NativeSelectOption>
                              <NativeSelectOption value="source">Monitorar como fonte</NativeSelectOption>
                              <NativeSelectOption value="destination">Meu grupo de destino</NativeSelectOption>
                            </NativeSelect>
                          </label>
                          <label className="space-y-1.5 text-xs font-semibold text-[#526159]">
                            Categoria
                            <NativeSelect value={config.category} onChange={(event) => patchConfig(group.JID, { category: event.target.value })} disabled={config.role === "ignored"} className="h-11 w-full rounded-xl bg-white text-sm">
                              {categories.map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
                            </NativeSelect>
                          </label>
                          <label className="space-y-1.5 text-xs font-semibold text-[#526159]">
                            Enviar as ofertas para
                            <NativeSelect value={config.destinationJid} onChange={(event) => patchConfig(group.JID, { destinationJid: event.target.value })} disabled={config.role !== "source"} className="h-11 w-full rounded-xl bg-white text-sm">
                              <NativeSelectOption value="">Escolher meu grupo</NativeSelectOption>
                              {destinationGroups.map((destination) => <NativeSelectOption key={destination.JID} value={destination.JID}>{destination.Name}</NativeSelectOption>)}
                            </NativeSelect>
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
              <div className="mt-4 flex justify-end">
                <Button onClick={() => void saveGroups()} disabled={saving} className="h-12 w-full rounded-xl bg-[#00c853] px-6 text-[#04140a] shadow-[0_10px_30px_rgba(0,200,83,.28)] hover:bg-[#16dc61] sm:w-auto">{saving ? <LoaderCircle className="animate-spin" /> : <Check />} Salvar organização</Button>
              </div>
            </TabsContent>

            <TabsContent value="products" id="produtos">
              <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
                <Card className="h-fit border-[#27322b] bg-[#0b100d] shadow-none xl:sticky xl:top-24">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg"><PackageSearch className="size-5 text-[#62ef8b]" /> Resolver um link</CardTitle>
                    <CardDescription>Cole a mensagem inteira. O painel percorre os redirecionamentos e procura Amazon ou Mercado Livre.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Textarea value={productInput} onChange={(event) => setProductInput(event.target.value)} rows={7} placeholder={"Ex.: Oferta encontrada!\nhttps://amzn.to/...\nou https://promoby.me/..."} className="min-h-40 resize-y rounded-xl border-[#34423a] bg-[#080c09]" />
                    <Button onClick={() => void analyzeProductLinks()} disabled={productResolving} className="h-12 w-full rounded-xl bg-[#00c853] font-bold text-[#04140a] hover:bg-[#16dc61]">{productResolving ? <LoaderCircle className="animate-spin" /> : <PackageSearch />} Identificar e converter</Button>
                    <div className="rounded-xl border border-[#244c31] bg-[#0d1d12] p-3 text-sm leading-6 text-[#a7cbb2]">
                      Links de outras lojas são registrados sem alteração. No Mercado Livre, a conversão usa a sessão salva neste navegador.
                    </div>
                  </CardContent>
                </Card>

                <div className="min-w-0 space-y-4">
                  <Card className="border-[#27322b] bg-[#0b100d] shadow-none">
                    <CardContent className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_210px_auto]">
                      <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#718079]" /><Input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadProducts(); }} placeholder="Buscar produto, código ou link" className="h-11 rounded-xl border-[#34423a] bg-[#080c09] pl-10" /></div>
                      <NativeSelect value={productStatus} onChange={(event) => setProductStatus(event.target.value)} className="h-11 w-full rounded-xl border-[#34423a] bg-[#080c09]">
                        <NativeSelectOption value="all">Todos os status</NativeSelectOption>
                        <NativeSelectOption value="converted">Convertidos</NativeSelectOption>
                        <NativeSelectOption value="sent">Enviados</NativeSelectOption>
                        <NativeSelectOption value="waiting_credentials">Aguardando sessão</NativeSelectOption>
                        <NativeSelectOption value="unsupported">Não reconhecidos</NativeSelectOption>
                        <NativeSelectOption value="error">Com erro</NativeSelectOption>
                      </NativeSelect>
                      <Button onClick={() => void loadProducts()} variant="outline" className="h-11 rounded-xl border-[#34423a] bg-[#111813] text-white hover:bg-[#19231c]"><RefreshCw className={productsLoading ? "animate-spin" : ""} /> Atualizar</Button>
                    </CardContent>
                  </Card>

                  {productsError && <div className="flex items-start gap-3 rounded-xl border border-[#74443c] bg-[#251412] p-4 text-sm text-[#ffaaa2]"><CircleAlert className="mt-0.5 size-4 shrink-0" /><div><p className="font-semibold">O histórico não carregou</p><p className="mt-1">{productsError}</p></div></div>}

                  {productsLoading && products.length === 0 ? (
                    <Card className="border-[#27322b] bg-[#0b100d] shadow-none"><CardContent className="flex min-h-56 items-center justify-center gap-3 text-sm text-[#94a69b]"><LoaderCircle className="size-5 animate-spin text-[#62ef8b]" /> Carregando histórico...</CardContent></Card>
                  ) : products.length === 0 ? (
                    <Card className="border-[#27322b] bg-[#0b100d] shadow-none"><CardContent className="flex min-h-64 flex-col items-center justify-center px-6 text-center"><PackageSearch className="mb-3 size-9 text-[#567061]" /><p className="font-semibold">Nenhum produto encontrado ainda</p><p className="mt-2 max-w-md text-sm leading-6 text-[#94a69b]">Cole uma mensagem ao lado para testar. Os produtos capturados pela automação aparecerão neste mesmo histórico.</p></CardContent></Card>
                  ) : products.map((product) => (
                    <Card key={product.id} className="overflow-hidden border-[#27322b] bg-[#0b100d] shadow-none">
                      <CardContent className="p-0">
                        <div className={`flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 ${product.status === "sent" ? "border-[#245c34] bg-[#102619]" : product.status === "converted" ? "border-[#285d39] bg-[#12251a]" : product.status === "waiting_credentials" ? "border-[#65582d] bg-[#29230f]" : product.status === "error" ? "border-[#74443c] bg-[#2a1512]" : "border-[#343f38] bg-[#151b17]"}`}>
                          <div className="flex min-w-0 items-center gap-3">
                            <span className={`size-2.5 shrink-0 rounded-full ${product.status === "sent" ? "bg-[#62ef8b]" : product.status === "converted" ? "bg-[#39d66d]" : product.status === "waiting_credentials" ? "bg-[#f2c94c]" : product.status === "error" ? "bg-[#ff756b]" : "bg-[#8c9a91]"}`} />
                            <div className="min-w-0">
                              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#91a298]">Situação da oferta</p>
                              <p className="mt-0.5 truncate font-bold text-white">{productStatusLabel(product.status)}</p>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#a8b5ad]">
                            <span>{new Date(product.lastSeenAt).toLocaleString("pt-BR")}</span>
                            <span>{product.occurrences} ocorrência(s)</span>
                            {product.sentAt && <span className="font-semibold text-[#75e895]">Enviada {new Date(product.sentAt).toLocaleString("pt-BR")}</span>}
                          </div>
                        </div>

                        <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:p-5">
                          <div className="min-w-0 rounded-2xl border border-[#26352c] bg-[#07110b] p-3 sm:p-4">
                            <div className="mb-3 flex items-center justify-between gap-3 px-1">
                              <div className="min-w-0">
                                <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#62ef8b]">Mensagem original</p>
                                <p className="mt-1 truncate text-xs text-[#87978d]">{product.sourceGroup || "Grupo de origem não identificado"}</p>
                              </div>
                              <MessageCircleMore className="size-5 shrink-0 text-[#62ef8b]" />
                            </div>
                            <div className="ml-auto max-w-[96%] overflow-hidden rounded-2xl rounded-tr-md bg-[#183d2a] shadow-[0_8px_28px_rgba(0,0,0,.22)] sm:max-w-[90%]">
                              {product.imageUrl && (
                                <div className="aspect-[16/10] overflow-hidden bg-[#101713]">
                                  <img src={product.imageUrl} alt={product.title || "Foto da oferta"} loading="lazy" className="h-full w-full object-cover" />
                                </div>
                              )}
                              <div className="p-3.5 sm:p-4">
                                <WhatsAppMessage text={product.messageExcerpt || `${product.title || "Oferta encontrada"}\n\n${product.sourceUrl}`} />
                                <div className="mt-2 flex justify-end text-[11px] text-[#a9c7b5]">{new Date(product.lastSeenAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} <span className="ml-1 text-[#53bdeb]">✓✓</span></div>
                              </div>
                            </div>
                          </div>

                          <div className="min-w-0 space-y-4">
                            <div className="flex items-center gap-3">
                              <div className={`grid size-12 shrink-0 place-items-center rounded-xl font-extrabold ${product.store === "amazon" ? "bg-[#ff9900] text-[#231500]" : product.store === "mercadolivre" ? "bg-[#ffe600] text-[#231f00]" : "bg-[#252d28] text-[#aeb9b1]"}`}>
                                {product.store === "amazon" ? "a" : product.store === "mercadolivre" ? "ML" : <ShoppingBag className="size-5" />}
                              </div>
                              <div className="min-w-0"><p className="line-clamp-2 font-bold leading-5">{product.title || product.productCode || "Produto não reconhecido"}</p><p className="mt-1 text-xs text-[#94a69b]">{product.store === "amazon" ? "Amazon" : product.store === "mercadolivre" ? "Mercado Livre" : "Outra loja"}{product.productCode ? ` · ${product.productCode}` : ""}</p></div>
                            </div>

                            <div className="space-y-2 rounded-xl border border-[#27322b] bg-[#080c09] p-3 text-xs leading-5 text-[#95a39a]">
                              <div className="flex justify-between gap-3"><span>Redirecionamentos</span><strong className="text-white">{product.redirectCount}</strong></div>
                              <div className="flex justify-between gap-3"><span>Destino</span><strong className="max-w-36 truncate text-right text-white">{product.destinationGroup || "—"}</strong></div>
                            </div>

                            {product.errorMessage && <div className="rounded-xl border border-[#66532e] bg-[#241d0c] p-3 text-sm leading-6 text-[#e6c47d]"><p className="font-semibold text-[#f0cf88]">Atenção</p><p className="mt-1">{product.errorMessage}</p></div>}

                            <div className="grid gap-2">
                              {(product.affiliateUrl || product.resolvedUrl) && <Button variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(product.affiliateUrl || product.resolvedUrl || product.sourceUrl); toast.success("Link copiado."); }} className="h-10 justify-start rounded-lg border-[#34423a] bg-[#111813] text-white hover:bg-[#19231c]"><Copy /> Copiar link {product.affiliateUrl ? "convertido" : "resolvido"}</Button>}
                              <Button asChild variant="outline" size="sm" className="h-10 justify-start rounded-lg border-[#34423a] bg-[#111813] text-white hover:bg-[#19231c]"><a href={product.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink /> Abrir link original</a></Button>
                              {product.status === "converted" && <Button size="sm" onClick={() => void markProductSent(product.id)} className="h-10 justify-start rounded-lg bg-[#00c853] text-[#04140a] hover:bg-[#16dc61]"><Send /> Marcar como enviado</Button>}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="catalog" id="dados-dos-produtos">
              <div className="space-y-4">
                <Card className="border-[#27322b] bg-[#0b100d] shadow-none">
                  <CardContent className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_220px_auto]">
                    <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#718079]" /><Input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadProducts(); }} placeholder="Buscar título, código ou link" className="h-11 rounded-xl border-[#34423a] bg-[#080c09] pl-10" /></div>
                    <NativeSelect value={catalogStore} onChange={(event) => setCatalogStore(event.target.value)} className="h-11 w-full rounded-xl border-[#34423a] bg-[#080c09]">
                      <NativeSelectOption value="all">Amazon e Mercado Livre</NativeSelectOption>
                      <NativeSelectOption value="mercadolivre">Somente Mercado Livre</NativeSelectOption>
                      <NativeSelectOption value="amazon">Somente Amazon</NativeSelectOption>
                    </NativeSelect>
                    <Button onClick={() => void loadProducts()} variant="outline" className="h-11 rounded-xl border-[#34423a] bg-[#111813] text-white hover:bg-[#19231c]"><RefreshCw className={productsLoading ? "animate-spin" : ""} /> Atualizar</Button>
                  </CardContent>
                </Card>

                <div className="rounded-xl border border-[#244c31] bg-[#0d1d12] p-4 text-sm leading-6 text-[#a7cbb2]">
                  Esta tela mostra todos os campos que a operação armazena hoje: identificação, imagem oficial, links original, resolvido e convertido, grupos, mensagem, redirecionamentos, ocorrências e datas. Preço, estoque, vendedor e avaliações só aparecem futuramente quando forem obtidos por uma API oficial e confiável.
                </div>

                {productsError && <div className="flex items-start gap-3 rounded-xl border border-[#74443c] bg-[#251412] p-4 text-sm text-[#ffaaa2]"><CircleAlert className="mt-0.5 size-4 shrink-0" /><p>{productsError}</p></div>}
                {productsLoading && products.length === 0 ? (
                  <Card className="border-[#27322b] bg-[#0b100d] shadow-none"><CardContent className="flex min-h-56 items-center justify-center gap-3 text-sm text-[#94a69b]"><LoaderCircle className="size-5 animate-spin text-[#62ef8b]" /> Carregando dados...</CardContent></Card>
                ) : catalogProducts.length === 0 ? (
                  <Card className="border-[#27322b] bg-[#0b100d] shadow-none"><CardContent className="flex min-h-56 flex-col items-center justify-center px-6 text-center"><Database className="mb-3 size-9 text-[#567061]" /><p className="font-semibold">Nenhum produto enviado nesse filtro</p><p className="mt-2 text-sm text-[#94a69b]">Assim que uma oferta da Amazon ou Mercado Livre for enviada, os dados completos aparecerão aqui.</p></CardContent></Card>
                ) : (
                  <div className="grid gap-4 2xl:grid-cols-2">
                    {catalogProducts.map((product) => {
                      const enrichedData = parseProductData(product.productDataJson);
                      const enrichedFields = enrichedData ? Object.entries(enrichedData).filter(([key, value]) =>
                        value !== null && value !== undefined && value !== "" && !["pictures", "images", "attributes", "saleTerms", "shipping", "settings", "offers", "aggregateRating", "tags"].includes(key)
                      ) : [];
                      const attributes = enrichedData && Array.isArray(enrichedData.attributes) ? enrichedData.attributes as Array<Record<string, unknown>> : [];
                      const fields = [
                        ["Loja", product.store === "amazon" ? "Amazon" : "Mercado Livre"],
                        ["ID do produto", product.productCode || "Não identificado"],
                        ["Fonte dos dados", product.dataSource || "Página pública"],
                        ["Situação", productStatusLabel(product.status)],
                        ["Grupo de origem", product.sourceGroup || "Não informado"],
                        ["Grupo de destino", product.destinationGroup || "Não informado"],
                        ["Redirecionamentos", String(product.redirectCount)],
                        ["Ocorrências", String(product.occurrences)],
                        ["Encontrado em", new Date(product.foundAt).toLocaleString("pt-BR")],
                        ["Visto por último", new Date(product.lastSeenAt).toLocaleString("pt-BR")],
                        ["Enviado em", product.sentAt ? new Date(product.sentAt).toLocaleString("pt-BR") : "Não informado"],
                        ["Atualizado em", product.updatedAt ? new Date(product.updatedAt).toLocaleString("pt-BR") : "Não informado"],
                      ];
                      const links = [
                        ["Link recebido", product.sourceUrl],
                        ["Link final resolvido", product.resolvedUrl],
                        ["Link de afiliado enviado", product.affiliateUrl],
                        ["Imagem oficial", product.imageUrl],
                      ].filter((item): item is [string, string] => Boolean(item[1]));
                      return (
                        <Card key={product.id} className="overflow-hidden border-[#27322b] bg-[#0b100d] shadow-none">
                          <CardHeader className="border-b border-[#27322b] bg-[#0d1510]">
                            <div className="flex items-start gap-4">
                              <div className="size-20 shrink-0 overflow-hidden rounded-xl border border-[#2f3d34] bg-[#080c09]">
                                {product.imageUrl ? <img src={product.imageUrl} alt={product.title || "Produto"} loading="lazy" className="h-full w-full object-contain" /> : <div className="grid h-full place-items-center"><ShoppingBag className="size-6 text-[#607267]" /></div>}
                              </div>
                              <div className="min-w-0 flex-1"><div className="flex flex-wrap gap-2"><Badge className={product.store === "amazon" ? "bg-[#ff9900] text-[#231500]" : "bg-[#ffe600] text-[#231f00]"}>{product.store === "amazon" ? "Amazon" : "Mercado Livre"}</Badge><Badge className="border border-[#2d8a4b] bg-[#153520] text-[#8af3a5]">Enviado</Badge></div><CardTitle className="mt-3 line-clamp-2 text-lg leading-6">{product.title || product.productCode || "Produto sem título"}</CardTitle><CardDescription className="mt-1 break-all">Registro {product.id}</CardDescription><Button onClick={() => void refreshProductData(product.id)} disabled={enrichingProductId === product.id} variant="outline" size="sm" className="mt-3 border-[#34423a] bg-[#111813] text-white hover:bg-[#19231c]">{enrichingProductId === product.id ? <LoaderCircle className="animate-spin" /> : <RefreshCw />} Buscar dados da loja</Button></div>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-5 p-4 sm:p-5">
                            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                              {fields.map(([label, value]) => <div key={label} className="min-w-0 border-b border-[#202a24] pb-2"><p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#718079]">{label}</p><p className="mt-1 break-words text-sm text-[#e8f1eb]">{value}</p></div>)}
                            </div>
                            <div className="space-y-3">
                              {links.map(([label, value]) => <div key={label} className="rounded-xl border border-[#27322b] bg-[#080c09] p-3"><div className="flex items-center justify-between gap-3"><p className="text-xs font-bold text-[#94a69b]">{label}</p><Button variant="ghost" size="sm" onClick={() => { void navigator.clipboard.writeText(value); toast.success(`${label} copiado.`); }} className="h-7 px-2 text-[#62ef8b] hover:bg-[#142019]"><Copy className="size-3.5" /> Copiar</Button></div><a href={value} target="_blank" rel="noreferrer" className="mt-2 block break-all text-xs leading-5 text-[#53bdeb] underline underline-offset-2">{value}</a></div>)}
                            </div>
                            <div className="rounded-xl border border-[#2a4834] bg-[#09140d] p-4">
                              <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold uppercase tracking-[0.1em] text-[#62ef8b]">Dados extraídos do produto</p><Badge className="border border-[#2a5f39] bg-[#102619] text-[#8af3a5]">{product.dataSource || "dados públicos"}</Badge></div>
                              {enrichedFields.length ? <div className="mt-4 grid gap-x-5 gap-y-3 sm:grid-cols-2">{enrichedFields.map(([key, value]) => <div key={key} className="min-w-0"><p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#718079]">{productDataLabels[key] || key}</p><p className="mt-1 break-words text-sm leading-5 text-[#dce9df]">{productDataValue(value)}</p></div>)}</div> : <p className="mt-3 text-sm leading-6 text-[#94a69b]">Ainda não foi possível obter campos adicionais para este produto. Um novo envio tentará atualizar o registro.</p>}
                              {attributes.length > 0 && <div className="mt-4 border-t border-[#25362b] pt-4"><p className="mb-3 text-xs font-bold text-[#94a69b]">FICHA TÉCNICA ({attributes.length})</p><div className="grid gap-2 sm:grid-cols-2">{attributes.map((attribute, index) => <div key={`${String(attribute.id || attribute.name)}-${index}`} className="rounded-lg bg-[#111b14] px-3 py-2"><p className="text-xs text-[#718079]">{String(attribute.name || attribute.id || "Atributo")}</p><p className="mt-1 text-sm text-[#e4eee7]">{String(attribute.value_name || attribute.valueName || attribute.value_id || "—")}</p></div>)}</div></div>}
                            </div>
                            <div><p className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-[#718079]">Mensagem capturada</p><div className="max-h-56 overflow-auto rounded-xl border border-[#27322b] bg-[#080c09] p-3"><WhatsAppMessage text={product.messageExcerpt || "Mensagem não armazenada."} /></div></div>
                            {product.errorMessage && <div className="rounded-xl border border-[#66532e] bg-[#241d0c] p-3 text-sm text-[#e6c47d]">{product.errorMessage}</div>}
                            <details className="rounded-xl border border-[#27322b] bg-[#080c09] open:bg-[#060906]"><summary className="cursor-pointer px-3 py-3 text-sm font-semibold text-[#b7c4bc]">Ver registro bruto (JSON)</summary><div className="border-t border-[#27322b] p-3"><Button variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(JSON.stringify({ ...product, productData: enrichedData }, null, 2)); toast.success("JSON copiado."); }} className="mb-3 border-[#34423a] bg-[#111813] text-white"><Copy /> Copiar JSON</Button><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs leading-5 text-[#8fd9a4]">{JSON.stringify({ ...product, productData: enrichedData }, null, 2)}</pre></div></details>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="discovery" id="consultar-produtos">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-5">
                  <Card className="border-[#27322b] bg-[#0b100d] shadow-none">
                    <CardHeader className="border-b border-[#27322b]"><CardTitle className="text-xl">Pesquisa de catálogo</CardTitle><CardDescription>Consulte produtos e veja os filtros devolvidos pelas APIs das lojas.</CardDescription></CardHeader>
                    <CardContent className="space-y-4 pt-5">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-2 text-sm font-semibold">Loja<NativeSelect value={catalogSearchStore} onChange={(event) => { setCatalogSearchStore(event.target.value as "amazon" | "mercadolivre"); setCatalogItems([]); setCatalogFilters(null); setCatalogSort(""); setCatalogError(""); }}><NativeSelectOption value="mercadolivre">Mercado Livre</NativeSelectOption><NativeSelectOption value="amazon">Amazon</NativeSelectOption></NativeSelect></label>
                        <label className="space-y-2 text-sm font-semibold">Ordenar<NativeSelect value={catalogSort} onChange={(event) => setCatalogSort(event.target.value)}><NativeSelectOption value="">Relevância</NativeSelectOption>{catalogSorts.map((sort) => { const value = typeof sort === "string" ? sort : sort.id; const label = typeof sort === "string" ? sort : sort.name; return <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>; })}</NativeSelect></label>
                      </div>
                      <label className="block space-y-2 text-sm font-semibold">Produto ou palavra-chave<div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#718079]" /><Input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchCatalog(); }} placeholder={catalogSearchStore === "amazon" ? "Ex.: smartphone, cafeteira, notebook" : "Deixe vazio para buscar uma tendência"} className="h-12 border-[#34423a] bg-[#080c09] pl-10" /></div></label>
                      <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-2 text-sm font-semibold">Preço mínimo<Input type="number" min="0" value={catalogMinPrice} onChange={(event) => setCatalogMinPrice(event.target.value)} placeholder="R$ 0" className="h-11 border-[#34423a] bg-[#080c09]" /></label><label className="space-y-2 text-sm font-semibold">Preço máximo<Input type="number" min="0" value={catalogMaxPrice} onChange={(event) => setCatalogMaxPrice(event.target.value)} placeholder="Sem limite" className="h-11 border-[#34423a] bg-[#080c09]" /></label></div>
                      <Button onClick={() => void searchCatalog()} disabled={catalogSearching} className="h-12 w-full rounded-xl bg-[#24c75a] font-bold text-[#04140a] hover:bg-[#46df75]">{catalogSearching ? <LoaderCircle className="animate-spin" /> : <Search />} {catalogQuery.trim() ? "Consultar produtos" : "Ver recomendações"}</Button>
                      {catalogError && <div className="rounded-xl border border-[#784235] bg-[#21110e] p-3 text-sm leading-6 text-[#ffb0a7]">{catalogError}</div>}
                    </CardContent>
                  </Card>

                  {catalogItems.length > 0 && <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">{catalogItems.map((item) => (
                    <Card key={item.id} className="overflow-hidden border-[#27322b] bg-[#0b100d] shadow-none">
                      <div className="aspect-[4/3] bg-white p-3">{item.imageUrl ? <img src={item.imageUrl} alt={item.title} className="h-full w-full object-contain" loading="lazy" /> : <div className="grid h-full place-items-center"><ShoppingBag className="size-8 text-[#607267]" /></div>}</div>
                      <CardContent className="space-y-3 p-4"><div className="flex flex-wrap gap-2"><Badge className={catalogSearchStore === "amazon" ? "bg-[#ff9900] text-[#231500]" : "bg-[#ffe600] text-[#231f00]"}>{catalogSearchStore === "amazon" ? "Amazon" : "Mercado Livre"}</Badge>{item.freeShipping && <Badge className="border border-[#2d8a4b] bg-[#153520] text-[#8af3a5]">Frete grátis</Badge>}</div><h3 className="line-clamp-3 min-h-[4.5rem] font-bold leading-6">{item.title}</h3><div><p className="text-2xl font-extrabold text-[#62ef8b]">{item.price != null ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: item.currency || "BRL" }).format(item.price) : "Preço não informado"}</p>{item.originalPrice && item.originalPrice > (item.price || 0) ? <p className="text-sm text-[#718079] line-through">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: item.currency || "BRL" }).format(item.originalPrice)}</p> : null}</div><div className="space-y-1 text-xs text-[#94a69b]">{item.brand && <p>Marca: {item.brand}</p>}{item.seller && <p>Vendedor: {item.seller}</p>}{item.soldQuantity != null && <p>Vendidos: {item.soldQuantity}</p>}{item.availability && <p>{item.availability}</p>}</div>{item.url && <Button asChild variant="outline" className="w-full border-[#34423a] bg-[#111813] text-white hover:bg-[#19231c]"><a href={item.url} target="_blank" rel="noreferrer"><ExternalLink /> Abrir produto</a></Button>}</CardContent>
                    </Card>
                  ))}</div>}
                </div>

                <div className="space-y-5">
                  <Card className="border-[#27322b] bg-[#0b100d] shadow-none"><CardHeader><CardTitle className="text-base">Filtros disponíveis</CardTitle><CardDescription>São atualizados a cada busca conforme a categoria e a loja.</CardDescription></CardHeader><CardContent>{catalogFilterLabels(catalogFilters).length ? <div className="flex flex-wrap gap-2">{catalogFilterLabels(catalogFilters).map((label) => <Badge key={label} className="border border-[#35513e] bg-[#102018] text-[#dff7e5]">{label}</Badge>)}</div> : <p className="text-sm leading-6 text-[#94a69b]">Faça uma consulta para ver categorias, marcas, condição, frete, faixa de preço e outros refinamentos retornados pela loja.</p>} {catalogFilters ? <details className="mt-4 rounded-xl border border-[#27322b] bg-[#080c09]"><summary className="cursor-pointer px-3 py-3 text-sm font-semibold">Ver filtros completos (JSON)</summary><pre className="max-h-72 overflow-auto border-t border-[#27322b] p-3 text-xs leading-5 text-[#8fd9a4]">{JSON.stringify(catalogFilters, null, 2)}</pre></details> : null}</CardContent></Card>

                  <Card className="border-[#27322b] bg-[#0b100d] shadow-none"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><KeyRound className="size-4 text-[#62ef8b]" /> Credenciais das APIs</CardTitle><CardDescription>Os segredos ficam criptografados e nunca voltam para o navegador.</CardDescription></CardHeader><CardContent className="space-y-4">
                    <div className="rounded-xl border border-[#27322b] bg-[#080c09] p-3"><div className="flex items-center justify-between"><p className="font-bold">Amazon Creators API</p><Badge className={catalogCredentials.amazonConfigured ? "bg-[#153520] text-[#8af3a5]" : "bg-[#2a230c] text-[#f4d35e]"}>{catalogCredentials.amazonConfigured ? "Conectada" : "Aguardando aprovação"}</Badge></div><p className="mt-2 text-xs leading-5 text-[#94a69b]">Sua conta mostra que ainda não está aprovada para criar credenciais. O painel já está pronto para recebê-las.</p></div>
                    <Input value={amazonClientId} onChange={(event) => setAmazonClientId(event.target.value)} placeholder="Amazon Credential ID" className="h-11 border-[#34423a] bg-[#080c09]" />
                    <Input type="password" value={amazonClientSecret} onChange={(event) => setAmazonClientSecret(event.target.value)} placeholder="Amazon Credential Secret" className="h-11 border-[#34423a] bg-[#080c09]" />
                    <div className="rounded-xl border border-[#27322b] bg-[#080c09] p-3"><div className="flex items-center justify-between"><p className="font-bold">Mercado Livre API</p><Badge className={catalogCredentials.mercadoLivreConfigured ? "bg-[#153520] text-[#8af3a5]" : "bg-[#202622] text-[#c0c9c3]"}>{catalogCredentials.mercadoLivreConfigured ? "Token salvo" : "Consulta pública"}</Badge></div><p className="mt-2 text-xs leading-5 text-[#94a69b]">A busca tenta o catálogo público. Um Access Token oficial pode ser salvo se o Mercado Livre exigir autenticação.</p></div>
                    <Input type="password" value={mercadoLivreAccessToken} onChange={(event) => setMercadoLivreAccessToken(event.target.value)} placeholder="Mercado Livre Access Token (opcional)" className="h-11 border-[#34423a] bg-[#080c09]" />
                    <Button onClick={() => void saveCatalogCredentials()} disabled={catalogCredentialsSaving || (!amazonClientId && !amazonClientSecret && !mercadoLivreAccessToken)} variant="outline" className="w-full border-[#2e7041] bg-[#112a19] text-[#8ef1aa] hover:bg-[#183b24]">{catalogCredentialsSaving ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />} Salvar com segurança</Button>
                  </CardContent></Card>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="affiliates" id="afiliados">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                <Card className="border-[#dce7df] shadow-[0_10px_30px_rgba(7,20,22,.05)]">
                  <CardHeader>
                    <CardTitle className="text-xl">Links de afiliado</CardTitle>
                    <CardDescription>Defina como os links encontrados serão convertidos antes da publicação.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="rounded-2xl border border-[#e2eae5] p-4 sm:p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div><p className="font-bold">Amazon</p><p className="mt-1 text-sm text-[#66736c]">Conversão automática pelo ASIN do produto.</p></div>
                        <Switch checked={affiliate.amazonEnabled} onCheckedChange={(amazonEnabled) => setAffiliate((value) => ({ ...value, amazonEnabled }))} aria-label="Ativar Amazon" />
                      </div>
                      <label className="mt-4 block space-y-2 text-sm font-semibold">Tracking ID da Amazon<Input value={affiliate.amazonTrackingId} onChange={(event) => setAffiliate((value) => ({ ...value, amazonTrackingId: event.target.value }))} placeholder="Ex.: promozap-20" className="h-12 rounded-xl" /></label>
                      <p className="mt-2 text-xs leading-5 text-[#66736c]">O painel encontra o ASIN e monta um link limpo com o seu Tracking ID.</p>
                    </div>

                    <div className="rounded-2xl border border-[#e2eae5] p-4 sm:p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div><p className="font-bold">Mercado Livre</p><p className="mt-1 text-sm text-[#66736c]">Identificação do MLB ID e rastreamento da campanha.</p></div>
                        <Switch checked={affiliate.mercadoLivreEnabled} onCheckedChange={(mercadoLivreEnabled) => setAffiliate((value) => ({ ...value, mercadoLivreEnabled }))} aria-label="Ativar Mercado Livre" />
                      </div>
                      <label className="mt-4 block space-y-2 text-sm font-semibold">Etiqueta da campanha<Input value={affiliate.mercadoLivreLabel} onChange={(event) => setAffiliate((value) => ({ ...value, mercadoLivreLabel: event.target.value }))} placeholder="Ex.: promozap-whatsapp" className="h-12 rounded-xl" /></label>
                      <div className="mt-3 flex gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900"><CircleAlert className="mt-0.5 size-4 shrink-0" /><p>O Mercado Livre não usa um código simples na URL. O painel prepara o produto, mas o link precisa vir do Gerador oficial até existir uma integração autorizada.</p></div>
                    </div>

                    <label className="block space-y-2 text-sm font-semibold">Seu domínio de redirecionamento<Input value={affiliate.redirectDomain} onChange={(event) => setAffiliate((value) => ({ ...value, redirectDomain: event.target.value }))} placeholder="https://go.promozap.com.br" className="h-12 rounded-xl" /></label>
                    <Button onClick={() => void saveAffiliate()} disabled={saving} className="h-12 w-full rounded-xl bg-[#00c853] text-[#04140a] hover:bg-[#16dc61] sm:w-auto">{saving ? <LoaderCircle className="animate-spin" /> : <BadgeCheck />} Salvar afiliados</Button>
                  </CardContent>
                </Card>

                <Card className="h-fit border-[#dce7df] bg-[#071416] text-white shadow-[0_18px_50px_rgba(7,20,22,.16)]">
                  <CardHeader><CardTitle className="text-lg">Testar conversão</CardTitle><CardDescription className="text-white/55">Cole um link direto da Amazon para conferir.</CardDescription></CardHeader>
                  <CardContent className="space-y-4">
                    <Input value={testUrl} onChange={(event) => setTestUrl(event.target.value)} className="h-12 rounded-xl border-white/15 bg-white/8 text-white" />
                    <div className="min-h-24 rounded-xl border border-white/10 bg-white/6 p-4">
                      <p className="text-xs font-semibold text-white/45">RESULTADO</p>
                      <p className="mt-2 break-all text-sm leading-6 text-[#7cff94]">{convertedAmazonUrl || "Informe um ASIN válido e seu Tracking ID."}</p>
                    </div>
                    {convertedAmazonUrl && <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(convertedAmazonUrl); toast.success("Link copiado."); }} className="h-11 w-full border-white/15 bg-white/8 text-white hover:bg-white/14"><Copy /> Copiar resultado</Button>}
                  </CardContent>
                </Card>

              </div>
            </TabsContent>

            <TabsContent value="amazon" id="amazon">
              <div className="overflow-hidden rounded-2xl border border-[#4b3821] bg-[#111820] shadow-[0_18px_55px_rgba(0,0,0,.24)]">
                <div className="flex flex-col gap-4 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <div className="flex items-center gap-3">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#ff9900] text-[#111820]"><ShoppingBag className="size-5" /></div>
                    <div><h2 className="text-xl font-extrabold tracking-[-0.03em] text-white">Gerador Amazon</h2><p className="mt-1 text-sm text-[#b9c5cf]">Transforme links longos, páginas de produto e amzn.to em links de afiliado limpos.</p></div>
                  </div>
                  <div className={`flex w-fit items-center gap-2 rounded-full px-3 py-2 text-sm font-bold ${affiliate.amazonTrackingId && affiliate.amazonEnabled ? "bg-[#1f3f2d] text-[#8ff0ad]" : "bg-white/8 text-[#c5cbd0]"}`}>
                    <span className={`size-2 rounded-full ${affiliate.amazonTrackingId && affiliate.amazonEnabled ? "bg-[#53e27e]" : "bg-[#77818a]"}`} />
                    {affiliate.amazonTrackingId && affiliate.amazonEnabled ? `Tracking ID: ${affiliate.amazonTrackingId}` : "Tracking ID não configurado"}
                  </div>
                </div>
              </div>

              {amazonTestResult && (
                <Card className={`mt-5 overflow-hidden ${amazonTestResult.ok ? "border-[#6d4b1f] bg-[#15130f]" : "border-[#784235] bg-[#21110e]"}`}>
                  <CardHeader className="border-b border-white/8"><CardTitle className="text-lg">{amazonTestResult.ok ? "Links gerados" : "Não foi possível gerar"}</CardTitle><CardDescription>{amazonTestResult.message}</CardDescription></CardHeader>
                  <CardContent className="grid gap-3 pt-5 lg:grid-cols-2">
                    {amazonTestResult.results?.map((item, index) => (
                      <div key={`${item.originUrl}-${index}`} className="rounded-xl border border-white/10 bg-[#090d11] p-4">
                        <p className="break-all text-xs leading-5 text-[#84919b]">{item.originUrl}</p>
                        {item.ok && item.affiliateUrl ? (
                          <>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {item.asin && <Badge className="border border-[#80591f] bg-[#2c2112] text-[#ffbd59]">ASIN {item.asin}</Badge>}
                              {Boolean(item.redirectCount) && <Badge className="border border-[#35414b] bg-[#151c22] text-[#b9c5cf]">{item.redirectCount} redirecionamento(s)</Badge>}
                            </div>
                            {item.title && <p className="mt-3 line-clamp-2 text-sm font-semibold text-white">{item.title}</p>}
                            <a href={item.affiliateUrl} target="_blank" rel="noreferrer" className="mt-3 block break-all text-sm font-bold leading-6 text-[#ffb84d] underline underline-offset-2">{item.affiliateUrl}</a>
                            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                              <Button variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(item.affiliateUrl || ""); toast.success("Link copiado."); }} className="rounded-lg border-[#4a3a24] bg-[#211a11] text-white hover:bg-[#2d2316]"><Copy /> Copiar link</Button>
                              <Button asChild variant="outline" size="sm" className="rounded-lg border-[#35414b] bg-[#151c22] text-white hover:bg-[#202a32]"><a href={item.affiliateUrl} target="_blank" rel="noreferrer"><ExternalLink /> Abrir</a></Button>
                            </div>
                          </>
                        ) : <p className="mt-3 text-sm font-semibold text-[#ff9b92]">{item.message || "Link não reconhecido como Amazon Brasil."}</p>}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
                <Card className="border-[#dce7df] shadow-[0_10px_30px_rgba(7,20,22,.05)]">
                  <CardHeader><CardTitle className="flex items-center gap-2 text-xl"><Link2 className="size-5 text-[#ff9900]" /> Produtos para converter</CardTitle><CardDescription>Cole até 20 links da Amazon, um por linha. Links curtos são seguidos até o destino final.</CardDescription></CardHeader>
                  <CardContent className="space-y-4">
                    <Textarea value={amazonTestUrls} onChange={(event) => { setAmazonTestUrls(event.target.value); setAmazonTestResult(null); }} rows={8} spellCheck={false} placeholder="https://www.amazon.com.br/.../dp/B08LY1BKFT\nhttps://amzn.to/..." className="min-h-52 resize-y rounded-xl font-mono text-xs leading-5" />
                    <Button onClick={() => void testAmazonRequest()} disabled={amazonTestLoading} className="h-12 w-full rounded-xl bg-[#ff9900] font-bold text-[#111820] hover:bg-[#ffad33] sm:w-auto">{amazonTestLoading ? <LoaderCircle className="animate-spin" /> : <Link2 />} Gerar links da Amazon</Button>
                  </CardContent>
                </Card>

                <Card className="h-fit border-[#27322b] bg-[#0b100d] text-white shadow-none">
                  <CardHeader><CardTitle className="text-lg">Como o gerador trata o link</CardTitle><CardDescription>Você não precisa limpar a URL antes de colar.</CardDescription></CardHeader>
                  <CardContent className="space-y-4 text-sm leading-6 text-[#aab5ad]">
                    <div className="rounded-xl border border-[#3f3525] bg-[#17130d] p-4"><p className="font-bold text-[#ffb84d]">Produto identificado</p><p className="mt-1">Extrai o ASIN e cria <span className="break-all font-mono text-xs text-white">amazon.com.br/dp/ASIN?tag=SEU-ID</span>.</p></div>
                    <div className="rounded-xl border border-[#27322b] bg-[#080c09] p-4"><p className="font-bold text-white">Link encurtado</p><p className="mt-1">Segue os redirecionamentos de amzn.to e outros encurtadores até encontrar a Amazon.</p></div>
                    <div className="rounded-xl border border-[#27322b] bg-[#080c09] p-4"><p className="font-bold text-white">Página de serviço</p><p className="mt-1">Em links como Prime, preserva a página final e substitui o parâmetro <span className="font-mono text-xs">tag</span>.</p></div>
                    <Button onClick={() => setActiveTab("affiliates")} variant="outline" className="w-full rounded-xl border-[#4a3a24] bg-[#211a11] text-white hover:bg-[#2d2316]"><Settings2 /> Configurar Tracking ID</Button>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="mercadolivre" id="mercadolivre">
              <div className="overflow-hidden rounded-2xl border border-[#d5c300] bg-[#ffe600] shadow-[0_14px_40px_rgba(93,82,0,.14)]">
                <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <div className="flex items-center gap-3">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#231f00] text-[#ffe600]"><KeyRound className="size-5" /></div>
                    <div><h2 className="text-xl font-extrabold tracking-[-0.03em] text-[#231f00]">Gerador Mercado Livre</h2><p className="mt-1 text-sm text-[#655b00]">Converta links usando sua tag e sua sessão de afiliado.</p></div>
                  </div>
                  <div className={`flex w-fit items-center gap-2 rounded-full px-3 py-2 text-sm font-bold ${mlTestResult?.connected ? "bg-[#0b6b35] text-white" : "bg-[#231f00]/10 text-[#4c4500]"}`}>
                    <span className={`size-2 rounded-full ${mlTestResult?.connected ? "bg-[#62ef8b]" : "bg-[#8b800e]"}`} />
                    {mlTestResult?.connected ? "Sessão conectada" : mlSessionCookies ? "Sessão salva" : "Aguardando cookies"}
                  </div>
                </div>
              </div>

              {mlTestResult && (
                <Card className={`mt-5 overflow-hidden ${mlTestResult.ok ? "border-[#287a43] bg-[#0b1710]" : "border-[#784235] bg-[#21110e]"}`}>
                  <CardHeader className="border-b border-white/8"><CardTitle className="text-lg">{mlTestResult.ok ? "Links gerados" : `Não foi possível gerar${mlTestResult.upstreamStatus ? ` · HTTP ${mlTestResult.upstreamStatus}` : ""}`}</CardTitle><CardDescription>{mlTestResult.message}</CardDescription></CardHeader>
                  <CardContent className="grid gap-3 pt-5 md:grid-cols-2">
                    {mlTestResult.results?.map((item) => (
                      <div key={item.originUrl} className="rounded-xl border border-white/10 bg-[#080c09] p-4">
                        <p className="break-all text-xs leading-5 text-[#94a69b]">{item.originUrl}</p>
                        <a href={item.shortUrl} target="_blank" rel="noreferrer" className="mt-3 block break-all text-sm font-bold text-[#62ef8b] underline underline-offset-2">{item.shortUrl}</a>
                        <Button variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(item.longUrl || item.shortUrl); toast.success("Link copiado."); }} className="mt-4 rounded-lg border-[#2b3830] bg-[#111813] text-white hover:bg-[#19231c]"><Copy /> Copiar link completo</Button>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.72fr)]">
                <Card className="border-[#dce7df] shadow-[0_10px_30px_rgba(7,20,22,.05)]">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-xl"><Cookie className="size-5 text-[#008f3d]" /> Credenciais da sessão</CardTitle>
                    <CardDescription>A tag fica no painel e a sessão pode ser salva com criptografia para a automação.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <label className="block space-y-2 text-sm font-semibold">Tag de afiliado<Input value={affiliate.mercadoLivreLabel} onChange={(event) => setAffiliate((value) => ({ ...value, mercadoLivreLabel: event.target.value }))} placeholder="promozap" className="h-12 rounded-xl" /></label>
                    <label className="block space-y-2 text-sm font-semibold">
                      <span className="flex items-center justify-between gap-3"><span>Cookies da sessão</span><button type="button" onClick={() => setMlCookiesVisible((value) => !value)} className="flex items-center gap-1.5 text-xs font-semibold text-[#62ef8b] hover:underline">{mlCookiesVisible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}{mlCookiesVisible ? "Ocultar" : "Mostrar"}</button></span>
                      <Textarea value={mlSessionCookies} onChange={(event) => { setMlSessionCookies(event.target.value); setMlTestResult(null); }} rows={4} spellCheck={false} placeholder={'Cole aqui o JSON exportado: [{ "domain": "...", "name": "...", "value": "..." }]'} className={`min-h-28 max-h-40 resize-y rounded-xl border-[#34423a] bg-[#080c09] font-mono text-xs leading-5 ${mlCookiesVisible ? "text-white" : "text-transparent caret-white selection:bg-[#245f36]"}`} />
                    </label>
                    <div className="flex gap-2 rounded-xl border border-[#244c31] bg-[#0d1d12] p-3 text-sm leading-6 text-[#a7cbb2]"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#52e579]" /><p>Os cookies ficam criptografados no servidor. Quando o Mercado Livre devolver cookies renovados durante uma conversão, o painel os atualiza e salva automaticamente. Se a sessão for encerrada pelo Mercado Livre, será necessário exportar uma nova sessão.</p></div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button onClick={() => void saveAffiliate()} disabled={saving} variant="outline" className="h-11 rounded-xl border-[#2b3830] bg-[#111813] text-white hover:bg-[#19231c]">{saving ? <LoaderCircle className="animate-spin" /> : <BadgeCheck />} Salvar credenciais</Button>
                      {mlSessionCookies && <Button onClick={() => { setMlSessionCookies(""); setMlTestResult(null); }} variant="ghost" className="h-11 rounded-xl text-[#8b2e1b]">Limpar sessão</Button>}
                    </div>
                  </CardContent>
                </Card>

                <Card className="h-fit border-[#dce7df] bg-[#071416] text-white shadow-[0_18px_50px_rgba(7,20,22,.16)]">
                  <CardHeader><CardTitle className="text-xl">Produtos para converter</CardTitle><CardDescription className="text-white/55">Cole até 20 links, um em cada linha.</CardDescription></CardHeader>
                  <CardContent className="space-y-4">
                    <Textarea value={mlTestUrls} onChange={(event) => setMlTestUrls(event.target.value)} rows={7} placeholder="https://produto.mercadolivre.com.br/MLB-..." className="min-h-44 resize-y rounded-xl border-white/15 bg-white/8 text-white placeholder:text-white/35" />
                    <Button onClick={() => void testMercadoLivreRequest()} disabled={mlTestLoading} className="h-12 w-full rounded-xl bg-[#ffe600] font-bold text-[#231f00] hover:bg-[#fff05a]">{mlTestLoading ? <LoaderCircle className="animate-spin" /> : <Link2 />} Gerar links de afiliado</Button>
                    <Button asChild variant="outline" className="h-11 w-full rounded-xl border-white/15 bg-white/8 text-white hover:bg-white/14"><a href="https://www.mercadolivre.com.br/afiliados/linkbuilder#hub" target="_blank" rel="noreferrer"><ExternalLink /> Abrir gerador oficial</a></Button>
                  </CardContent>
                </Card>

              </div>
            </TabsContent>

            <TabsContent value="whatsapp" id="whatsapp">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                <Card className="overflow-hidden border-[#27322b] bg-[#0b100d] shadow-none">
                  <CardHeader className="border-b border-[#27322b] px-5 py-4">
                    <CardTitle className="flex items-center gap-2 text-base font-medium"><Smartphone className="size-4 text-[#62ef8b]" /> Credenciais UAZAPI</CardTitle>
                    <CardDescription>Conecte a instância que será usada para monitorar e publicar nos grupos.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5 p-5">
                    <label className="block space-y-2 text-sm font-medium">URL do servidor<Input value={whatsapp.serverUrl} onChange={(event) => setWhatsapp((value) => ({ ...value, serverUrl: event.target.value }))} placeholder="https://free.uazapi.com" className="h-11 rounded-lg border-[#34423a] bg-[#080c09]" /></label>
                    <label className="block space-y-2 text-sm font-medium">
                      <span className="flex items-center justify-between"><span>Instance Token</span><button type="button" onClick={() => setWhatsappTokenVisible((value) => !value)} className="flex items-center gap-1.5 text-xs text-[#62ef8b] hover:underline">{whatsappTokenVisible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}{whatsappTokenVisible ? "Ocultar" : "Mostrar"}</button></span>
                      <Input type={whatsappTokenVisible ? "text" : "password"} value={whatsapp.instanceToken} onChange={(event) => { setWhatsapp((value) => ({ ...value, instanceToken: event.target.value })); setWhatsappConnected(false); }} placeholder="Cole o token da instância" className="h-11 rounded-lg border-[#34423a] bg-[#080c09] font-mono text-sm" />
                    </label>
                    <div className="flex gap-2 rounded-xl border border-[#244c31] bg-[#0d1d12] p-3 text-sm leading-6 text-[#a7cbb2]"><ShieldCheck className="mt-1 size-4 shrink-0 text-[#52e579]" /><p>As credenciais ficam salvas automaticamente neste navegador e são enviadas somente à UAZAPI informada.</p></div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button onClick={() => void testWhatsappConnection()} disabled={whatsappTesting} className="h-11 rounded-lg bg-[#24c75a] px-5 text-[#04140a] hover:bg-[#46df75]">{whatsappTesting ? <LoaderCircle className="animate-spin" /> : <BadgeCheck />} Testar conexão</Button>
                      <Button onClick={() => void setupUazapiWebhook()} disabled={webhookSettingUp || (!whatsapp.instanceToken && !whatsappConnected)} variant="outline" className="h-11 rounded-lg border-[#2e7041] bg-[#112a19] text-[#8ef1aa] hover:bg-[#183b24]">{webhookSettingUp ? <LoaderCircle className="animate-spin" /> : <Webhook />} Ativar automação</Button>
                      {whatsapp.instanceToken && <Button onClick={() => { setWhatsapp(emptyWhatsApp); setWhatsappConnected(false); }} variant="outline" className="h-11 rounded-lg border-[#40302d] bg-[#17100e] text-[#ff9b92] hover:bg-[#211512]">Limpar credenciais</Button>}
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-4">
                  <Card className="border-[#27322b] bg-[#0b100d] shadow-none">
                    <CardHeader className="pb-3"><CardDescription>Status da conexão</CardDescription><CardTitle className="flex items-center gap-2 text-lg"><span className={`size-2.5 rounded-full ${whatsappConnected ? "bg-[#31d365] shadow-[0_0_0_5px_rgba(49,211,101,.12)]" : "bg-[#6f7771]"}`} />{whatsappConnected ? "Instância conectada" : "Aguardando teste"}</CardTitle></CardHeader>
                    <CardContent className="space-y-3 text-sm text-[#94a69b]"><div className="flex justify-between gap-3 border-t border-[#27322b] pt-3"><span>Servidor</span><span className="truncate text-right text-white">{whatsapp.serverUrl || "Não informado"}</span></div><div className="flex justify-between gap-3"><span>Grupos encontrados</span><span className="font-medium text-white">{whatsappConnected ? groups.length : "—"}</span></div><div className="flex justify-between gap-3"><span>Webhook</span><span className={webhookActive ? "font-semibold text-[#62ef8b]" : "text-[#c5a96b]"}>{webhookActive ? "Ativo" : "Aguardando ativação"}</span></div><div className="flex justify-between gap-3"><span>Salvamento</span><span className="text-[#62ef8b]">Automático</span></div></CardContent>
                  </Card>
                  <Card className="border-[#27322b] bg-[#0b100d] shadow-none"><CardHeader><CardTitle className="text-base">Próximo passo</CardTitle><CardDescription>Depois de conectar, abra “Grupos” para escolher as fontes, os destinos e as categorias.</CardDescription></CardHeader><CardContent><Button onClick={() => setActiveTab("groups")} variant="outline" className="w-full border-[#2b3830] bg-[#111813] text-white hover:bg-[#19231c]"><UsersRound /> Organizar grupos</Button></CardContent></Card>
                </div>
              </div>

              <Card className="mt-4 overflow-hidden border-[#27322b] bg-[#0b100d] shadow-none">
                <CardHeader className="border-b border-[#27322b] px-5 py-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div><CardTitle className="flex items-center gap-2 text-base font-medium"><MessageCircleMore className="size-4 text-[#62ef8b]" /> Botão de compra</CardTitle><CardDescription className="mt-1">A cada oferta, uma das frases ativas é escolhida aleatoriamente e recebe o link convertido.</CardDescription></div>
                    <label className="flex w-fit items-center gap-3 rounded-xl border border-[#2d4234] bg-[#0d1811] px-3 py-2 text-sm font-medium text-[#d7e5da]"><Switch checked={buttonSettings.enabled} onCheckedChange={(enabled) => setButtonSettings((current) => ({ ...current, enabled }))} />{buttonSettings.enabled ? "Ativado" : "Desativado"}</label>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {buttonSettings.labels.map((label, index) => (
                        <div key={`${label}-${index}`} className="flex items-center gap-2 rounded-full border border-[#35513e] bg-[#102018] py-1.5 pl-3 pr-1.5 text-sm font-semibold text-[#dff7e5]">
                          <span>{label}</span>
                          <button type="button" onClick={() => setButtonSettings((current) => ({ ...current, labels: current.labels.filter((_, itemIndex) => itemIndex !== index) }))} aria-label={`Remover ${label}`} className="grid size-6 place-items-center rounded-full text-[#93aa99] hover:bg-[#2b3b30] hover:text-white"><X className="size-3.5" /></button>
                        </div>
                      ))}
                      {buttonSettings.labels.length === 0 && <p className="text-sm text-[#849188]">Nenhuma frase cadastrada.</p>}
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input value={buttonDraft} onChange={(event) => setButtonDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addButtonLabel(); } }} maxLength={25} placeholder="Ex.: GARANTIR DESCONTO" className="h-11 rounded-lg border-[#34423a] bg-[#080c09]" />
                      <Button onClick={addButtonLabel} type="button" variant="outline" className="h-11 shrink-0 rounded-lg border-[#2e7041] bg-[#112a19] text-[#8ef1aa] hover:bg-[#183b24]"><Plus /> Adicionar</Button>
                    </div>
                    <p className="text-xs leading-5 text-[#7f9085]">Até 8 opções, com no máximo 25 caracteres. O link também continua no texto da mensagem como segurança.</p>
                    <Button onClick={() => void saveButtonSettings()} disabled={buttonSettingsSaving} className="h-11 rounded-lg bg-[#24c75a] px-5 font-semibold text-[#04140a] hover:bg-[#46df75]">{buttonSettingsSaving ? <LoaderCircle className="animate-spin" /> : <BadgeCheck />} Salvar botões</Button>
                  </div>
                  <div className="rounded-2xl border border-[#26372d] bg-[#07100a] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6f8376]">Prévia no WhatsApp</p>
                    <div className="mt-4 rounded-xl bg-[#0b2014] p-3 text-sm leading-6 text-[#e7f1e9] shadow-inner">🔥 Oferta encontrada<br />Link convertido pronto para comprar.</div>
                    <div className="mt-2 grid min-h-11 place-items-center rounded-xl border border-[#275e37] bg-[#102b19] px-3 text-center text-sm font-bold text-[#67ed8b]">
                      {buttonSettings.labels[0] || "COMPRAR AGORA"}
                    </div>
                    <p className="mt-3 text-center text-xs text-[#718078]">A frase muda aleatoriamente entre as opções cadastradas.</p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="automation" id="automacao">
              <Card className="border-[#dce7df] shadow-[0_10px_30px_rgba(7,20,22,.05)]">
                <CardHeader><CardTitle className="text-xl">Fluxo de automação</CardTitle><CardDescription>Visão do que acontecerá com cada mensagem recebida.</CardDescription></CardHeader>
                <CardContent>
                  <div className="grid gap-3 md:grid-cols-4">
                    {[
                      ["1", "Capturar", "Receber ofertas dos grupos marcados como fonte."],
                      ["2", "Validar", "Encontrar Amazon ou Mercado Livre e evitar duplicados."],
                      ["3", "Converter", "Aplicar seu link e montar o texto Promozap."],
                      ["4", "Publicar", "Enviar para o grupo escolhido na categoria."],
                    ].map(([step, title, description]) => (
                      <div key={step} className="relative rounded-2xl border border-[#e2eae5] bg-[#f8fbf9] p-4">
                        <span className="mb-6 flex size-8 items-center justify-center rounded-lg bg-[#071416] text-sm font-bold text-[#25e83f]">{step}</span>
                        <p className="font-bold">{title}</p><p className="mt-2 text-sm leading-6 text-[#66736c]">{description}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-[#bfe9cc] bg-[#ebfaef] p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex gap-3"><Webhook className="mt-0.5 size-5 text-[#008f3d]" /><div><p className="font-bold">Envio automático pela UAZAPI</p><p className="mt-1 text-sm text-[#52705d]">Mensagens dos grupos-fonte são convertidas e enviadas ao destino configurado.</p></div></div>
                    <Button onClick={() => void setupUazapiWebhook()} disabled={webhookSettingUp} variant="outline" className="h-11 rounded-xl border-[#91d7a8] bg-white text-[#102016]">{webhookSettingUp ? <LoaderCircle className="animate-spin" /> : <Webhook />} {webhookActive ? "Reativar webhook" : "Ativar webhook"}</Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="mt-5 overflow-hidden border-[#27322b] bg-[#080c09] text-white shadow-none">
                <CardHeader className="grid gap-3 border-b border-[#27322b] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div><CardTitle className="flex items-center gap-2 text-lg"><ScrollText className="size-5 text-[#62ef8b]" /> Log provisório da UAZAPI</CardTitle><CardDescription className="mt-1 text-[#94a69b]">Atualiza automaticamente a cada seis segundos.</CardDescription></div>
                  <Button onClick={() => void loadAutomationLogs()} disabled={logsLoading} variant="outline" className="h-10 rounded-lg border-[#34423a] bg-[#111813] text-white hover:bg-[#19231c]"><RefreshCw className={logsLoading ? "animate-spin" : ""} /> Atualizar</Button>
                </CardHeader>
                <CardContent className="max-h-[520px] space-y-2 overflow-y-auto p-3 sm:p-4">
                  {logsLoading && automationLogs.length === 0 ? (
                    <div className="flex min-h-40 items-center justify-center gap-3 text-sm text-[#94a69b]"><LoaderCircle className="size-5 animate-spin text-[#62ef8b]" /> Carregando eventos...</div>
                  ) : automationLogs.length === 0 ? (
                    <div className="flex min-h-40 flex-col items-center justify-center text-center"><ScrollText className="mb-3 size-8 text-[#536158]" /><p className="font-semibold">Nenhum evento recebido ainda</p><p className="mt-1 text-sm text-[#94a69b]">Ative o webhook e envie um link em um grupo-fonte.</p></div>
                  ) : automationLogs.map((entry) => (
                    <div key={entry.id} className="grid gap-2 rounded-xl border border-[#27322b] bg-[#0d1310] p-3 sm:grid-cols-[116px_minmax(0,1fr)_auto] sm:items-start">
                      <span className={`w-fit rounded-full border px-2 py-1 text-xs font-bold ${entry.level === "success" ? "border-[#2d7543] bg-[#12301c] text-[#7cf399]" : entry.level === "error" ? "border-[#784235] bg-[#2a1612] text-[#ff9b92]" : entry.level === "warning" ? "border-[#6e5d25] bg-[#29220b] text-[#f0d274]" : "border-[#3b4b41] bg-[#18201b] text-[#b8c6bc]"}`}>{entry.stage}</span>
                      <div className="min-w-0"><p className="text-sm font-medium leading-6 text-[#eef6f0]">{entry.message}</p>{entry.groupJid && <p className="mt-1 truncate text-xs text-[#7f9085]">Grupo: {entry.groupJid}</p>}</div>
                      <time className="text-xs text-[#738078]">{new Date(entry.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </section>
      </div>
      </div>
    </main>
  );
}
