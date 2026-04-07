import Fastify from 'fastify';
import { logger } from './lib/logger.js';
import { whatsappWebhookRoutes } from './routes/webhooks-whatsapp.js';
import { ghlWebhookRoutes } from './routes/webhooks-ghl.js';
import { internalRoutes } from './routes/internal.js';
import { getHealthStatus } from './services/health.js';
import type { Scheduler } from './jobs/scheduler.js';

export interface ServerDeps {
  scheduler?: Scheduler;
  whatsappWebhookSecret?: string;
  ghlWebhookSecret?: string;
  internalToken: string;
}

export async function buildServer(deps: ServerDeps) {
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

  // Rotas administrativas protegidas (sync manual, imports)
  if (deps.scheduler) {
    await app.register(
      async (scoped) =>
        internalRoutes(scoped, {
          scheduler: deps.scheduler!,
          internalToken: deps.internalToken,
        }),
      { prefix: '/internal' },
    );

    // Webhooks WhatsApp (Z-API)
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
