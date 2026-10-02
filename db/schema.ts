import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const groupConfigs = sqliteTable("group_configs", {
  jid: text("jid").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull().default("ignored"),
  category: text("category").notNull().default("geral"),
  destinationJid: text("destination_jid"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull(),
});

export const affiliateSettings = sqliteTable("affiliate_settings", {
  id: integer("id").primaryKey(),
  amazonTrackingId: text("amazon_tracking_id").notNull().default(""),
  mercadoLivreLabel: text("mercado_livre_label").notNull().default(""),
  redirectDomain: text("redirect_domain").notNull().default(""),
  amazonEnabled: integer("amazon_enabled", { mode: "boolean" }).notNull().default(true),
  mercadoLivreEnabled: integer("mercado_livre_enabled", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull(),
});

export const productEvents = sqliteTable("product_events", {
  id: text("id").primaryKey(),
  fingerprint: text("fingerprint").notNull().unique(),
  store: text("store").notNull().default("unknown"),
  productCode: text("product_code"),
  title: text("title"),
  imageUrl: text("image_url"),
  productDataJson: text("product_data_json"),
  dataSource: text("data_source"),
  sourceUrl: text("source_url").notNull(),
  resolvedUrl: text("resolved_url"),
  affiliateUrl: text("affiliate_url"),
  status: text("status").notNull().default("found"),
  sourceGroup: text("source_group"),
  destinationGroup: text("destination_group"),
  messageExcerpt: text("message_excerpt"),
  redirectCount: integer("redirect_count").notNull().default(0),
  occurrences: integer("occurrences").notNull().default(1),
  errorMessage: text("error_message"),
  foundAt: text("found_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  sentAt: text("sent_at"),
  updatedAt: text("updated_at").notNull(),
});

export const processedMessages = sqliteTable("processed_messages", {
  messageId: text("message_id").primaryKey(),
  groupJid: text("group_jid"),
  status: text("status").notNull().default("processing"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const automationLogs = sqliteTable("automation_logs", {
  id: text("id").primaryKey(),
  level: text("level").notNull().default("info"),
  stage: text("stage").notNull(),
  message: text("message").notNull(),
  detailsJson: text("details_json"),
  groupJid: text("group_jid"),
  productId: text("product_id"),
  createdAt: text("created_at").notNull(),
});
