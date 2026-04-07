import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Carrega .env da raiz do monorepo (3 níveis acima de src/index.ts)
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../.env') });

import { workerEnvSchema, parseEnv } from '@jt/shared';
import { buildServer } from './server.js';
import { logger } from './lib/logger.js';
import { Scheduler } from './jobs/scheduler.js';
import { seedDefaultSettings } from './services/settings.js';

const env = parseEnv(workerEnvSchema);

async function main() {
  // Garante que as settings padrão existem antes de qualquer worker rodar
  await seedDefaultSettings();

  const scheduler = new Scheduler({
    metaToken: env.META_SYSTEM_USER_TOKEN,
    metaAccounts: env.META_ACCOUNTS,
    metaApiVersion: env.META_API_VERSION,
    metaTestEventCode: env.META_TEST_EVENT_CODE,
    metaCapiDryRun: env.META_CAPI_DRY_RUN,
    ghlToken: env.GHL_PRIVATE_TOKEN,
    ghlLocationId: env.GHL_LOCATION_ID,
  });

  await scheduler.start();

  const app = await buildServer({
    scheduler,
    whatsappWebhookSecret: process.env.WHATSAPP_WEBHOOK_SECRET,
    ghlWebhookSecret: process.env.GHL_WEBHOOK_SECRET,
    internalToken: env.INTERNAL_TOKEN,
  });

  try {
    await app.listen({ port: env.WORKER_PORT, host: '0.0.0.0' });
    logger.info({ port: env.WORKER_PORT }, 'jt-worker listening');
  } catch (err) {
    logger.error({ err }, 'failed to start worker');
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    await scheduler.stop();
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal error during startup');
  process.exit(1);
});
