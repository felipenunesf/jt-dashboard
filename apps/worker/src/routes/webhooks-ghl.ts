import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { db, webhookInbox } from '@jt/db';
import type { Queue } from 'bullmq';
import type { ProcessGhlJobData, ProcessGhlJobResult } from '../workers/process-ghl-webhook.js';

export interface GhlRoutesOptions {
  /** Token compartilhado opcional no header X-JT-Webhook-Token. */
  sharedSecret?: string;
  queue: Queue<ProcessGhlJobData, ProcessGhlJobResult>;
}

/**
 * Plugin Fastify para webhook do Go High Level.
 *
 * Endpoint: POST /webhooks/ghl
 *
 * Configurar no GHL:
 *   Workflows → trigger "Pipeline Stage Changed" (ou "Opportunity Status Changed")
 *   Action: "Webhook"
 *   URL: https://<domínio>/webhooks/ghl
 *   Headers: X-JT-Webhook-Token: <secret> (se configurado)
 */
export const ghlWebhookRoutes: FastifyPluginAsync<GhlRoutesOptions> = async (
  app: FastifyInstance,
  options,
) => {
  const { sharedSecret, queue } = options;

  app.post<{ Body: unknown }>('/ghl', async (request, reply) => {
    if (sharedSecret) {
      const provided = request.headers['x-jt-webhook-token'];
      if (provided !== sharedSecret) {
        request.log.warn({ ip: request.ip }, 'invalid ghl webhook token');
        return reply.code(401).send({ error: 'unauthorized' });
      }
    }

    let inboxId: number | undefined;
    try {
      const inserted = await db
        .insert(webhookInbox)
        .values({
          source: 'ghl',
          rawBody: request.body as object,
          headers: request.headers as object,
        })
        .returning({ id: webhookInbox.id });
      inboxId = inserted[0]?.id;
    } catch (err) {
      request.log.error({ err }, 'failed to persist ghl webhook_inbox');
      return reply.code(200).send({ ok: true });
    }

    if (!inboxId) {
      return reply.code(200).send({ ok: true });
    }

    try {
      await queue.add('process-ghl-webhook', { inboxId });
    } catch (err) {
      request.log.error({ err, inboxId }, 'failed to enqueue process-ghl-webhook');
    }

    return reply.code(200).send({ ok: true, inboxId });
  });

  app.get('/ghl/health', async () => {
    return { status: 'ok', endpoint: 'ghl' };
  });
};
