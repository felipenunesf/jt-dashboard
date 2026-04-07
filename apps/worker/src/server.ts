import Fastify from 'fastify';
import { logger } from './lib/logger.js';
import { whatsappWebhookRoutes } from './routes/webhooks-whatsapp.js';
import { ghlWebhookRoutes } from './routes/webhooks-ghl.js';
import { getHealthStatus } from './services/health.js';
import type { Scheduler } from './jobs/scheduler.js';

export interface ServerDeps {
  scheduler?: Scheduler;
  whatsappWebhookSecret?: string;
  ghlWebhookSecret?: string;
}

export async function buildServer(deps: ServerDeps = {}) {
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: 10 * 1024 * 1024, // 10MB para webhooks com payloads grandes
  });

  // Health check expandido — verifica DB, Redis e métricas operacionais
  app.get('/health', async (_request, reply) => {
    const health = await getHealthStatus();
    const httpCode = health.status === 'down' ? 503 : 200;
    return reply.code(httpCode).send(health);
  });

  // Health raso pra liveness probe (sem tocar DB/Redis — bem rápido)
  app.get('/health/live', async () => ({
    status: 'ok',
    service: 'jt-worker',
    timestamp: new Date().toISOString(),
  }));

  // Trigger manual de sync (admin only — só localhost no MVP)
  app.post<{ Body: { backfillDays?: number } }>('/internal/sync-meta', async (request, reply) => {
    if (!deps.scheduler) {
      return reply.code(503).send({ error: 'scheduler not initialized' });
    }
    try {
      const result = await deps.scheduler.triggerSync(request.body ?? {});
      return { ok: true, ...result };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // Webhooks WhatsApp (Z-API)
  if (deps.scheduler) {
    await app.register(whatsappWebhookRoutes, {
      prefix: '/webhooks',
      sharedSecret: deps.whatsappWebhookSecret,
      queue: deps.scheduler.getProcessWaQueue(),
    });

    // Webhooks GHL
    await app.register(ghlWebhookRoutes, {
      prefix: '/webhooks',
      sharedSecret: deps.ghlWebhookSecret,
      queue: deps.scheduler.getProcessGhlQueue(),
    });
  }

  return app;
}
