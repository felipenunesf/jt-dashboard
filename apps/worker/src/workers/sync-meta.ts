import { db, insightsDaily, metaAds, type NewInsightDaily, type NewMetaAd } from '@jt/db';
import type { MetaAccount } from '@jt/shared';
import { sql } from 'drizzle-orm';
import { logger } from '../lib/logger.js';
import {
  MetaApiClient,
  extractPixelAndPage,
  flattenActions,
  normalizeAccountId,
  resolveCreativeThumbnail,
  type MetaInsightRaw,
} from '../services/meta-marketing.js';

const log = logger.child({ module: 'sync-meta' });

// ============================================================================
// Types
// ============================================================================

export interface SyncMetaJobData {
  /** Quantos dias atrás carregar quando for o primeiro sync (sem dados). */
  backfillDays?: number;
}

export interface SyncMetaJobResult {
  ads_synced: number;
  insights_rows: number;
  accounts: number;
  duration_ms: number;
}

// ============================================================================
// Helper utils
// ============================================================================

function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    out.push(toIsoDay(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function parseNumeric(value: string | undefined | null): string | null {
  if (value === undefined || value === null || value === '') return null;
  return value;
}

function parseInteger(value: string | undefined | null): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// ============================================================================
// Catálogo
// ============================================================================

/**
 * Sincroniza ads + creatives + tracking_specs (pixel/page) para uma conta.
 * Upsert em meta_ads, denormalizando campaign/adset names no row do ad.
 */
export async function syncCatalogForAccount(
  client: MetaApiClient,
  account: MetaAccount,
): Promise<number> {
  const accountId = normalizeAccountId(account.account_id);
  log.info({ accountId, name: account.name }, 'syncing catalog');

  const ads = await client.listAds(accountId);
  log.debug({ count: ads.length, accountId }, 'fetched ads');

  // Identifica quais ads precisam de creative fetch (sem thumbnail no DB ou novos)
  const existingThumbnails = await db
    .select({ adId: metaAds.adId, thumbnailUrl: metaAds.thumbnailUrl, pixelId: metaAds.pixelId })
    .from(metaAds)
    .where(sql`account_id = ${accountId}`);
  const existingMap = new Map(existingThumbnails.map((row) => [row.adId, row]));

  const upsertRows: NewMetaAd[] = [];

  for (const ad of ads) {
    const existing = existingMap.get(ad.id);

    let thumbnailUrl: string | null | undefined = existing?.thumbnailUrl;
    let permalinkUrl: string | null = null;

    // Fetch creative apenas se ainda não temos thumbnail OU é primeira vez
    if (ad.creative?.id && !existing?.thumbnailUrl) {
      try {
        const creative = await client.getCreative(ad.creative.id);
        thumbnailUrl = resolveCreativeThumbnail(creative) ?? null;
        permalinkUrl = creative.instagram_permalink_url ?? null;
      } catch (err) {
        log.warn({ adId: ad.id, err: (err as Error).message }, 'failed to fetch creative');
      }
    }

    // Fetch tracking_specs apenas se ainda não temos pixel_id
    let pixelId: string | null | undefined = existing?.pixelId;
    let pageId: string | null = null;

    if (!existing?.pixelId) {
      try {
        const specs = await client.getAdTrackingSpecs(ad.id);
        const extracted = extractPixelAndPage(specs);
        pixelId = extracted.pixelId ?? null;
        pageId = extracted.pageId ?? null;
      } catch (err) {
        log.warn({ adId: ad.id, err: (err as Error).message }, 'failed to fetch tracking_specs');
      }
    }

    // Resolve destination_type a partir do adset
    const destinationType = mapDestinationType(ad.adset?.destination_type);

    upsertRows.push({
      adId: ad.id,
      adName: ad.name ?? null,
      adsetId: ad.adset?.id ?? null,
      adsetName: ad.adset?.name ?? null,
      campaignId: ad.campaign?.id ?? null,
      campaignName: ad.campaign?.name ?? null,
      accountId,
      status: ad.effective_status ?? ad.status ?? null,
      destinationType,
      thumbnailUrl: thumbnailUrl ?? null,
      permalinkUrl,
      pixelId: pixelId ?? null,
      pageId,
    });
  }

  if (upsertRows.length === 0) {
    log.info({ accountId }, 'no ads to upsert');
    return 0;
  }

  // Upsert em batch — ON CONFLICT (ad_id) DO UPDATE
  await db
    .insert(metaAds)
    .values(upsertRows)
    .onConflictDoUpdate({
      target: metaAds.adId,
      set: {
        adName: sql`excluded.ad_name`,
        adsetId: sql`excluded.adset_id`,
        adsetName: sql`excluded.adset_name`,
        campaignId: sql`excluded.campaign_id`,
        campaignName: sql`excluded.campaign_name`,
        accountId: sql`excluded.account_id`,
        status: sql`excluded.status`,
        destinationType: sql`excluded.destination_type`,
        // Não sobrescreve thumbnail/pixel se já existirem (já foram resolvidos)
        thumbnailUrl: sql`COALESCE(${metaAds.thumbnailUrl}, excluded.thumbnail_url)`,
        permalinkUrl: sql`COALESCE(${metaAds.permalinkUrl}, excluded.permalink_url)`,
        pixelId: sql`COALESCE(${metaAds.pixelId}, excluded.pixel_id)`,
        pageId: sql`COALESCE(${metaAds.pageId}, excluded.page_id)`,
        updatedAt: sql`NOW()`,
      },
    });

  log.info({ accountId, upserted: upsertRows.length }, 'catalog synced');
  return upsertRows.length;
}

function mapDestinationType(meta: string | undefined): 'whatsapp' | 'website' | null {
  if (!meta) return null;
  const upper = meta.toUpperCase();
  if (upper.includes('WHATSAPP') || upper === 'MESSAGING_INSTAGRAM_DIRECT') return 'whatsapp';
  if (upper.includes('WEBSITE') || upper === 'OFF_SITE') return 'website';
  return null;
}

// ============================================================================
// Insights
// ============================================================================

/**
 * Determina a janela de dias a sincronizar.
 * - Se nunca sincronizamos: últimos N dias (default 30)
 * - Caso contrário: do max(date) até hoje (re-sincroniza dia atual sempre)
 */
async function determineSyncWindow(backfillDays = 30): Promise<string[]> {
  const result = await db.execute<{ max_date: string | null }>(
    sql`SELECT MAX(date)::text AS max_date FROM insights_daily`,
  );
  const maxDate = result[0]?.max_date ?? null;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  let start: Date;
  if (maxDate) {
    start = new Date(`${maxDate}T00:00:00Z`);
  } else {
    start = new Date(today);
    start.setUTCDate(start.getUTCDate() - backfillDays);
  }

  return daysBetween(start, today);
}

/**
 * Sincroniza insights diários para uma conta no range fornecido.
 * Insights podem retornar ads DELETED/ARCHIVED que não estão em meta_ads —
 * filtramos esses antes do insert para respeitar a FK.
 */
export async function syncInsightsForAccount(
  client: MetaApiClient,
  account: MetaAccount,
  days: string[],
): Promise<number> {
  const accountId = normalizeAccountId(account.account_id);
  log.info({ accountId, days: days.length }, 'syncing insights');

  // Carrega o set de ads conhecidos desta conta uma vez
  const knownAdRows = await db
    .select({ adId: metaAds.adId })
    .from(metaAds)
    .where(sql`account_id = ${accountId}`);
  const knownAdIds = new Set(knownAdRows.map((r) => r.adId));
  log.debug({ accountId, knownAds: knownAdIds.size }, 'loaded known ads');

  let totalRows = 0;

  for (const day of days) {
    let insights: MetaInsightRaw[] = [];
    try {
      insights = await client.getInsightsForDay(accountId, day);
    } catch (err) {
      log.error({ accountId, day, err: (err as Error).message }, 'insights fetch failed');
      continue;
    }

    if (insights.length === 0) {
      log.debug({ accountId, day }, 'no insights for day');
      continue;
    }

    // Auto-stub pra ads desconhecidos: cria meta_ads mínimo pra satisfazer FK
    // e não perder spend histórico. Acontece quando o catalog sync ainda não
    // pegou o ad (primeira rodada) ou quando o ad foi criado/deletado rapidamente.
    const unknownAdIds = new Set<string>();
    for (const insight of insights) {
      if (!knownAdIds.has(insight.ad_id)) {
        unknownAdIds.add(insight.ad_id);
      }
    }

    if (unknownAdIds.size > 0) {
      const stubRows: NewMetaAd[] = Array.from(unknownAdIds).map((adId) => ({
        adId,
        accountId,
        status: 'UNKNOWN',
        adName: null,
        adsetId: null,
        adsetName: null,
        campaignId: null,
        campaignName: null,
        destinationType: null,
      }));
      await db.insert(metaAds).values(stubRows).onConflictDoNothing({ target: metaAds.adId });
      for (const id of unknownAdIds) knownAdIds.add(id);
      log.info({ accountId, day, stubbed: unknownAdIds.size }, 'auto-stubbed unknown ads');
    }

    const filtered = insights;

    if (filtered.length === 0) continue;

    const rows: NewInsightDaily[] = filtered.map((insight) => {
      const actions = flattenActions(insight.actions);
      // landing_page_view e messaging vêm como action_type, não como field direto
      const messagingStarted = parseInteger(
        actions['onsite_conversion.messaging_conversation_started_7d'],
      );
      const landingPageViews = parseInteger(actions['landing_page_view']);
      return {
        adId: insight.ad_id,
        date: insight.date_start,
        spend: parseNumeric(insight.spend),
        impressions: parseInteger(insight.impressions),
        reach: parseInteger(insight.reach),
        clicks: parseInteger(insight.inline_link_clicks),
        uniqueClicks: parseInteger(insight.unique_inline_link_clicks),
        ctr: parseNumeric(insight.ctr),
        cpc: parseNumeric(insight.cpc),
        frequency: parseNumeric(insight.frequency),
        messagingStarted,
        landingPageViews,
        raw: insight as unknown as Record<string, unknown>,
      };
    });

    // Upsert em batch
    await db
      .insert(insightsDaily)
      .values(rows)
      .onConflictDoUpdate({
        target: [insightsDaily.adId, insightsDaily.date],
        set: {
          spend: sql`excluded.spend`,
          impressions: sql`excluded.impressions`,
          reach: sql`excluded.reach`,
          clicks: sql`excluded.clicks`,
          uniqueClicks: sql`excluded.unique_clicks`,
          ctr: sql`excluded.ctr`,
          cpc: sql`excluded.cpc`,
          frequency: sql`excluded.frequency`,
          messagingStarted: sql`excluded.messaging_started`,
          landingPageViews: sql`excluded.landing_page_views`,
          raw: sql`excluded.raw`,
          fetchedAt: sql`NOW()`,
        },
      });

    totalRows += rows.length;
  }

  log.info({ accountId, totalRows }, 'insights synced');
  return totalRows;
}

// ============================================================================
// Job entrypoint
// ============================================================================

export interface SyncMetaContext {
  token: string;
  accounts: MetaAccount[];
  apiVersion: string;
  testEventCode?: string;
}

/**
 * Roda o sync completo: catálogo + insights, para todas as contas.
 * Idempotente: pode rodar múltiplas vezes sem duplicação.
 */
export async function runSyncMeta(
  context: SyncMetaContext,
  data: SyncMetaJobData = {},
): Promise<SyncMetaJobResult> {
  const start = Date.now();

  if (context.accounts.length === 0) {
    log.warn('no accounts configured, skipping sync');
    return { ads_synced: 0, insights_rows: 0, accounts: 0, duration_ms: 0 };
  }

  const client = new MetaApiClient({
    accessToken: context.token,
    apiVersion: context.apiVersion,
    testEventCode: context.testEventCode,
  });

  let adsSynced = 0;
  let insightsRows = 0;

  for (const account of context.accounts) {
    try {
      adsSynced += await syncCatalogForAccount(client, account);
    } catch (err) {
      log.error({ account: account.name, err: (err as Error).message }, 'catalog sync failed');
    }
  }

  // Após o catálogo, determinar janela e sincronizar insights
  const days = await determineSyncWindow(data.backfillDays);
  log.info({ days: days.length, first: days[0], last: days[days.length - 1] }, 'sync window');

  for (const account of context.accounts) {
    try {
      insightsRows += await syncInsightsForAccount(client, account, days);
    } catch (err) {
      log.error({ account: account.name, err: (err as Error).message }, 'insights sync failed');
    }
  }

  const result: SyncMetaJobResult = {
    ads_synced: adsSynced,
    insights_rows: insightsRows,
    accounts: context.accounts.length,
    duration_ms: Date.now() - start,
  };

  log.info(result, 'sync-meta complete');
  return result;
}
