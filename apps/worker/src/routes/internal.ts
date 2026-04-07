import type { FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import { sql } from 'drizzle-orm';
import { db, leads } from '@jt/db';
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

  app.post<{ Querystring: { instance?: string } }>('/import-tintim', async (request, reply) => {
    const waInstance = request.query.instance?.trim();
    if (!waInstance) {
      return reply.code(400).send({ error: 'missing ?instance=<name> query param' });
    }

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: 'missing file field (multipart/form-data)' });
    }

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

  /**
   * Apaga todos os leads que foram criados/atualizados via import Tintim.
   * Identifica pela chave raw->'tintimImport'. Não toca em leads reais (Z-API/GHL).
   * Útil pra reimportar quando houver erro.
   */
  app.post('/tintim-rollback', async (_request, _reply) => {
    const result = await db
      .delete(leads)
      .where(sql`${leads.raw} ? 'tintimImport'`)
      .returning({ id: leads.id });
    log.warn({ deleted: result.length }, 'tintim rollback executed');
    return { ok: true, deleted: result.length };
  });
};
