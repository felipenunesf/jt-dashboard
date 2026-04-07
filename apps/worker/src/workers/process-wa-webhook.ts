import {
  db,
  leads,
  messages,
  metaAds,
  webhookInbox,
  type NewLead,
  type NewMessage,
} from '@jt/db';
import { and, eq, sql } from 'drizzle-orm';
import { logger } from '../lib/logger.js';
import { hashEmail, hashPhone, normalizePhone } from '../lib/crypto.js';
import { normalizeZApiMessage, type NormalizedMessage } from '../services/zapi-adapter.js';
import { classify, resolveAdByWelcomeMessage } from '../services/classifier.js';
import { loadAllSettings, type AllSettings } from '../services/settings.js';
import type { CapiEventName } from '../services/meta-capi.js';

const log = logger.child({ module: 'process-wa-webhook' });

export interface ProcessWaJobData {
  inboxId: number;
}

export interface ProcessWaJobResult {
  status: 'processed' | 'duplicated' | 'invalid' | 'no_text' | 'error';
  leadId?: string;
  messageId?: string;
  classification?: string;
  capiEnqueued?: CapiEventName[];
}

// ============================================================================
// CAPI enqueuer (injected pelo scheduler para evitar circular dep)
// ============================================================================

export interface CapiEnqueueJob {
  leadId: string;
  eventName: CapiEventName;
  triggerId: string;
}

let capiEnqueuer: ((data: CapiEnqueueJob) => Promise<void>) | null = null;

export function setCapiEnqueuer(fn: (data: CapiEnqueueJob) => Promise<void>) {
  capiEnqueuer = fn;
}

async function enqueueCapi(data: CapiEnqueueJob): Promise<void> {
  if (!capiEnqueuer) {
    log.warn({ data }, 'capi enqueuer not set, event dropped');
    return;
  }
  try {
    await capiEnqueuer(data);
  } catch (err) {
    log.error({ err: (err as Error).message, data }, 'failed to enqueue capi event');
  }
}

/**
 * Cache de settings em memória do worker (refresh manual quando precisar).
 * Em produção, refresh on signal ou polling baixo.
 */
let cachedSettings: AllSettings | null = null;
let cachedAt = 0;
const SETTINGS_TTL_MS = 60_000; // 1 min

async function getCachedSettings(): Promise<AllSettings> {
  const now = Date.now();
  if (!cachedSettings || now - cachedAt > SETTINGS_TTL_MS) {
    cachedSettings = await loadAllSettings();
    cachedAt = now;
  }
  return cachedSettings;
}

