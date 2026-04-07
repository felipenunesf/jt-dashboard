import { db } from '@jt/db';
import { sql } from 'drizzle-orm';
import type { LeadSource, QueryFilters } from './overview';

export interface LeadRow {
  id: string;
  source: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  attribution_method: string | null;
  ad_id: string | null;
  ad_name: string | null;
  campaign_name: string | null;
  ctwa_clid: string | null;
  fbclid: string | null;
  wa_instance: string | null;
  ghl_opportunity_id: string | null;
  qualified_at: string | null;
  purchased_at: string | null;
  purchase_value: string | null;
  first_seen_at: string;
}

/**
 * Lista leads com filtro de período + origem + busca opcional.
 */
export async function listLeads(filters: QueryFilters & { search?: string }): Promise<LeadRow[]> {
  const { from, to, source, search } = filters;

  const sourceFilter =
    source === 'whatsapp'
      ? sql`AND l.source = 'whatsapp'`
      : source === 'site_ghl'
        ? sql`AND l.source = 'site_ghl'`
        : sql``;

  const searchFilter = search
    ? sql`AND (
        l.name ILIKE ${`%${search}%`}
        OR l.phone ILIKE ${`%${search}%`}
        OR l.email ILIKE ${`%${search}%`}
      )`
    : sql``;

  const result = await db.execute<{
    id: string;
    source: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    status: string;
    attribution_method: string | null;
    ad_id: string | null;
    ad_name: string | null;
    campaign_name: string | null;
    ctwa_clid: string | null;
    fbclid: string | null;
    wa_instance: string | null;
    ghl_opportunity_id: string | null;
    qualified_at: string | null;
    purchased_at: string | null;
    purchase_value: string | null;
    first_seen_at: string;
  }>(sql`
    SELECT
      l.id,
      l.source,
      l.name,
      l.phone,
      l.email,
      l.status,
      l.attribution_method,
      l.ad_id,
      m.ad_name,
      m.campaign_name,
      l.ctwa_clid,
      l.fbclid,
      l.wa_instance,
      l.ghl_opportunity_id,
      l.qualified_at::text AS qualified_at,
      l.purchased_at::text AS purchased_at,
      l.purchase_value::text AS purchase_value,
      l.first_seen_at::text AS first_seen_at
    FROM leads l
    LEFT JOIN meta_ads m ON m.ad_id = l.ad_id
    WHERE l.first_seen_at::date BETWEEN ${from}::date AND ${to}::date
      ${sourceFilter}
      ${searchFilter}
    ORDER BY l.first_seen_at DESC
    LIMIT 500
  `);

  return result.map((row) => ({ ...row }));
}

/**
 * Lista leads de um anúncio específico (para drill-down).
 */
export async function listLeadsByAd(adId: string, range: { from: string; to: string }): Promise<LeadRow[]> {
  const result = await db.execute<LeadRow & Record<string, unknown>>(sql`
    SELECT
      l.id,
      l.source,
      l.name,
      l.phone,
      l.email,
      l.status,
      l.attribution_method,
      l.ad_id,
      m.ad_name,
      m.campaign_name,
      l.ctwa_clid,
      l.fbclid,
      l.wa_instance,
      l.ghl_opportunity_id,
      l.qualified_at::text AS qualified_at,
      l.purchased_at::text AS purchased_at,
      l.purchase_value::text AS purchase_value,
      l.first_seen_at::text AS first_seen_at
    FROM leads l
    LEFT JOIN meta_ads m ON m.ad_id = l.ad_id
    WHERE l.ad_id = ${adId}
      AND l.first_seen_at::date BETWEEN ${range.from}::date AND ${range.to}::date
    ORDER BY l.first_seen_at DESC
    LIMIT 200
  `);

  return result.map((row) => ({ ...row }));
}

export interface MessageRow {
  id: string;
  direction: string | null;
  text: string | null;
  classification: string | null;
  received_at: string | null;
}

/**
 * Mensagens de um lead WhatsApp (drill-down do lead).
 */
export async function listMessagesByLead(leadId: string): Promise<MessageRow[]> {
  const result = await db.execute<MessageRow & Record<string, unknown>>(sql`
    SELECT
      id,
      direction,
      text,
      classification,
      received_at::text AS received_at
    FROM messages
    WHERE lead_id = ${leadId}
    ORDER BY received_at ASC
    LIMIT 200
  `);

  return result.map((row) => ({ ...row }));
}
