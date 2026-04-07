import { db, leads, webhookInbox, type NewLead } from '@jt/db';
import { and, eq, sql } from 'drizzle-orm';
import { logger } from '../lib/logger.js';
import { hashEmail, hashPhone, normalizePhone } from '../lib/crypto.js';
import { normalizeGhlWebhook, type NormalizedGhlEvent } from '../services/ghl-adapter.js';
import {
  GhlClient,
  extractFbclid,
  extractFbp,
  parseMonetaryValue,
  type GhlContact,
  type GhlOpportunity,
} from '../services/ghl.js';
import { loadAllSettings, type AllSettings } from '../services/settings.js';
import type { CapiEventName } from '../services/meta-capi.js';

const log = logger.child({ module: 'process-ghl-webhook' });

export interface ProcessGhlJobData {
  inboxId: number;
}

export interface ProcessGhlJobResult {
  status: 'processed' | 'duplicated' | 'invalid' | 'no_token' | 'error';
  leadId?: string;
  opportunityId?: string;
  capiEnqueued?: CapiEventName[];
}

export interface ProcessGhlContext {
  ghlToken?: string;
  ghlLocationId?: string;
}

// ============================================================================
// CAPI enqueuer (injected pelo scheduler)
// ============================================================================

export interface CapiEnqueueJob {
  leadId: string;
  eventName: CapiEventName;
  triggerId: string;
}

let capiEnqueuer: ((data: CapiEnqueueJob) => Promise<void>) | null = null;

export function setGhlCapiEnqueuer(fn: (data: CapiEnqueueJob) => Promise<void>) {
  capiEnqueuer = fn;
}

async function enqueueCapi(data: CapiEnqueueJob): Promise<void> {
  if (!capiEnqueuer) {
    log.warn({ data }, 'capi enqueuer not set, ghl event dropped');
    return;
  }
  try {
    await capiEnqueuer(data);
  } catch (err) {
    log.error({ err: (err as Error).message, data }, 'failed to enqueue capi event');
  }
}

// ============================================================================
// Settings cache (compartilhado com process-wa-webhook lógico)
// ============================================================================

let cachedSettings: AllSettings | null = null;
let cachedAt = 0;
const SETTINGS_TTL_MS = 60_000;

async function getCachedSettings(): Promise<AllSettings> {
  const now = Date.now();
  if (!cachedSettings || now - cachedAt > SETTINGS_TTL_MS) {
    cachedSettings = await loadAllSettings();
    cachedAt = now;
  }
  return cachedSettings;
}

// ============================================================================
// Worker entrypoint
// ============================================================================

