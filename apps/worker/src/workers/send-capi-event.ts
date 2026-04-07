import { capiEvents, db, leads, metaAds, type Lead, type MetaAd } from '@jt/db';
import type { MetaAccount } from '@jt/shared';
import { eq, sql } from 'drizzle-orm';
import { logger } from '../lib/logger.js';
import { makeEventId } from '../lib/event-id.js';
import {
  buildSiteCapiPayload,
  buildWhatsappCapiPayload,
  MissingPixelError,
  resolveDefaultPixel,
  type CapiEventName,
} from '../services/meta-capi.js';
import { MetaApiClient, type MetaApiError } from '../services/meta-marketing.js';

const log = logger.child({ module: 'send-capi-event' });

export interface SendCapiJobData {
  leadId: string;
  eventName: CapiEventName;
  /** ID estável do trigger (wa_message_id, ghl stage change ts, etc.) */
  triggerId: string;
}

export interface SendCapiJobResult {
  status: 'sent' | 'duplicated' | 'skipped' | 'failed';
  eventId: string;
  eventName: CapiEventName;
  pixelId?: string;
  reason?: string;
}

export interface SendCapiContext {
  metaToken: string;
  metaAccounts: MetaAccount[];
  metaApiVersion: string;
  metaTestEventCode?: string;
  /** Quando true, monta o payload e persiste mas NÃO chama a API Meta. */
  dryRun?: boolean;
}

/**
 * Worker genérico de envio CAPI.
 *
 * Garantias:
 * - Idempotência: event_id determinístico (sha256 de eventName+leadId+triggerId).
 *   Reenvios geram o mesmo hash → Meta dedup. Antes de enviar, checa se já
 *   existe capi_events.event_id com status='sent' e marca o novo como 'duplicated'.
 * - Auditoria: cada tentativa cria/atualiza um row em capi_events com payload + resposta.
 * - Retry: BullMQ tenta 5x com backoff exponencial em caso de erro.
 */
