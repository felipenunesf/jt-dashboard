import { parse } from 'csv-parse/sync';
import { and, eq } from 'drizzle-orm';
import { db, leads, metaAds } from '@jt/db';
import { hashPhone, normalizePhone } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ module: 'tintim-import' });

interface TintimRow {
  Origem: string;
  'Nome do Contato': string;
  'WhatsApp do Contato': string;
  'Etapa da Jornada': string;
  'Data da Primeira Mensagem': string;
  'Data da Última Mensagem': string;
  'ID da Campanha de Anúncio': string;
  'ID do Conjunto de Anúncio': string;
  'ID do Anúncio': string;
  'Nome da Campanha de Anúncio': string;
  'Nome do Conjunto de Anúncio': string;
  'Nome do Anúncio': string;
  'Facebook Pixel': string;
  ctwa_clid: string;
  [key: string]: string;
}

export interface ImportResult {
  total: number;
  adsInserted: number;
  leadsInserted: number;
  leadsUpdated: number;
  leadsSkipped: number;
  errors: Array<{ row: number; error: string }>;
}

type LeadStatus = 'opened' | 'qualified' | 'purchased';

function mapStatus(etapa: string): LeadStatus {
  const normalized = etapa?.trim().toLowerCase();
  if (normalized === 'comprou') return 'purchased';
  if (normalized === 'qualificou') return 'qualified';
  return 'opened';
}

/**
 * Parseia data no formato "2026-03-20 10:46:15" assumindo America/Sao_Paulo (UTC-3).
 * Retorna null se vazio/inválido.
 */
function parseTintimDate(s: string): Date | null {
  if (!s || !s.trim()) return null;
  const parts = s.trim().split(' ');
  if (parts.length !== 2) return null;
  const [date, time] = parts;
  // Tintim exporta em America/Sao_Paulo (UTC-3), anexa offset explícito
  const iso = `${date}T${time}-03:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function importTintimCsv(
  csvContent: string,
  waInstance: string,
): Promise<ImportResult> {
  const rows = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as TintimRow[];

  log.info({ rows: rows.length, waInstance }, 'starting tintim import');

  const result: ImportResult = {
    total: rows.length,
    adsInserted: 0,
    leadsInserted: 0,
    leadsUpdated: 0,
    leadsSkipped: 0,
    errors: [],
  };

  for (const [idx, row] of rows.entries()) {
    const rowNum = idx + 2; // +1 header, +1 index
    try {
      const adId = row['ID do Anúncio']?.trim();
      const phoneRaw = row['WhatsApp do Contato']?.trim();

      if (!phoneRaw) {
        result.leadsSkipped++;
        continue;
      }

      // Stub meta_ads se não existir no catálogo
      if (adId) {
        const existing = await db
          .select({ adId: metaAds.adId })
          .from(metaAds)
          .where(eq(metaAds.adId, adId))
          .limit(1);

        if (!existing[0]) {
          await db.insert(metaAds).values({
            adId,
            adName: row['Nome do Anúncio'] || null,
            adsetId: row['ID do Conjunto de Anúncio'] || null,
            adsetName: row['Nome do Conjunto de Anúncio'] || null,
            campaignId: row['ID da Campanha de Anúncio'] || null,
            campaignName: row['Nome da Campanha de Anúncio'] || null,
            accountId: null,
            status: null,
            destinationType: 'whatsapp',
            pixelId: row['Facebook Pixel'] || null,
          });
          result.adsInserted++;
        }
      }

      const phoneNorm = normalizePhone(phoneRaw);
      const phoneHash = hashPhone(phoneRaw);
      const status = mapStatus(row['Etapa da Jornada']);
      const firstSeen = parseTintimDate(row['Data da Primeira Mensagem']);
      const lastSeen = parseTintimDate(row['Data da Última Mensagem']);
      const ctwa = row.ctwa_clid?.trim() || null;
      const attributionMethod: 'ctwa_clid' | 'none' = ctwa ? 'ctwa_clid' : 'none';

      const existingLead = await db
        .select()
        .from(leads)
        .where(
          and(
            eq(leads.source, 'whatsapp'),
            eq(leads.waInstance, waInstance),
            eq(leads.phone, phoneNorm),
          ),
        )
        .limit(1);

      const qualifiedAt = status === 'qualified' || status === 'purchased' ? lastSeen : null;
      const purchasedAt = status === 'purchased' ? lastSeen : null;

      if (existingLead[0]) {
        const current = existingLead[0];
        await db
          .update(leads)
          .set({
            name: row['Nome do Contato'] || current.name,
            status,
            adId: adId || current.adId,
            ctwaClid: ctwa || current.ctwaClid,
            attributionMethod: current.attributionMethod ?? attributionMethod,
            qualifiedAt: current.qualifiedAt ?? qualifiedAt,
            purchasedAt: current.purchasedAt ?? purchasedAt,
            updatedAt: lastSeen ?? new Date(),
            raw: { tintimImport: row },
          })
          .where(eq(leads.id, current.id));
        result.leadsUpdated++;
      } else {
        await db.insert(leads).values({
          source: 'whatsapp',
          name: row['Nome do Contato'] || null,
          phone: phoneNorm,
          phoneHash,
          adId: adId || null,
          ctwaClid: ctwa,
          attributionMethod,
          waInstance,
          status,
          qualifiedAt,
          purchasedAt,
          firstSeenAt: firstSeen ?? new Date(),
          updatedAt: lastSeen ?? new Date(),
          raw: { tintimImport: row },
        });
        result.leadsInserted++;
      }
    } catch (err) {
      result.errors.push({ row: rowNum, error: (err as Error).message });
      log.warn({ row: rowNum, err: (err as Error).message }, 'row import failed');
    }
  }

  log.info(result, 'tintim import complete');
  return result;
}