export async function processGhlWebhook(
  data: ProcessGhlJobData,
  context: ProcessGhlContext,
): Promise<ProcessGhlJobResult> {
  const inboxRow = await db
    .select()
    .from(webhookInbox)
    .where(eq(webhookInbox.id, data.inboxId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!inboxRow) {
    log.warn({ inboxId: data.inboxId }, 'webhook_inbox row not found');
    return { status: 'error' };
  }

  if (inboxRow.processedAt) {
    log.debug({ inboxId: data.inboxId }, 'already processed, skipping');
    return { status: 'duplicated' };
  }

  // 1. Normalize webhook payload
  const normalized = normalizeGhlWebhook(inboxRow.rawBody);
  if (!normalized) {
    log.warn({ inboxId: data.inboxId }, 'failed to normalize ghl payload');
    await markProcessed(data.inboxId, 'normalize_failed');
    return { status: 'invalid' };
  }

  log.info(
    {
      type: normalized.type,
      opportunityId: normalized.opportunityId,
      stageId: normalized.stageId,
    },
    'processing ghl webhook',
  );

  // 2. Enriquecimento opcional via GHL API (só se token estiver configurado)
  // Se não tiver token ou der erro, usa só os dados inline do webhook
  let opportunity: GhlOpportunity = {
    id: normalized.opportunityId,
    monetaryValue: normalized.monetaryValue,
  };
  let contact: GhlContact | null = null;

  if (context.ghlToken) {
    const client = new GhlClient({
      privateToken: context.ghlToken,
      locationId: context.ghlLocationId,
    });

    try {
      opportunity = await client.getOpportunity(normalized.opportunityId);
    } catch (err) {
      log.warn(
        { err: (err as Error).message, opportunityId: normalized.opportunityId },
        'opportunity fetch failed, using webhook payload only',
      );
    }

    const contactId =
      normalized.contactId ?? opportunity.contactId ?? opportunity.contact_id ?? null;
    if (contactId) {
      try {
        contact = await client.getContact(contactId);
      } catch (err) {
        log.warn(
          { err: (err as Error).message, contactId },
          'contact fetch failed, using webhook payload only',
        );
      }
    }
  } else {
    log.debug({ inboxId: data.inboxId }, 'no GHL token — using inline payload data');
  }

  // 3. Upsert lead
  const settings = await getCachedSettings();
  const leadResult = await upsertLeadFromGhl(normalized, opportunity, contact);

  // 4. Disparar eventos CAPI
  const capiEnqueued: CapiEventName[] = [];
  const triggerId = `${normalized.opportunityId}:${Date.now()}`;

  // Lead novo (1ª vez vendo essa opportunity) → Contact
  if (leadResult.isNew) {
    await enqueueCapi({ leadId: leadResult.id, eventName: 'Contact', triggerId });
    capiEnqueued.push('Contact');
  }

  // Stage match → Lead/CompleteRegistration ou Purchase
  const wasAlreadyQualified =
    leadResult.previousStatus === 'qualified' || leadResult.previousStatus === 'purchased';
  const wasAlreadyPurchased = leadResult.previousStatus === 'purchased';

  const matchedQualified =
    settings.ghlStageMap.qualified_stage_id !== null &&
    normalized.stageId === settings.ghlStageMap.qualified_stage_id;

  const matchedClosed =
    settings.ghlStageMap.closed_stage_id !== null &&
    normalized.stageId === settings.ghlStageMap.closed_stage_id;

  if (matchedQualified && !wasAlreadyQualified) {
    // Move lead → qualified
    await db
      .update(leads)
      .set({
        status: sql`CASE WHEN status = 'purchased' THEN status ELSE 'qualified' END`,
        qualifiedAt: sql`COALESCE(qualified_at, NOW())`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(leads.id, leadResult.id));

    await enqueueCapi({ leadId: leadResult.id, eventName: 'Lead', triggerId });
    await enqueueCapi({ leadId: leadResult.id, eventName: 'CompleteRegistration', triggerId });
    capiEnqueued.push('Lead', 'CompleteRegistration');
  }

  if (matchedClosed && !wasAlreadyPurchased) {
    // Se ainda não tinha qualificado, dispara o lifecycle completo
    if (!wasAlreadyQualified && !matchedQualified) {
      await enqueueCapi({ leadId: leadResult.id, eventName: 'Lead', triggerId });
      await enqueueCapi({
        leadId: leadResult.id,
        eventName: 'CompleteRegistration',
        triggerId,
      });
      capiEnqueued.push('Lead', 'CompleteRegistration');
    }

    // Move lead → purchased
    const purchaseValue =
      parseMonetaryValue(opportunity.monetaryValue ?? opportunity.monetary_value) ??
      settings.defaultPurchaseValue;
    await db
      .update(leads)
      .set({
        status: 'purchased',
        purchasedAt: sql`NOW()`,
        purchaseValue: purchaseValue.toString(),
        purchaseCurrency: settings.defaultPurchaseCurrency,
        qualifiedAt: sql`COALESCE(qualified_at, NOW())`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(leads.id, leadResult.id));

    await enqueueCapi({ leadId: leadResult.id, eventName: 'Purchase', triggerId });
    capiEnqueued.push('Purchase');
  }

  await markProcessed(data.inboxId);

  return {
    status: 'processed',
    leadId: leadResult.id,
    opportunityId: normalized.opportunityId,
    capiEnqueued,
  };
}

// ============================================================================
// Internals
// ============================================================================

interface UpsertedGhlLead {
  id: string;
  isNew: boolean;
  previousStatus: string | null;
}

async function upsertLeadFromGhl(
  event: NormalizedGhlEvent,
  opportunity: GhlOpportunity,
  contact: GhlContact | null,
): Promise<UpsertedGhlLead> {
  // Busca lead existente por ghl_opportunity_id
  const existing = await db
    .select()
    .from(leads)
    .where(and(eq(leads.source, 'site_ghl'), eq(leads.ghlOpportunityId, event.opportunityId)))
    .limit(1);

  // Extrai dados do contato — prioridade: API enrichment > inline payload
  let name: string | null = null;
  if (contact?.contactName) {
    name = contact.contactName;
  } else if (contact?.firstName || contact?.lastName) {
    name = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() || null;
  } else {
    name = event.inlineContact.name;
  }

  const email = contact?.email ?? event.inlineContact.email;
  const phone = contact?.phone ?? event.inlineContact.phone;
  const fbclid = (contact ? extractFbclid(contact) : null) ?? event.inlineContact.fbclid;
  const fbp = (contact ? extractFbp(contact) : null) ?? event.inlineContact.fbp;

  const phoneNormalized = phone ? normalizePhone(phone) : null;
  const phoneHash = phone ? hashPhone(phone) : null;
  const emailHash = email ? hashEmail(email) : null;

  if (existing[0]) {
    const lead = existing[0];
    // Atualiza campos que podem ter mudado
    await db
      .update(leads)
      .set({
        name: name ?? lead.name,
        phone: phoneNormalized ?? lead.phone,
        phoneHash: phoneHash ?? lead.phoneHash,
        email: email ?? lead.email,
        emailHash: emailHash ?? lead.emailHash,
        fbclid: fbclid ?? lead.fbclid,
        fbp: fbp ?? lead.fbp,
        ghlContactId: contact?.id ?? lead.ghlContactId,
        ghlPipelineId: event.pipelineId ?? lead.ghlPipelineId,
        ghlStageId: event.stageId ?? lead.ghlStageId,
        updatedAt: sql`NOW()`,
      })
      .where(eq(leads.id, lead.id));

    return { id: lead.id, isNew: false, previousStatus: lead.status };
  }

  // Lead novo
  const attributionMethod = fbclid ? 'fbclid' : 'none';

  const newLead: NewLead = {
    source: 'site_ghl',
    name,
    phone: phoneNormalized,
    phoneHash,
    email,
    emailHash,
    fbclid,
    fbp,
    sourceUrl: event.sourceUrl,
    attributionMethod,
    ghlOpportunityId: event.opportunityId,
    ghlContactId: contact?.id ?? event.contactId ?? null,
    ghlPipelineId: event.pipelineId,
    ghlStageId: event.stageId,
    status: 'opened',
  };

  const inserted = await db.insert(leads).values(newLead).returning({ id: leads.id });
  const id = inserted[0]?.id;
  if (!id) throw new Error('failed to insert ghl lead');

  log.info(
    {
      leadId: id,
      opportunityId: event.opportunityId,
      attributionMethod,
      hasContact: !!contact,
    },
    'new ghl lead',
  );

  return { id, isNew: true, previousStatus: null };
}

async function markProcessed(inboxId: number, error?: string): Promise<void> {
  await db
    .update(webhookInbox)
    .set({ processedAt: sql`NOW()`, error: error ?? null })
    .where(eq(webhookInbox.id, inboxId));
}