export async function processWaWebhook(
  data: ProcessWaJobData,
): Promise<ProcessWaJobResult> {
  const { inboxId } = data;
  const inboxRow = await db
    .select()
    .from(webhookInbox)
    .where(eq(webhookInbox.id, inboxId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!inboxRow) {
    log.warn({ inboxId }, 'webhook_inbox row not found');
    return { status: 'error' };
  }

  if (inboxRow.processedAt) {
    log.debug({ inboxId }, 'already processed, skipping');
    return { status: 'duplicated' };
  }

  // Instance vem dos headers (definido no Fastify route handler)
  const headers = (inboxRow.headers ?? {}) as Record<string, unknown>;
  const fallbackInstance =
    typeof headers['x-jt-instance'] === 'string' ? headers['x-jt-instance'] : 'default';

  const normalized = normalizeZApiMessage(inboxRow.rawBody, fallbackInstance);
  if (!normalized) {
    log.warn({ inboxId, headers }, 'failed to normalize payload');
    await markProcessed(inboxId, 'normalize_failed');
    return { status: 'invalid' };
  }

  if (!normalized.text) {
    log.debug({ inboxId, messageId: normalized.messageId }, 'message has no text');
    await markProcessed(inboxId);
    return { status: 'no_text' };
  }

  // Idempotência: já processamos esta wa_message_id?
  const existingMessage = await db
    .select({ id: messages.id, leadId: messages.leadId })
    .from(messages)
    .where(eq(messages.waMessageId, normalized.messageId))
    .limit(1);
  if (existingMessage[0]) {
    log.debug({ messageId: normalized.messageId }, 'message already exists');
    await markProcessed(inboxId);
    return {
      status: 'duplicated',
      leadId: existingMessage[0].leadId,
      messageId: existingMessage[0].id,
    };
  }

  const settings = await getCachedSettings();
  const lead = await upsertLead(normalized, settings);
  const messageRow = await insertMessage(normalized, lead.id, settings);

  // ===== CAPI events =====
  const capiEnqueued: CapiEventName[] = [];

  // 1. Lead novo entra → Contact (usa wa_message_id da 1ª mensagem como triggerId)
  if (lead.isNew) {
    await enqueueCapi({
      leadId: lead.id,
      eventName: 'Contact',
      triggerId: normalized.messageId,
    });
    capiEnqueued.push('Contact');
  }

  // 2. Qualificou → Lead + CompleteRegistration (mesmo trigger, dois eventos)
  if (messageRow.classification === 'qualifier_match') {
    await enqueueCapi({
      leadId: lead.id,
      eventName: 'Lead',
      triggerId: normalized.messageId,
    });
    await enqueueCapi({
      leadId: lead.id,
      eventName: 'CompleteRegistration',
      triggerId: normalized.messageId,
    });
    capiEnqueued.push('Lead', 'CompleteRegistration');
  }

  // 3. Comprou → Purchase
  if (messageRow.classification === 'purchase_match') {
    // Se a mesma mensagem dispara purchase sem ter qualificado antes,
    // também enviamos Lead+CompleteRegistration (lifecycle completo)
    const wasAlreadyQualified =
      lead.previousStatus === 'qualified' || lead.previousStatus === 'purchased';
    if (!wasAlreadyQualified) {
      await enqueueCapi({
        leadId: lead.id,
        eventName: 'Lead',
        triggerId: normalized.messageId,
      });
      await enqueueCapi({
        leadId: lead.id,
        eventName: 'CompleteRegistration',
        triggerId: normalized.messageId,
      });
      capiEnqueued.push('Lead', 'CompleteRegistration');
    }
    await enqueueCapi({
      leadId: lead.id,
      eventName: 'Purchase',
      triggerId: normalized.messageId,
    });
    capiEnqueued.push('Purchase');
  }

  await markProcessed(inboxId);

  return {
    status: 'processed',
    leadId: lead.id,
    messageId: messageRow.id,
    classification: messageRow.classification ?? undefined,
    capiEnqueued,
  };
}

// ============================================================================
// Internals
// ============================================================================

interface UpsertedLead {
  id: string;
  isNew: boolean;
  previousStatus: string | null;
}

async function upsertLead(
  msg: NormalizedMessage,
  appSettings: AllSettings,
): Promise<UpsertedLead> {
  const phoneNormalized = normalizePhone(msg.phone);
  const phoneHash = hashPhone(msg.phone);

  // Busca lead existente para esta instance + telefone
  const existing = await db
    .select()
    .from(leads)
    .where(and(eq(leads.source, 'whatsapp'), eq(leads.waInstance, msg.instance), eq(leads.phone, phoneNormalized)))
    .limit(1);

  if (existing[0]) {
    const lead = existing[0];

    // Se referral chegou agora e ainda não tinha, preencher
    if (msg.referral?.ctwa_clid && !lead.ctwaClid) {
      const adId = msg.referral.source_id ?? null;
      const adIdResolved = await resolveAdId(adId);
      await db
        .update(leads)
        .set({
          ctwaClid: msg.referral.ctwa_clid,
          adId: adIdResolved,
          sourceUrl: msg.referral.source_url ?? null,
          ctaHeadline: msg.referral.headline ?? null,
          attributionMethod: 'ctwa_clid',
          updatedAt: sql`NOW()`,
        })
        .where(eq(leads.id, lead.id));
      log.info({ leadId: lead.id, adId: adIdResolved }, 'lead enriched with referral');
    }

    return { id: lead.id, isNew: false, previousStatus: lead.status };
  }

  // Lead novo: tentar atribuir via referral OU welcome_message
  let adId: string | null = null;
  let attributionMethod = 'none';
  let ctwaClid: string | null = null;
  let sourceUrl: string | null = null;
  let ctaHeadline: string | null = null;

  if (msg.referral?.ctwa_clid) {
    ctwaClid = msg.referral.ctwa_clid;
    sourceUrl = msg.referral.source_url ?? null;
    ctaHeadline = msg.referral.headline ?? null;
    adId = await resolveAdId(msg.referral.source_id ?? null);
    if (adId) attributionMethod = 'ctwa_clid';
  } else if (Object.keys(appSettings.welcomeMessageSignatures).length > 0) {
    // Plano B: welcome_message
    const matchedAdId = resolveAdByWelcomeMessage(msg.text, appSettings.welcomeMessageSignatures);
    if (matchedAdId) {
      adId = await resolveAdId(matchedAdId);
      if (adId) attributionMethod = 'welcome_message';
    }
  }

  const newLead: NewLead = {
    source: 'whatsapp',
    name: msg.contactName ?? null,
    phone: phoneNormalized,
    phoneHash,
    waInstance: msg.instance,
    adId,
    ctwaClid,
    sourceUrl,
    ctaHeadline,
    attributionMethod,
    status: 'opened',
    firstSeenAt: new Date(msg.timestamp),
  };

  const inserted = await db.insert(leads).values(newLead).returning({ id: leads.id });
  const id = inserted[0]?.id;
  if (!id) throw new Error('failed to insert lead');

  log.info(
    {
      leadId: id,
      phone: phoneNormalized.slice(0, 4) + '***',
      instance: msg.instance,
      attributionMethod,
      adId,
    },
    'new whatsapp lead',
  );

  return { id, isNew: true, previousStatus: null };
}

/**
 * Verifica se um ad_id existe em meta_ads. Retorna null se não existir
 * (atribuição perdida — guardamos só ctwa_clid mas não vinculamos ao ad).
 */
async function resolveAdId(adId: string | null): Promise<string | null> {
  if (!adId) return null;
  const exists = await db
    .select({ adId: metaAds.adId })
    .from(metaAds)
    .where(eq(metaAds.adId, adId))
    .limit(1);
  return exists[0]?.adId ?? null;
}

interface InsertedMessage {
  id: string;
  classification: string | null;
}

async function insertMessage(
  msg: NormalizedMessage,
  leadId: string,
  appSettings: AllSettings,
): Promise<InsertedMessage> {
  const classification = classify(msg.text, {
    qualifierPhrase: appSettings.qualifierPhrase,
    purchasePhrase: appSettings.purchasePhrase,
  });

  const newMessage: NewMessage = {
    leadId,
    waMessageId: msg.messageId,
    direction: msg.direction,
    text: msg.text,
    classification,
    receivedAt: new Date(msg.timestamp),
  };

  const inserted = await db
    .insert(messages)
    .values(newMessage)
    .returning({ id: messages.id, classification: messages.classification });
  const row = inserted[0];
  if (!row) throw new Error('failed to insert message');

  // Se classificou, atualizar o status do lead
  if (classification === 'qualifier_match') {
    await db
      .update(leads)
      .set({
        status: sql`CASE WHEN status = 'purchased' THEN status ELSE 'qualified' END`,
        qualifiedAt: sql`COALESCE(qualified_at, NOW())`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(leads.id, leadId));
    log.info({ leadId }, 'lead qualified by phrase match');
  } else if (classification === 'purchase_match') {
    await db
      .update(leads)
      .set({
        status: 'purchased',
        purchasedAt: sql`NOW()`,
        purchaseValue: appSettings.defaultPurchaseValue.toString(),
        purchaseCurrency: appSettings.defaultPurchaseCurrency,
        // Se ainda não tinha qualificado, marca também
        qualifiedAt: sql`COALESCE(qualified_at, NOW())`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(leads.id, leadId));
    log.info({ leadId, value: appSettings.defaultPurchaseValue }, 'lead purchased by phrase match');
  }

  return { id: row.id, classification: row.classification };
}

async function markProcessed(inboxId: number, error?: string): Promise<void> {
  await db
    .update(webhookInbox)
    .set({ processedAt: sql`NOW()`, error: error ?? null })
    .where(eq(webhookInbox.id, inboxId));
}

/**
 * Limpa o cache em memória (chamado quando settings são alteradas).
 */
export function invalidateSettingsCache() {
  cachedSettings = null;
  cachedAt = 0;
}
