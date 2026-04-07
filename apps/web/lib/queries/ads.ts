import { db } from '@jt/db';
import { sql } from 'drizzle-orm';
import type { LeadSource, QueryFilters } from './overview';

export interface AdRow {
  ad_id: string;
  ad_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  account_id: string | null;
  status: string | null;
  destination_type: string | null;
  thumbnail_url: string | null;
  permalink_url: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  messaging_started: number;
  leads: number;
  qualified: number;
  purchases: number;
  cpl: number | null;
  cpl_qualified: number | null;
}

/**
 * Lista todos os ads (com métricas no range) que tiveram gasto OU leads OU
 * estão ACTIVE. Inclui ads pausados que tiveram tráfego no período.
 */
export async function getAdsWithMetrics(filters: QueryFilters): Promise<AdRow[]> {
  const { from, to, source } = filters;
  const adDestFilter =
    source === 'whatsapp'
      ? sql`AND m.destination_type = 'whatsapp'`
      : source === 'site_ghl'
        ? sql`AND m.destination_type = 'website'`
        : sql``;
  const leadSourceFilter =
    source === 'whatsapp'
      ? sql`AND source = 'whatsapp'`
      : source === 'site_ghl'
        ? sql`AND source = 'site_ghl'`
        : sql``;
  const result = await db.execute<{
    ad_id: string;
    ad_name: string | null;
    adset_id: string | null;
    adset_name: string | null;
    campaign_id: string | null;
    campaign_name: string | null;
    account_id: string | null;
    status: string | null;
    destination_type: string | null;
    thumbnail_url: string | null;
    permalink_url: string | null;
    spend: string | null;
    impressions: string | null;
    clicks: string | null;
    messaging_started: string | null;
    leads: string | null;
    qualified: string | null;
    purchases: string | null;
  }>(sql`
    SELECT
      m.ad_id,
      m.ad_name,
      m.adset_id,
      m.adset_name,
      m.campaign_id,
      m.campaign_name,
      m.account_id,
      m.status,
      m.destination_type,
      m.thumbnail_url,
      m.permalink_url,
      COALESCE(i.spend, 0)::text AS spend,
      COALESCE(i.impressions, 0)::text AS impressions,
      COALESCE(i.clicks, 0)::text AS clicks,
      COALESCE(i.messaging_started, 0)::text AS messaging_started,
      COALESCE(l.leads, 0)::text AS leads,
      COALESCE(l.qualified, 0)::text AS qualified,
      COALESCE(l.purchases, 0)::text AS purchases
    FROM meta_ads m
    LEFT JOIN (
      SELECT
        ad_id,
        SUM(spend) AS spend,
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks,
        SUM(messaging_started) AS messaging_started
      FROM insights_daily
      WHERE date BETWEEN ${from}::date AND ${to}::date
      GROUP BY ad_id
    ) i ON i.ad_id = m.ad_id
    LEFT JOIN (
      SELECT
        ad_id,
        COUNT(*) FILTER (WHERE status IN ('opened','qualified','purchased')) AS leads,
        COUNT(*) FILTER (WHERE status IN ('qualified','purchased')) AS qualified,
        COUNT(*) FILTER (WHERE status = 'purchased') AS purchases
      FROM leads
      WHERE ad_id IS NOT NULL
        AND first_seen_at::date BETWEEN ${from}::date AND ${to}::date
        ${leadSourceFilter}
      GROUP BY ad_id
    ) l ON l.ad_id = m.ad_id
    WHERE (COALESCE(i.spend, 0) > 0
       OR COALESCE(l.leads, 0) > 0
       OR m.status = 'ACTIVE')
      ${adDestFilter}
    ORDER BY COALESCE(i.spend, 0) DESC NULLS LAST
  `);

  return result.map((row) => {
    const spend = Number(row.spend ?? 0);
    const impressions = Number(row.impressions ?? 0);
    const clicks = Number(row.clicks ?? 0);
    const leads = Number(row.leads ?? 0);
    const qualified = Number(row.qualified ?? 0);

    return {
      ad_id: row.ad_id,
      ad_name: row.ad_name,
      adset_id: row.adset_id,
      adset_name: row.adset_name,
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      account_id: row.account_id,
      status: row.status,
      destination_type: row.destination_type,
      thumbnail_url: row.thumbnail_url,
      permalink_url: row.permalink_url,
      spend,
      impressions,
      clicks,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      messaging_started: Number(row.messaging_started ?? 0),
      leads,
      qualified,
      purchases: Number(row.purchases ?? 0),
      cpl: leads > 0 ? spend / leads : null,
      cpl_qualified: qualified > 0 ? spend / qualified : null,
    };
  });
}

/**
 * Busca um ad específico com métricas e suas associações.
 * Usado na página de drill-down /ads/[adId].
 */
