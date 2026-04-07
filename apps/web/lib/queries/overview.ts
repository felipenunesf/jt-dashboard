import { db } from '@jt/db';
import { sql, type SQL } from 'drizzle-orm';

export type LeadSource = 'all' | 'whatsapp' | 'site_ghl';

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

export interface QueryFilters extends DateRange {
  source: LeadSource;
}

export interface OverviewKpis {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  messagingStarted: number;
  leads: number;
  qualified: number;
  purchases: number;
  revenue: number;
  cpl: number | null;
  cplQualified: number | null;
  roas: number | null;
}

/**
 * Filtros condicionais por origem:
 * - all: sem filtro (todos os ads + todos os leads)
 * - whatsapp: ads.destination_type='whatsapp' + leads.source='whatsapp'
 * - site_ghl: ads.destination_type='website' + leads.source='site_ghl'
 *
 * Ads sem destination_type só aparecem em "all" (intencional — não temos
 * como saber a origem deles).
 */
function adDestinationFilter(source: LeadSource): SQL | undefined {
  if (source === 'whatsapp') return sql`destination_type = 'whatsapp'`;
  if (source === 'site_ghl') return sql`destination_type = 'website'`;
  return undefined;
}

function leadSourceFilter(source: LeadSource): SQL | undefined {
  if (source === 'whatsapp') return sql`source = 'whatsapp'`;
  if (source === 'site_ghl') return sql`source = 'site_ghl'`;
  return undefined;
}

export async function getOverviewKpis(filters: QueryFilters): Promise<OverviewKpis> {
  const adFilter = adDestinationFilter(filters.source);
  const leadFilter = leadSourceFilter(filters.source);

  const adWhereClause = adFilter ? sql`AND ad_id IN (SELECT ad_id FROM meta_ads WHERE ${adFilter})` : sql``;
  const leadWhereClause = leadFilter ? sql`AND ${leadFilter}` : sql``;

  const result = await db.execute<{
    spend: string | null;
    impressions: string | null;
    clicks: string | null;
    messaging_started: string | null;
    leads: string | null;
    qualified: string | null;
    purchases: string | null;
    revenue: string | null;
  }>(sql`
    WITH ad_metrics AS (
      SELECT
        COALESCE(SUM(spend), 0) AS spend,
        COALESCE(SUM(impressions), 0) AS impressions,
        COALESCE(SUM(clicks), 0) AS clicks,
        COALESCE(SUM(messaging_started), 0) AS messaging_started
      FROM insights_daily
      WHERE date BETWEEN ${filters.from}::date AND ${filters.to}::date
        ${adWhereClause}
    ),
    lead_metrics AS (
      SELECT
        COUNT(*) FILTER (WHERE status IN ('opened','qualified','purchased')) AS leads,
        COUNT(*) FILTER (WHERE status IN ('qualified','purchased')) AS qualified,
        COUNT(*) FILTER (WHERE status = 'purchased') AS purchases,
        COALESCE(SUM(purchase_value) FILTER (WHERE status = 'purchased'), 0) AS revenue
      FROM leads
      WHERE first_seen_at::date BETWEEN ${filters.from}::date AND ${filters.to}::date
        ${leadWhereClause}
    )
    SELECT
      a.spend, a.impressions, a.clicks, a.messaging_started,
      l.leads, l.qualified, l.purchases, l.revenue
    FROM ad_metrics a CROSS JOIN lead_metrics l
  `);

  const row = result[0];
  if (!row) return emptyKpis();

  const spend = Number(row.spend ?? 0);
  const impressions = Number(row.impressions ?? 0);
  const clicks = Number(row.clicks ?? 0);
  const messagingStarted = Number(row.messaging_started ?? 0);
  const leads = Number(row.leads ?? 0);
  const qualified = Number(row.qualified ?? 0);
  const purchases = Number(row.purchases ?? 0);
  const revenue = Number(row.revenue ?? 0);

  return {
    spend,
    impressions,
    clicks,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    messagingStarted,
    leads,
    qualified,
    purchases,
    revenue,
    cpl: leads > 0 ? spend / leads : null,
    cplQualified: qualified > 0 ? spend / qualified : null,
    roas: spend > 0 && revenue > 0 ? revenue / spend : null,
  };
}

function emptyKpis(): OverviewKpis {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    ctr: 0,
    cpc: 0,
    messagingStarted: 0,
    leads: 0,
    qualified: 0,
    purchases: 0,
    revenue: 0,
    cpl: null,
    cplQualified: null,
    roas: null,
  };
}

export interface TimeseriesPoint {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  messagingStarted: number;
}

export async function getSpendTimeseries(filters: QueryFilters): Promise<TimeseriesPoint[]> {
  const adFilter = adDestinationFilter(filters.source);
  const adWhereClause = adFilter
    ? sql`AND ad_id IN (SELECT ad_id FROM meta_ads WHERE ${adFilter})`
    : sql``;

  const result = await db.execute<{
    date: string;
    spend: string | null;
    impressions: string | null;
    clicks: string | null;
    messaging_started: string | null;
  }>(sql`
    SELECT
      date::text AS date,
      COALESCE(SUM(spend), 0)::text AS spend,
      COALESCE(SUM(impressions), 0)::text AS impressions,
      COALESCE(SUM(clicks), 0)::text AS clicks,
      COALESCE(SUM(messaging_started), 0)::text AS messaging_started
    FROM insights_daily
    WHERE date BETWEEN ${filters.from}::date AND ${filters.to}::date
      ${adWhereClause}
    GROUP BY date
    ORDER BY date ASC
  `);

  return result.map((row) => ({
    date: row.date,
    spend: Number(row.spend ?? 0),
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    messagingStarted: Number(row.messaging_started ?? 0),
  }));
}

export interface FunnelStage {
  label: string;
  value: number;
  pctOfPrevious: number | null; // % de conversão da etapa anterior
}

/**
 * Funil unificado: impressões → cliques → leads → qualificados → compras.
 * messaging_started fica de fora do funil porque não existe equivalente pra
 * leads de site.
 */
export async function getFunnel(filters: QueryFilters): Promise<FunnelStage[]> {
  const kpis = await getOverviewKpis(filters);

  const stages = [
    { label: 'Impressões', value: kpis.impressions },
    { label: 'Cliques', value: kpis.clicks },
    { label: 'Leads', value: kpis.leads },
    { label: 'Qualificados', value: kpis.qualified },
    { label: 'Compras', value: kpis.purchases },
  ];

  return stages.map((stage, idx): FunnelStage => {
    const prev = idx > 0 ? stages[idx - 1] : null;
    const pct = prev && prev.value > 0 ? (stage.value / prev.value) * 100 : null;
    return {
      label: stage.label,
      value: stage.value,
      pctOfPrevious: pct,
    };
  });
}
