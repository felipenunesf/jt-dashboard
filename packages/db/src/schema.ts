import { sql } from 'drizzle-orm';
import {
  bigserial,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ============================================================================
// 1. meta_ads — Catálogo Meta denormalizado
// ============================================================================
export const metaAds = pgTable(
  'meta_ads',
  {
    adId: text('ad_id').primaryKey(),
    adName: text('ad_name'),
    adsetId: text('adset_id'),
    adsetName: text('adset_name'),
    campaignId: text('campaign_id'),
    campaignName: text('campaign_name'),
    accountId: text('account_id'),
    status: text('status'),
    destinationType: text('destination_type'), // 'whatsapp' | 'website'
    thumbnailUrl: text('thumbnail_url'),
    permalinkUrl: text('permalink_url'),
    pixelId: text('pixel_id'),
    pageId: text('page_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    campaignIdx: index('meta_ads_campaign_idx').on(t.campaignId),
    adsetIdx: index('meta_ads_adset_idx').on(t.adsetId),
    statusIdx: index('meta_ads_status_idx').on(t.status),
  }),
);

// ============================================================================
// 2. insights_daily — Métricas diárias por anúncio
// ============================================================================
export const insightsDaily = pgTable(
  'insights_daily',
  {
    adId: text('ad_id')
      .notNull()
      .references(() => metaAds.adId, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    spend: numeric('spend', { precision: 12, scale: 2 }),
    impressions: integer('impressions'),
    reach: integer('reach'),
    clicks: integer('clicks'), // inline_link_clicks
    uniqueClicks: integer('unique_clicks'),
    ctr: numeric('ctr', { precision: 8, scale: 4 }),
    cpc: numeric('cpc', { precision: 10, scale: 4 }),
    frequency: numeric('frequency', { precision: 8, scale: 4 }),
    messagingStarted: integer('messaging_started'), // onsite_conversion.messaging_conversation_started_7d
    landingPageViews: integer('landing_page_views'),
    raw: jsonb('raw'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: uniqueIndex('insights_daily_pk').on(t.adId, t.date),
    dateIdx: index('insights_daily_date_idx').on(t.date),
  }),
);

// ============================================================================
// 3. leads — Tabela unificada (WhatsApp + Site GHL)
// ============================================================================
export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    source: text('source').notNull(), // 'whatsapp' | 'site_ghl'

    // Contato
    name: text('name'),
    phone: text('phone'),
    email: text('email'),
    phoneHash: text('phone_hash'),
    emailHash: text('email_hash'),

    // Atribuição Meta
    adId: text('ad_id').references(() => metaAds.adId, { onDelete: 'set null' }),
    ctwaClid: text('ctwa_clid'),
    fbclid: text('fbclid'),
    fbp: text('fbp'),
    sourceUrl: text('source_url'),
    ctaHeadline: text('cta_headline'),
    attributionMethod: text('attribution_method'), // 'ctwa_clid' | 'welcome_message' | 'fbclid' | 'none'

    // WhatsApp
    waInstance: text('wa_instance'),

    // GHL
    ghlOpportunityId: text('ghl_opportunity_id'),
    ghlContactId: text('ghl_contact_id'),
    ghlPipelineId: text('ghl_pipeline_id'),
    ghlStageId: text('ghl_stage_id'),

    // Status
    status: text('status').default('opened').notNull(), // 'opened' | 'qualified' | 'purchased' | 'lost'
    qualifiedAt: timestamp('qualified_at', { withTimezone: true }),
    purchasedAt: timestamp('purchased_at', { withTimezone: true }),
    purchaseValue: numeric('purchase_value', { precision: 12, scale: 2 }),
    purchaseCurrency: text('purchase_currency').default('BRL'),

    // Meta
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    raw: jsonb('raw'),
  },
  (t) => ({
    waUnique: uniqueIndex('leads_wa_unique')
      .on(t.waInstance, t.phone)
      .where(sql`source = 'whatsapp'`),
    ghlUnique: uniqueIndex('leads_ghl_unique')
      .on(t.ghlOpportunityId)
      .where(sql`source = 'site_ghl'`),
    adIdx: index('leads_ad_idx').on(t.adId),
    statusIdx: index('leads_status_idx').on(t.status),
    firstSeenIdx: index('leads_first_seen_idx').on(t.firstSeenAt),
  }),
);

// ============================================================================
// 4. messages — Mensagens WhatsApp
// ============================================================================
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    waMessageId: text('wa_message_id').notNull().unique(),
    direction: text('direction'), // 'inbound' | 'outbound'
    text: text('text'),
    classification: text('classification'), // null | 'qualifier_match' | 'purchase_match'
    receivedAt: timestamp('received_at', { withTimezone: true }),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    leadReceivedIdx: index('messages_lead_received_idx').on(t.leadId, t.receivedAt),
  }),
);

// ============================================================================
// 5. capi_events — Auditoria + dedup CAPI
// ============================================================================
export const capiEvents = pgTable(
  'capi_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    eventId: text('event_id').notNull().unique(), // hash determinístico
    eventName: text('event_name').notNull(), // 'Lead' | 'QualifiedLead' | 'Purchase'
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    adId: text('ad_id'),
    pixelId: text('pixel_id'),
    payload: jsonb('payload'),
    metaResponse: jsonb('meta_response'),
    status: text('status').default('pending').notNull(), // 'pending'|'sent'|'failed'|'duplicated'
    attempts: integer('attempts').default(0).notNull(),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    statusIdx: index('capi_events_status_idx').on(t.status),
    leadIdx: index('capi_events_lead_idx').on(t.leadId),
    createdIdx: index('capi_events_created_idx').on(t.createdAt),
  }),
);

// ============================================================================
// 6. webhook_inbox — Safety net pra reprocessamento
// ============================================================================
export const webhookInbox = pgTable(
  'webhook_inbox',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    source: text('source').notNull(), // 'zapi' | 'ghl'
    rawBody: jsonb('raw_body'),
    headers: jsonb('headers'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    sourceProcessedIdx: index('webhook_inbox_source_processed_idx').on(t.source, t.processedAt),
    receivedIdx: index('webhook_inbox_received_idx').on(t.receivedAt),
  }),
);

// ============================================================================
// 7. settings — KV editável
// ============================================================================
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ============================================================================
// Tipos exportados (inferidos)
// ============================================================================
export type MetaAd = typeof metaAds.$inferSelect;
export type NewMetaAd = typeof metaAds.$inferInsert;

export type InsightDaily = typeof insightsDaily.$inferSelect;
export type NewInsightDaily = typeof insightsDaily.$inferInsert;

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type CapiEvent = typeof capiEvents.$inferSelect;
export type NewCapiEvent = typeof capiEvents.$inferInsert;

export type WebhookInboxRow = typeof webhookInbox.$inferSelect;
export type NewWebhookInboxRow = typeof webhookInbox.$inferInsert;

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
