import { Queue, Worker, type Job } from 'bullmq';
import type { MetaAccount } from '@jt/shared';
import { redisConnection } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { runSyncMeta, type SyncMetaJobData, type SyncMetaJobResult } from '../workers/sync-meta.js';
import {
  processWaWebhook,
  type ProcessWaJobData,
  type ProcessWaJobResult,
} from '../workers/process-wa-webhook.js';
import {
  sendCapiEvent,
  type SendCapiJobData,
  type SendCapiJobResult,
} from '../workers/send-capi-event.js';
import { setCapiEnqueuer } from '../workers/process-wa-webhook.js';
import {
  processGhlWebhook,
  setGhlCapiEnqueuer,
  type ProcessGhlJobData,
  type ProcessGhlJobResult,
} from '../workers/process-ghl-webhook.js';

const log = logger.child({ module: 'scheduler' });

export const QUEUE_SYNC_META = 'sync-meta';
export const QUEUE_PROCESS_WA = 'process-wa-webhook';
export const QUEUE_PROCESS_GHL = 'process-ghl-webhook';
export const QUEUE_SEND_CAPI = 'send-capi-event';

export interface SchedulerOptions {
  metaToken?: string;
  metaAccounts: MetaAccount[];
  metaApiVersion: string;
  metaTestEventCode?: string;
  metaCapiDryRun?: boolean;
  ghlToken?: string;
  ghlLocationId?: string;
}

export class Scheduler {
  private readonly options: SchedulerOptions;
  private syncMetaQueue?: Queue<SyncMetaJobData, SyncMetaJobResult>;
  private syncMetaWorker?: Worker<SyncMetaJobData, SyncMetaJobResult>;
  private processWaQueue?: Queue<ProcessWaJobData, ProcessWaJobResult>;
  private processWaWorker?: Worker<ProcessWaJobData, ProcessWaJobResult>;
  private processGhlQueue?: Queue<ProcessGhlJobData, ProcessGhlJobResult>;
  private processGhlWorker?: Worker<ProcessGhlJobData, ProcessGhlJobResult>;
  private sendCapiQueue?: Queue<SendCapiJobData, SendCapiJobResult>;
  private sendCapiWorker?: Worker<SendCapiJobData, SendCapiJobResult>;

  constructor(options: SchedulerOptions) {
    this.options = options;
  }

  /**
   * Acesso à fila de processamento de webhook WA — usada pelas rotas Fastify.
   */
  getProcessWaQueue(): Queue<ProcessWaJobData, ProcessWaJobResult> {
    if (!this.processWaQueue) {
      throw new Error('processWaQueue not initialized — call start() first');
    }
    return this.processWaQueue;
  }

  getSendCapiQueue(): Queue<SendCapiJobData, SendCapiJobResult> {
    if (!this.sendCapiQueue) {
      throw new Error('sendCapiQueue not initialized — call start() first');
    }
    return this.sendCapiQueue;
  }

  getProcessGhlQueue(): Queue<ProcessGhlJobData, ProcessGhlJobResult> {
    if (!this.processGhlQueue) {
      throw new Error('processGhlQueue not initialized — call start() first');
    }
    return this.processGhlQueue;
  }

  async start() {
    await this.startSendCapiQueue();
    await this.startProcessWaQueue();
    await this.startProcessGhlQueue();
    await this.startSyncMeta();

    // Wire: process-wa-webhook + process-ghl-webhook → enfileiram capi events
    const enqueueCapi = async (data: SendCapiJobData) => {
      await this.getSendCapiQueue().add('send-capi', data);
    };
    setCapiEnqueuer(enqueueCapi);
    setGhlCapiEnqueuer(enqueueCapi);
  }

  // ==========================================================================
  // sync-meta (Marketing API)
  // ==========================================================================

  private async startSyncMeta() {
    if (!this.options.metaToken || this.options.metaAccounts.length === 0) {
      log.warn(
        {
          hasToken: !!this.options.metaToken,
          accountCount: this.options.metaAccounts.length,
        },
        'sync-meta disabled (missing token or accounts)',
      );
      return;
    }

    this.syncMetaQueue = new Queue<SyncMetaJobData, SyncMetaJobResult>(QUEUE_SYNC_META, {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      },
    });

    this.syncMetaWorker = new Worker<SyncMetaJobData, SyncMetaJobResult>(
      QUEUE_SYNC_META,
      async (job: Job<SyncMetaJobData, SyncMetaJobResult>) => {
        log.info({ jobId: job.id, name: job.name, data: job.data }, 'sync-meta job started');
        return runSyncMeta(
          {
            token: this.options.metaToken!,
            accounts: this.options.metaAccounts,
            apiVersion: this.options.metaApiVersion,
            testEventCode: this.options.metaTestEventCode,
          },
          job.data,
        );
      },
      {
        connection: redisConnection,
        concurrency: 1,
        lockDuration: 10 * 60 * 1000,
      },
    );

    this.syncMetaWorker.on('completed', (job, result) => {
      log.info({ jobId: job.id, queue: QUEUE_SYNC_META, result }, 'job completed');
    });
    this.syncMetaWorker.on('failed', (job, err) => {
      log.error(
        { jobId: job?.id, queue: QUEUE_SYNC_META, attempts: job?.attemptsMade, err: err.message },
        'job failed',
      );
    });