export async function getAdById(adId: string, range: { from: string; to: string }): Promise<AdRow | null> {
  const result = await db.execute<{
    ad_id: string;
    ad_name: string | null;
    adset_id: string | null;
    adset_name: string | null;
    campaign_id: string | null;
    campaign_name: string | null;
    account_id: string | null;
    status: string | null;
    destination_type: string | null;
    thumbnail_url: string | null;
    permalink_url: string | null;
    spend: string | null;
    impressions: string | null;
    clicks: string | null;
    messaging_started: string | null;
    leads: string | null;
    qualified: string | null;
    purchases: string | null;
  }>(sql`
    SELECT
      m.ad_id, m.ad_name, m.adset_id, m.adset_name, m.campaign_id, m.campaign_name,
      m.account_id, m.status, m.destination_type, m.thumbnail_url, m.permalink_url,
      COALESCE(i.spend, 0)::text AS spend,
      COALESCE(i.impressions, 0)::text AS impressions,
      COALESCE(i.clicks, 0)::text AS clicks,
      COALESCE(i.messaging_started, 0)::text AS messaging_started,
      COALESCE(l.leads, 0)::text AS leads,
      COALESCE(l.qualified, 0)::text AS qualified,
      COALESCE(l.purchases, 0)::text AS purchases
    FROM meta_ads m
    LEFT JOIN (
      SELECT ad_id, SUM(spend) AS spend, SUM(impressions) AS impressions,
             SUM(clicks) AS clicks, SUM(messaging_started) AS messaging_started
      FROM insights_daily
      WHERE ad_id = ${adId} AND date BETWEEN ${range.from}::date AND ${range.to}::date
      GROUP BY ad_id
    ) i ON i.ad_id = m.ad_id
    LEFT JOIN (
      SELECT ad_id,
             COUNT(*) FILTER (WHERE status IN ('opened','qualified','purchased')) AS leads,
             COUNT(*) FILTER (WHERE status IN ('qualified','purchased')) AS qualified,
             COUNT(*) FILTER (WHERE status = 'purchased') AS purchases
      FROM leads
      WHERE ad_id = ${adId} AND first_seen_at::date BETWEEN ${range.from}::date AND ${range.to}::date
      GROUP BY ad_id
    ) l ON l.ad_id = m.ad_id
    WHERE m.ad_id = ${adId}
    LIMIT 1
  `);

  const row = result[0];
  if (!row) return null;

  const spend = Number(row.spend ?? 0);
  const impressions = Number(row.impressions ?? 0);
  const clicks = Number(row.clicks ?? 0);
  const leads = Number(row.leads ?? 0);
  const qualified = Number(row.qualified ?? 0);

  return {
    ad_id: row.ad_id,
    ad_name: row.ad_name,
    adset_id: row.adset_id,
    adset_name: row.adset_name,
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name,
    account_id: row.account_id,
    status: row.status,
    destination_type: row.destination_type,
    thumbnail_url: row.thumbnail_url,
    permalink_url: row.permalink_url,
    spend,
    impressions,
    clicks,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    messaging_started: Number(row.messaging_started ?? 0),
    leads,
    qualified,
    purchases: Number(row.purchases ?? 0),
    cpl: leads > 0 ? spend / leads : null,
    cpl_qualified: qualified > 0 ? spend / qualified : null,
  };
}

export interface CampaignNode {
  campaign_id: string;
  campaign_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  messaging_started: number;
  leads: number;
  qualified: number;
  cpl_qualified: number | null;
  adsets: AdsetNode[];
}

export interface AdsetNode {
  adset_id: string;
  adset_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  messaging_started: number;
  leads: number;
  qualified: number;
  cpl_qualified: number | null;
  ads: AdRow[];
}

/**
 * Agrega ads em estrutura hierárquica Campanha → Conjunto → Anúncio.
 */
export function buildHierarchy(ads: AdRow[]): CampaignNode[] {
  const campaignMap = new Map<string, CampaignNode>();

  for (const ad of ads) {
    const campaignId = ad.campaign_id ?? '__no_campaign';
    const campaignName = ad.campaign_name ?? '(Sem campanha)';
    const adsetId = ad.adset_id ?? '__no_adset';
    const adsetName = ad.adset_name ?? '(Sem conjunto)';

    let campaign = campaignMap.get(campaignId);
    if (!campaign) {
      campaign = {
        campaign_id: campaignId,
        campaign_name: campaignName,
        spend: 0,
        impressions: 0,
        clicks: 0,
        ctr: 0,
        messaging_started: 0,
        leads: 0,
        qualified: 0,
        cpl_qualified: null,
        adsets: [],
      };
      campaignMap.set(campaignId, campaign);
    }

    let adset = campaign.adsets.find((a) => a.adset_id === adsetId);
    if (!adset) {
      adset = {
        adset_id: adsetId,
        adset_name: adsetName,
        spend: 0,
        impressions: 0,
        clicks: 0,
        messaging_started: 0,
        leads: 0,
        qualified: 0,
        cpl_qualified: null,
        ads: [],
      };
      campaign.adsets.push(adset);
    }

    adset.ads.push(ad);
    adset.spend += ad.spend;
    adset.impressions += ad.impressions;
    adset.clicks += ad.clicks;
    adset.messaging_started += ad.messaging_started;
    adset.leads += ad.leads;
    adset.qualified += ad.qualified;

    campaign.spend += ad.spend;
    campaign.impressions += ad.impressions;
    campaign.clicks += ad.clicks;
    campaign.messaging_started += ad.messaging_started;
    campaign.leads += ad.leads;
    campaign.qualified += ad.qualified;
  }

  // Calcula derivados
  for (const campaign of campaignMap.values()) {
    campaign.ctr =
      campaign.impressions > 0 ? (campaign.clicks / campaign.impressions) * 100 : 0;
    campaign.cpl_qualified = campaign.qualified > 0 ? campaign.spend / campaign.qualified : null;

    for (const adset of campaign.adsets) {
      adset.cpl_qualified = adset.qualified > 0 ? adset.spend / adset.qualified : null;
      adset.ads.sort((a, b) => b.spend - a.spend);
    }
    campaign.adsets.sort((a, b) => b.spend - a.spend);
  }

  return Array.from(campaignMap.values()).sort((a, b) => b.spend - a.spend);
}
