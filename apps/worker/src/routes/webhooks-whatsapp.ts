import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { db, webhookInbox } from '@jt/db';
import type { Queue } from 'bullmq';
import type { ProcessWaJobData, ProcessWaJobResult } from '../workers/process-wa-webhook.js';

export interface WhatsappRoutesOptions {
  /** Token compartilhado obrigatório no header X-JT-Webhook-Token (se setado). */
  sharedSecret?: string;
  /** Fila BullMQ que processa os webhooks. */
  queue: Queue<ProcessWaJobData, ProcessWaJobResult>;
}

/**
 * Plugin Fastify que registra as rotas de webhook do WhatsApp.
 *
 * Endpoint: POST /webhooks/whatsapp/:instance
 *
 * - :instance identifica qual número da JT recebeu (futuro: 2 instâncias Z-API)
 * - Salva tudo em webhook_inbox antes de processar (safety net)
 * - Responde 200 OK rápido (Z-API tem timeout curto)
 * - Enfileira BullMQ job para processamento assíncrono
 */
export const whatsappWebhookRoutes: FastifyPluginAsync<WhatsappRoutesOptions> = async (
  app: FastifyInstance,
  options,
) => {
  const { sharedSecret, queue } = options;

  app.post<{
    Params: { instance: string };
    Querystring: { t?: string };
    Body: unknown;
  }>('/whatsapp/:instance', async (request, reply) => {
    const { instance } = request.params;

    // Validação opcional de shared secret (header OU ?t= query string —
    // Z-API não suporta headers customizados, então query param é fallback)
    if (sharedSecret) {
      const provided = request.headers['x-jt-webhook-token'] ?? request.query.t;
      if (provided !== sharedSecret) {
        request.log.warn({ instance, ip: request.ip }, 'invalid webhook token');
        return reply.code(401).send({ error: 'unauthorized' });
      }
    }

    // Persistir bruto antes de qualquer processamento (safety net)
    const headers = { ...request.headers, 'x-jt-instance': instance };
    let inboxId: number | undefined;
    try {
      const inserted = await db
        .insert(webhookInbox)
        .values({
          source: 'zapi',
          rawBody: request.body as object,
          headers: headers as object,
        })
        .returning({ id: webhookInbox.id });
      inboxId = inserted[0]?.id;
    } catch (err) {
      request.log.error({ err, instance }, 'failed to persist webhook_inbox');
      // Mesmo se falhar, retornamos 200 — Z-API não precisa retry de webhook que
      // fizemos parse mas não conseguimos persistir; logamos e seguimos
      return reply.code(200).send({ ok: true });
    }

    if (!inboxId) {
      return reply.code(200).send({ ok: true });
    }

    // Enfileirar processamento assíncrono
    try {
      await queue.add('process-wa-webhook', { inboxId });
    } catch (err) {
      request.log.error({ err, inboxId }, 'failed to enqueue process-wa-webhook');
      // webhook_inbox já tem o raw, podemos reprocessar manualmente depois
    }

    // Z-API espera 200 rápido — qualquer outra coisa pode disparar retries
    return reply.code(200).send({ ok: true, inboxId });
  });

  // Health específico do endpoint (alguns providers fazem ping)
  app.get('/whatsapp/health', async () => {
    return { status: 'ok', endpoint: 'whatsapp' };
  });
};