    await this.syncMetaQueue.add(
      'sync-meta-hourly',
      {},
      {
        repeat: { pattern: '5 * * * *' },
        jobId: 'sync-meta-hourly',
      },
    );

    log.info(
      { accounts: this.options.metaAccounts.length, cron: '5 * * * *' },
      'sync-meta scheduled',
    );
  }

  async triggerSync(data: SyncMetaJobData = {}): Promise<{ jobId: string | undefined }> {
    if (!this.syncMetaQueue) {
      throw new Error('sync-meta queue not initialized');
    }
    const job = await this.syncMetaQueue.add('sync-meta-manual', data);
    return { jobId: job.id };
  }

  // ==========================================================================
  // process-wa-webhook (WhatsApp)
  // ==========================================================================

  private async startProcessWaQueue() {
    this.processWaQueue = new Queue<ProcessWaJobData, ProcessWaJobResult>(QUEUE_PROCESS_WA, {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    });

    this.processWaWorker = new Worker<ProcessWaJobData, ProcessWaJobResult>(
      QUEUE_PROCESS_WA,
      async (job: Job<ProcessWaJobData, ProcessWaJobResult>) => {
        return processWaWebhook(job.data);
      },
      {
        connection: redisConnection,
        concurrency: 5, // múltiplas mensagens em paralelo
        lockDuration: 60_000,
      },
    );

    this.processWaWorker.on('completed', (job, result) => {
      log.debug({ jobId: job.id, queue: QUEUE_PROCESS_WA, result }, 'wa webhook processed');
    });
    this.processWaWorker.on('failed', (job, err) => {
      log.error(
        { jobId: job?.id, queue: QUEUE_PROCESS_WA, attempts: job?.attemptsMade, err: err.message },
        'wa webhook processing failed',
      );
    });

    log.info('process-wa-webhook worker started');
  }

  // ==========================================================================
  // process-ghl-webhook (Go High Level)
  // ==========================================================================

  private async startProcessGhlQueue() {
    this.processGhlQueue = new Queue<ProcessGhlJobData, ProcessGhlJobResult>(QUEUE_PROCESS_GHL, {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    });

    this.processGhlWorker = new Worker<ProcessGhlJobData, ProcessGhlJobResult>(
      QUEUE_PROCESS_GHL,
      async (job: Job<ProcessGhlJobData, ProcessGhlJobResult>) => {
        return processGhlWebhook(job.data, {
          ghlToken: this.options.ghlToken,
          ghlLocationId: this.options.ghlLocationId,
        });
      },
      {
        connection: redisConnection,
        concurrency: 5,
        lockDuration: 60_000,
      },
    );

    this.processGhlWorker.on('completed', (job, result) => {
      log.debug({ jobId: job.id, queue: QUEUE_PROCESS_GHL, result }, 'ghl webhook processed');
    });
    this.processGhlWorker.on('failed', (job, err) => {
      log.error(
        { jobId: job?.id, queue: QUEUE_PROCESS_GHL, attempts: job?.attemptsMade, err: err.message },
        'ghl webhook processing failed',
      );
    });

    log.info({ hasToken: !!this.options.ghlToken }, 'process-ghl-webhook worker started');
  }

  // ==========================================================================
  // send-capi-event (Meta Conversions API)
  // ==========================================================================

  private async startSendCapiQueue() {
    if (!this.options.metaToken) {
      log.warn('send-capi-event disabled (no META_SYSTEM_USER_TOKEN)');
      return;
    }

    this.sendCapiQueue = new Queue<SendCapiJobData, SendCapiJobResult>(QUEUE_SEND_CAPI, {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 500 },
      },
    });

    this.sendCapiWorker = new Worker<SendCapiJobData, SendCapiJobResult>(
      QUEUE_SEND_CAPI,
      async (job: Job<SendCapiJobData, SendCapiJobResult>) => {
        return sendCapiEvent(job.data, {
          metaToken: this.options.metaToken!,
          metaAccounts: this.options.metaAccounts,
          metaApiVersion: this.options.metaApiVersion,
          metaTestEventCode: this.options.metaTestEventCode,
          dryRun: this.options.metaCapiDryRun,
        });
      },
      {
        connection: redisConnection,
        concurrency: 5,
        lockDuration: 30_000,
      },
    );

    this.sendCapiWorker.on('completed', (job, result) => {
      log.info(
        {
          jobId: job.id,
          queue: QUEUE_SEND_CAPI,
          eventName: result.eventName,
          status: result.status,
        },
        'capi job completed',
      );
    });
    this.sendCapiWorker.on('failed', (job, err) => {
      log.error(
        { jobId: job?.id, queue: QUEUE_SEND_CAPI, attempts: job?.attemptsMade, err: err.message },
        'capi job failed',
      );
    });

    log.info('send-capi-event worker started');
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async stop() {
    await Promise.all([
      this.syncMetaWorker?.close(),
      this.syncMetaQueue?.close(),
      this.processWaWorker?.close(),
      this.processWaQueue?.close(),
      this.processGhlWorker?.close(),
      this.processGhlQueue?.close(),
      this.sendCapiWorker?.close(),
      this.sendCapiQueue?.close(),
    ]);
  }
}
