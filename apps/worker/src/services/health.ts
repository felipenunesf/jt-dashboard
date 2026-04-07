import { db, capiEvents, webhookInbox, insightsDaily } from '@jt/db';
import { sql } from 'drizzle-orm';
import { redisConnection } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ module: 'health' });

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthCheck {
  status: HealthStatus;
  service: 'jt-worker';
  timestamp: string;
  uptime_seconds: number;
  checks: {
    db: { ok: boolean; latency_ms: number; error?: string };
    redis: { ok: boolean; latency_ms: number; error?: string };
  };
  metrics: {
    last_meta_sync: string | null;
    last_meta_sync_age_minutes: number | null;
    pending_capi_events: number;
    failed_capi_events_24h: number;
    unprocessed_webhooks: number;
    unprocessed_webhooks_age_minutes: number | null;
  };
}

const startedAt = Date.now();

export async function getHealthStatus(): Promise<HealthCheck> {
  const checks: HealthCheck['checks'] = {
    db: { ok: false, latency_ms: 0 },
    redis: { ok: false, latency_ms: 0 },
  };

  // DB check
  const dbStart = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    checks.db = { ok: true, latency_ms: Date.now() - dbStart };
  } catch (err) {
    checks.db = {
      ok: false,
      latency_ms: Date.now() - dbStart,
      error: (err as Error).message,
    };
    log.warn({ err: (err as Error).message }, 'health: db check failed');
  }

  // Redis check
  const redisStart = Date.now();
  try {
    await redisConnection.ping();
    checks.redis = { ok: true, latency_ms: Date.now() - redisStart };
  } catch (err) {
    checks.redis = {
      ok: false,
      latency_ms: Date.now() - redisStart,
      error: (err as Error).message,
    };
    log.warn({ err: (err as Error).message }, 'health: redis check failed');
  }

  // Metrics (best effort — só tenta se DB tá ok)
  let metrics: HealthCheck['metrics'] = {
    last_meta_sync: null,
    last_meta_sync_age_minutes: null,
    pending_capi_events: 0,
    failed_capi_events_24h: 0,
    unprocessed_webhooks: 0,
    unprocessed_webhooks_age_minutes: null,
  };

  if (checks.db.ok) {
    try {
      metrics = await loadMetrics();
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'health: metrics load failed');
    }
  }

  // Status agregado
  let status: HealthStatus = 'ok';
  if (!checks.db.ok || !checks.redis.ok) {
    status = 'down';
  } else if (
    (metrics.last_meta_sync_age_minutes !== null && metrics.last_meta_sync_age_minutes > 90) ||
    metrics.failed_capi_events_24h > 10 ||
    (metrics.unprocessed_webhooks_age_minutes !== null &&
      metrics.unprocessed_webhooks_age_minutes > 10)
  ) {
    status = 'degraded';
  }

  return {
    status,
    service: 'jt-worker',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    checks,
    metrics,
  };
}

async function loadMetrics(): Promise<HealthCheck['metrics']> {
  const result = await db.execute<{
    last_meta_sync: string | null;
    last_meta_sync_age_minutes: string | null;
    pending_capi_events: string;
    failed_capi_events_24h: string;
    unprocessed_webhooks: string;
    unprocessed_webhooks_age_minutes: string | null;
  }>(sql`
    SELECT
      (SELECT MAX(fetched_at)::text FROM ${insightsDaily}) AS last_meta_sync,
      (SELECT EXTRACT(EPOCH FROM (NOW() - MAX(fetched_at))) / 60 FROM ${insightsDaily})::text AS last_meta_sync_age_minutes,
      (SELECT COUNT(*) FROM ${capiEvents} WHERE status = 'pending')::text AS pending_capi_events,
      (SELECT COUNT(*) FROM ${capiEvents} WHERE status = 'failed' AND created_at > NOW() - INTERVAL '24 hours')::text AS failed_capi_events_24h,
      (SELECT COUNT(*) FROM ${webhookInbox} WHERE processed_at IS NULL)::text AS unprocessed_webhooks,
      (SELECT EXTRACT(EPOCH FROM (NOW() - MIN(received_at))) / 60 FROM ${webhookInbox} WHERE processed_at IS NULL)::text AS unprocessed_webhooks_age_minutes
  `);

  const row = result[0];
  if (!row) {
    return {
      last_meta_sync: null,
      last_meta_sync_age_minutes: null,
      pending_capi_events: 0,
      failed_capi_events_24h: 0,
      unprocessed_webhooks: 0,
      unprocessed_webhooks_age_minutes: null,
    };
  }

  return {
    last_meta_sync: row.last_meta_sync,
    last_meta_sync_age_minutes: row.last_meta_sync_age_minutes
      ? Math.round(Number(row.last_meta_sync_age_minutes) * 10) / 10
      : null,
    pending_capi_events: Number(row.pending_capi_events ?? 0),
    failed_capi_events_24h: Number(row.failed_capi_events_24h ?? 0),
    unprocessed_webhooks: Number(row.unprocessed_webhooks ?? 0),
    unprocessed_webhooks_age_minutes: row.unprocessed_webhooks_age_minutes
      ? Math.round(Number(row.unprocessed_webhooks_age_minutes) * 10) / 10
      : null,
  };
}
