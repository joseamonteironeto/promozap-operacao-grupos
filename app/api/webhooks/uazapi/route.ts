import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { automationLog } from "@/lib/automation-log";
import { extractUrls } from "@/lib/link-resolver";
import { markProductsSent, processProductInput } from "@/lib/product-pipeline";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function recordLike(value: unknown): UnknownRecord {
  if (typeof value !== "string") return record(value);
  try { return record(JSON.parse(value)); } catch { return {}; }
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() || "";
}

function extractMessage(payload: UnknownRecord) {
  const data = record(payload.data);
  const message = record(data.message || payload.message || data);
  const key = record(message.key);
  const chat = record(data.chat || message.chat || payload.chat);
  const content = recordLike(message.message || message.content);
  const extended = record(content.extendedTextMessage);
  const image = record(content.imageMessage);
  const video = record(content.videoMessage);
  const document = record(content.documentMessage);
  const text = firstString(
    message.text, message.body, message.caption, content.conversation, extended.text,
    image.caption, video.caption, document.caption, data.text, payload.text,
  );
  const chatJid = firstString(
    message.chatid, message.chatId, message.remoteJid, key.remoteJid,
    data.chatid, data.chatId, data.remoteJid, chat.wa_chatid, chat.JID, payload.chatid,
  );
  const messageType = firstString(message.messageType, message.type, data.messageType);
  const mimetype = firstString(message.mimetype, image.mimetype, content.mimetype);
  const isImage = /image/i.test(messageType) || mimetype.toLowerCase().startsWith("image/") || Object.keys(image).length > 0;
  const thumbnail = firstString(image.JPEGThumbnail, image.jpegThumbnail, content.JPEGThumbnail, content.jpegThumbnail);
  return {
    text,
    chatJid,
    messageId: firstString(message.messageid, message.messageId, message.id, key.id, data.messageid, data.id, payload.id) || crypto.randomUUID(),
    downloadId: firstString(message.id, message.messageid, message.messageId, key.id, data.id, data.messageid),
    alternateDownloadId: firstString(message.messageid, message.messageId, message.id, key.id),
    messageType,
    mimetype,
    isImage,
    mediaUrl: firstString(message.fileURL, message.fileUrl, data.fileURL, data.fileUrl, content.fileURL, content.fileUrl, image.url),
    thumbnail,
    fromMe: Boolean(message.fromMe ?? key.fromMe ?? data.fromMe),
    wasSentByApi: Boolean(message.wasSentByApi ?? data.wasSentByApi),
  };
}

async function claimMessage(messageId: string, groupJid: string) {
  if (!env.DB) return false;
  const existing = await env.DB.prepare("SELECT status FROM processed_messages WHERE message_id = ?").bind(messageId).first<{ status: string }>();
  if (existing?.status === "sent" || existing?.status === "processing") return false;
  const now = new Date().toISOString();
  if (existing) {
    await env.DB.prepare("UPDATE processed_messages SET status = 'processing', error_message = NULL, group_jid = ?, updated_at = ? WHERE message_id = ?")
      .bind(groupJid || null, now, messageId).run();
    return true;
  }
  await env.DB.prepare(`
    INSERT INTO processed_messages (message_id, group_jid, status, error_message, created_at, updated_at)
    VALUES (?, ?, 'processing', NULL, ?, ?)
  `).bind(messageId, groupJid || null, now, now).run();
  return true;
}

async function finishMessage(messageId: string, status: string, errorMessage?: string) {
  if (!env.DB) return;
  await env.DB.prepare("UPDATE processed_messages SET status = ?, error_message = ?, updated_at = ? WHERE message_id = ?")
    .bind(status, errorMessage || null, new Date().toISOString(), messageId).run();
}

function replaceConvertedLinks(message: string, products: Awaited<ReturnType<typeof processProductInput>>) {
  let output = message;
  for (const product of products) {
    if (product.affiliateUrl) output = output.split(product.sourceUrl).join(product.affiliateUrl);
  }
  return output;
}

