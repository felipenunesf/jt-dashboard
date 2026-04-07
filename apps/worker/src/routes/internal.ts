import type { FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import type { Scheduler } from '../jobs/scheduler.js';
import { importTintimCsv } from '../services/tintim-import.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ module: 'internal-routes' });

export interface InternalRoutesOptions {
  scheduler: Scheduler;
  internalToken: string;
}

/**
 * Rotas administrativas protegidas por X-Internal-Token header.
 * Expostas em /internal/* — nunca devem ser acessíveis sem o token.
 */
export const internalRoutes: FastifyPluginAsync<InternalRoutesOptions> = async (app, opts) => {
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  app.addHook('onRequest', async (request, reply) => {
    const token = request.headers['x-internal-token'];
    if (!token || token !== opts.internalToken) {
      log.warn({ path: request.url, ip: request.ip }, 'unauthorized internal access');
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.post<{ Body: { backfillDays?: number } }>('/sync-meta', async (request, reply) => {
    try {
      const result = await opts.scheduler.triggerSync(request.body ?? {});
      return { ok: true, ...result };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.post('/import-tintim', async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: 'missing file field (multipart/form-data)' });
    }
    const instanceField = data.fields.instance as { value?: string } | undefined;
    const waInstance = instanceField?.value?.trim() || 'jt-ca02';

    try {
      const buffer = await data.toBuffer();
      const csvContent = buffer.toString('utf-8');
      const result = await importTintimCsv(csvContent, waInstance);
      return { ok: true, waInstance, ...result };
    } catch (err) {
      log.error({ err }, 'tintim import failed');
      return reply.code(500).send({ error: (err as Error).message });
    }
  });
};