export async function sendCapiEvent(
  data: SendCapiJobData,
  context: SendCapiContext,
): Promise<SendCapiJobResult> {
  const eventId = makeEventId(data.eventName, data.leadId, data.triggerId);

  // 1. Carrega o lead
  const leadRow = await db.select().from(leads).where(eq(leads.id, data.leadId)).limit(1);
  const lead = leadRow[0];
  if (!lead) {
    log.error({ leadId: data.leadId }, 'lead not found');
    return { status: 'skipped', eventId, eventName: data.eventName, reason: 'lead_not_found' };
  }

  // 2. Verifica dedup
  const existing = await db
    .select({ status: capiEvents.status })
    .from(capiEvents)
    .where(eq(capiEvents.eventId, eventId))
    .limit(1);
  if (existing[0]?.status === 'sent') {
    log.debug({ eventId, eventName: data.eventName }, 'already sent, skipping');
    return { status: 'duplicated', eventId, eventName: data.eventName };
  }

  // 3. Resolve ad relacionado (pra pegar pixel/page)
  let ad: MetaAd | null = null;
  if (lead.adId) {
    const adRow = await db.select().from(metaAds).where(eq(metaAds.adId, lead.adId)).limit(1);
    ad = adRow[0] ?? null;
  }

  const defaultPixel = resolveDefaultPixel(ad?.accountId, context.metaAccounts);

  // 4. Monta payload (escolhe builder pelo source do lead)
  let pixelId: string;
  let payload: { data: unknown[] };
  try {
    const builder = lead.source === 'site_ghl' ? buildSiteCapiPayload : buildWhatsappCapiPayload;
    const built = builder({
      eventName: data.eventName,
      eventId,
      eventTime: Date.now(),
      lead,
      ad,
      defaultPixelFromAccount: defaultPixel,
    });
    pixelId = built.pixelId;
    payload = built.payload;
  } catch (err) {
    if (err instanceof MissingPixelError) {
      log.warn(
        { leadId: lead.id, eventName: data.eventName, adId: lead.adId },
        'no pixel available, skipping',
      );
      await persistAttempt({
        eventId,
        eventName: data.eventName,
        lead,
        adId: lead.adId,
        pixelId: null,
        payload: null,
        metaResponse: null,
        status: 'skipped',
        lastError: 'no_pixel',
      });
      return {
        status: 'skipped',
        eventId,
        eventName: data.eventName,
        reason: 'no_pixel',
      };
    }
    throw err;
  }

  // 5. Dry run: persiste mas não envia
  if (context.dryRun) {
    log.info(
      { leadId: lead.id, eventName: data.eventName, eventId, pixelId },
      'capi DRY RUN — payload built, not sent',
    );
    await persistAttempt({
      eventId,
      eventName: data.eventName,
      lead,
      adId: lead.adId,
      pixelId,
      payload,
      metaResponse: { dry_run: true },
      status: 'sent',
    });
    return { status: 'sent', eventId, eventName: data.eventName, pixelId, reason: 'dry_run' };
  }

  // 6. Envia para Meta CAPI
  const client = new MetaApiClient({
    accessToken: context.metaToken,
    apiVersion: context.metaApiVersion,
    testEventCode: context.metaTestEventCode,
  });

  try {
    const response = await client.sendCapiEvent(pixelId, payload);
    log.info(
      {
        leadId: lead.id,
        eventName: data.eventName,
        eventId,
        pixelId,
        eventsReceived: response.events_received,
        fbtraceId: response.fbtrace_id,
      },
      'capi event sent',
    );
    await persistAttempt({
      eventId,
      eventName: data.eventName,
      lead,
      adId: lead.adId,
      pixelId,
      payload,
      metaResponse: response as unknown as Record<string, unknown>,
      status: 'sent',
    });
    return { status: 'sent', eventId, eventName: data.eventName, pixelId };
  } catch (err) {
    const apiErr = err as MetaApiError;
    log.error(
      {
        leadId: lead.id,
        eventName: data.eventName,
        eventId,
        code: apiErr.code,
        msg: apiErr.message,
      },
      'capi send failed',
    );
    await persistAttempt({
      eventId,
      eventName: data.eventName,
      lead,
      adId: lead.adId,
      pixelId,
      payload,
      metaResponse: null,
      status: 'failed',
      lastError: apiErr.message,
    });
    throw err; // BullMQ retry
  }
}

interface PersistAttemptInput {
  eventId: string;
  eventName: CapiEventName;
  lead: Lead;
  adId: string | null;
  pixelId: string | null;
  payload: { data: unknown[] } | null;
  metaResponse: Record<string, unknown> | null;
  status: 'pending' | 'sent' | 'failed' | 'duplicated' | 'skipped';
  lastError?: string;
}

/**
 * Upsert em capi_events. Estratégia: se já existe (mesma event_id), atualiza
 * status/attempts/last_error/sent_at; se não, insere.
 */
async function persistAttempt(input: PersistAttemptInput): Promise<void> {
  await db
    .insert(capiEvents)
    .values({
      eventId: input.eventId,
      eventName: input.eventName,
      leadId: input.lead.id,
      adId: input.adId,
      pixelId: input.pixelId,
      payload: input.payload as object | null,
      metaResponse: input.metaResponse,
      status: input.status,
      attempts: 1,
      lastError: input.lastError ?? null,
      sentAt: input.status === 'sent' ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: capiEvents.eventId,
      set: {
        status: input.status,
        attempts: sql`${capiEvents.attempts} + 1`,
        metaResponse: input.metaResponse ?? sql`${capiEvents.metaResponse}`,
        lastError: input.lastError ?? null,
        sentAt: input.status === 'sent' ? sql`NOW()` : sql`${capiEvents.sentAt}`,
      },
    });
}