function trustedCatalogImage(store: string | undefined, imageUrl: string | null | undefined) {
  if (!imageUrl) return null;
  try {
    const url = new URL(imageUrl);
    if (url.protocol !== "https:") return null;
    const hostname = url.hostname.toLowerCase();
    const trusted = store === "mercadolivre"
      ? hostname === "mlstatic.com" || hostname.endsWith(".mlstatic.com") || hostname === "mercadolivre.com.br" || hostname.endsWith(".mercadolivre.com.br")
      : store === "amazon"
        ? hostname === "media-amazon.com" || hostname.endsWith(".media-amazon.com") || hostname === "ssl-images-amazon.com" || hostname.endsWith(".ssl-images-amazon.com")
        : false;
    if (!trusted) return null;
    if (store === "mercadolivre" && url.pathname.toLowerCase().endsWith(".webp")) {
      url.pathname = url.pathname.replace(/\.webp$/i, ".jpg");
    }
    const extension = url.pathname.toLowerCase();
    return {
      file: url.toString(),
      mimetype: extension.endsWith(".webp") ? "image/webp" : extension.endsWith(".png") ? "image/png" : "image/jpeg",
      source: store === "amazon" ? "amazon_catalog_cache" : "mercadolivre_catalog_cache",
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const runtime = env as unknown as {
    PROMOZAP_WEBHOOK_SECRET?: string;
    UAZAPI_SERVER_URL?: string;
    UAZAPI_INSTANCE_TOKEN?: string;
  };
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!runtime.PROMOZAP_WEBHOOK_SECRET || key !== runtime.PROMOZAP_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!env.DB) return NextResponse.json({ ok: false, message: "Banco indisponível." }, { status: 503 });

  const payload = await request.json().catch(() => ({})) as UnknownRecord;
  const event = firstString(payload.EventType, payload.event, new URL(request.url).searchParams.get("event"));
  const extracted = extractMessage(payload);
  await automationLog({
    stage: "webhook_received",
    message: `Evento ${event || "sem nome"} recebido da UAZAPI.`,
    groupJid: extracted.chatJid,
    details: {
      event,
      messageId: extracted.messageId,
      messageType: extracted.messageType,
      hasText: Boolean(extracted.text),
      hasImage: extracted.isImage,
      hasLinkPreview: !extracted.isImage && extracted.thumbnail.length > 100,
      imageKind: extracted.isImage ? "attachment" : null,
      hasMediaUrl: Boolean(extracted.mediaUrl),
      urlCount: extractUrls(extracted.text).length,
    },
  });

  if (event && event !== "messages") return NextResponse.json({ ok: true, ignored: "event" });
  if (!extracted.chatJid.endsWith("@g.us")) {
    await automationLog({ stage: "ignored", message: "Mensagem ignorada porque não veio de um grupo.", groupJid: extracted.chatJid });
    return NextResponse.json({ ok: true, ignored: "not_group" });
  }
  if (extracted.fromMe || extracted.wasSentByApi) {
    await automationLog({ stage: "ignored", message: "Mensagem enviada pela própria instância; loop evitado.", groupJid: extracted.chatJid });
    return NextResponse.json({ ok: true, ignored: "own_message" });
  }
  if (!extracted.text || !extractUrls(extracted.text).length) {
    await automationLog({ stage: "ignored", message: "Mensagem sem links; nenhuma ação necessária.", groupJid: extracted.chatJid });
    return NextResponse.json({ ok: true, ignored: "no_links" });
  }
  if (!(await claimMessage(extracted.messageId, extracted.chatJid))) {
    await automationLog({ stage: "deduplicated", message: "Evento repetido ignorado.", groupJid: extracted.chatJid, details: { messageId: extracted.messageId } });
    return NextResponse.json({ ok: true, ignored: "duplicate" });
  }

  try {
    const route = await env.DB.prepare(`
      SELECT jid, name, category, destination_jid AS destinationJid
      FROM group_configs WHERE jid = ? AND role = 'source' AND enabled = 1
    `).bind(extracted.chatJid).first<{ jid: string; name: string; category: string; destinationJid: string | null }>();
    if (!route) {
      await finishMessage(extracted.messageId, "ignored", "Grupo não configurado como fonte.");
      await automationLog({ level: "warning", stage: "route", message: "Grupo recebido não está ativo como fonte.", groupJid: extracted.chatJid });
      return NextResponse.json({ ok: true, ignored: "source_not_configured" });
    }
    if (!route.destinationJid) {
      await finishMessage(extracted.messageId, "error", "Grupo de destino não configurado.");
      await automationLog({ level: "error", stage: "route", message: "A fonte não possui grupo de destino configurado.", groupJid: extracted.chatJid });
      return NextResponse.json({ ok: false, message: "Destino não configurado." }, { status: 422 });
    }

    const serverUrl = runtime.UAZAPI_SERVER_URL?.replace(/\/$/, "") || "";
    const token = runtime.UAZAPI_INSTANCE_TOKEN || "";
    if (!serverUrl || !token) throw new Error("Credenciais UAZAPI não configuradas no servidor.");
    if (extracted.isImage) {
      await automationLog({
        stage: "media_ignored",
        message: "A imagem recebida do grupo foi ignorada; será usada somente a imagem oficial do produto.",
        groupJid: extracted.chatJid,
        details: { messageId: extracted.messageId, messageType: extracted.messageType },
      });
    }
    const products = await processProductInput({
      message: extracted.text,
      sourceGroup: route.name || route.jid,
      destinationGroup: route.destinationJid,
    });
    const converted = products.filter((product) => product.status === "converted" && product.affiliateUrl);
    await automationLog({
      level: converted.length ? "success" : "warning",
      stage: "conversion",
      message: converted.length ? `${converted.length} link(s) convertido(s).` : "Nenhum link pôde ser convertido.",
      groupJid: extracted.chatJid,
      details: { products: products.map((item) => ({ id: item.id, store: item.store, status: item.status, code: item.productCode })) },
    });
    if (!converted.length) {
      await finishMessage(extracted.messageId, "not_converted", products.map((item) => item.errorMessage).filter(Boolean).join(" | "));
      return NextResponse.json({ ok: true, converted: 0, sent: false });
    }

    const outgoingText = replaceConvertedLinks(extracted.text, products).slice(0, 4096);
    const primaryProduct = converted[0];
    const officialProductImage = trustedCatalogImage(primaryProduct?.store, primaryProduct?.imageUrl);
    const outgoingImage = officialProductImage;
    if (officialProductImage) {
      const storeName = primaryProduct.store === "amazon" ? "Amazon" : "Mercado Livre";
      await automationLog({
        level: "success",
        stage: "product_image",
        message: `Imagem oficial da ${storeName} encontrada para ${primaryProduct.productCode}.`,
        groupJid: extracted.chatJid,
        productId: primaryProduct.id,
        details: { productCode: primaryProduct.productCode, imageUrl: primaryProduct.imageUrl, mediaSource: officialProductImage.source, ignoredIncomingImage: extracted.isImage },
      });
    }
    if (!officialProductImage) {
      await automationLog({
        level: "warning",
        stage: "media",
        message: "A loja não disponibilizou uma imagem oficial; a oferta será enviada apenas como texto.",
        groupJid: extracted.chatJid,
        details: { messageId: extracted.messageId, productCode: primaryProduct.productCode },
      });
    }
    const fallbackEndpoint = outgoingImage ? "/send/media" : "/send/text";
    const fallbackBody = outgoingImage ? {
      number: route.destinationJid,
      type: "image",
      file: outgoingImage.file,
      text: outgoingText,
      mimetype: outgoingImage.mimetype,
      async: true,
      track_source: "promozap",
      track_id: extracted.messageId,
    } : {
      number: route.destinationJid,
      text: outgoingText,
      linkPreview: true,
      async: true,
      track_source: "promozap",
      track_id: extracted.messageId,
    };
    const response = await fetch(`${serverUrl}${fallbackEndpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify(fallbackBody),
      signal: AbortSignal.timeout(20_000),
    });
    const providerResponse = await response.text();
    if (!response.ok) throw new Error(`UAZAPI respondeu HTTP ${response.status}: ${providerResponse.slice(0, 300)}`);

    await markProductsSent(converted.map((product) => product.id), route.destinationJid);
    await finishMessage(extracted.messageId, "sent");
    await automationLog({
      level: "success",
      stage: "sent",
      message: `Oferta enviada ao grupo de destino (${converted.length} produto(s))${officialProductImage ? ` com a foto oficial da ${primaryProduct.store === "amazon" ? "Amazon" : "Mercado Livre"}` : " sem foto"}.`,
      groupJid: route.destinationJid,
      details: {
        sourceGroup: extracted.chatJid,
        destinationGroup: route.destinationJid,
        providerStatus: response.status,
        messageId: extracted.messageId,
        imageForwarded: Boolean(outgoingImage),
        mediaSource: outgoingImage?.source || null,
        incomingImageIgnored: extracted.isImage,
        buttonSent: false,
        messageFormat: outgoingImage ? "normal_image_with_caption" : "normal_text",
      },
    });
    return NextResponse.json({ ok: true, converted: converted.length, sent: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido no processamento.";
    await finishMessage(extracted.messageId, "error", message);
    await automationLog({ level: "error", stage: "processing", message, groupJid: extracted.chatJid, details: { messageId: extracted.messageId } });
    return NextResponse.json({ ok: false, message: "A mensagem foi registrada, mas o envio falhou." }, { status: 500 });
  }
}
