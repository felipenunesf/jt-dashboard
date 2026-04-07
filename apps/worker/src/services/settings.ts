import { db, settings } from '@jt/db';
import { eq, sql } from 'drizzle-orm';
import { logger } from '../lib/logger.js';

const log = logger.child({ module: 'settings' });

/**
 * Estrutura tipada de cada chave em `settings`.
 * Cada chave armazena um valor JSONB único — type-safe via map abaixo.
 */

export interface GhlStageMap {
  qualified_stage_id: string | null;
  closed_stage_id: string | null;
}

export type WelcomeMessageSignatures = Record<string, string>;

export const SETTING_KEYS = {
  QUALIFIER_PHRASE: 'qualifier_phrase',
  PURCHASE_PHRASE: 'purchase_phrase',
  DEFAULT_PURCHASE_VALUE: 'default_purchase_value',
  DEFAULT_PURCHASE_CURRENCY: 'default_purchase_currency',
  GHL_STAGE_MAP: 'ghl_stage_map',
  WELCOME_MESSAGE_SIGNATURES: 'welcome_message_signatures',
} as const;

export const DEFAULT_SETTINGS = {
  [SETTING_KEYS.QUALIFIER_PHRASE]: 'Somos especialistas em cuidar de médicos',
  [SETTING_KEYS.PURCHASE_PHRASE]: 'Agradecemos por confiar no JT Advocacia Médica',
  [SETTING_KEYS.DEFAULT_PURCHASE_VALUE]: 5000,
  [SETTING_KEYS.DEFAULT_PURCHASE_CURRENCY]: 'BRL',
  [SETTING_KEYS.GHL_STAGE_MAP]: {
    qualified_stage_id: null,
    closed_stage_id: null,
  } satisfies GhlStageMap,
  [SETTING_KEYS.WELCOME_MESSAGE_SIGNATURES]: {} as WelcomeMessageSignatures,
};

/**
 * Lê uma setting individual. Retorna o default se não existir.
 */
export async function getSetting<K extends keyof typeof DEFAULT_SETTINGS>(
  key: K,
): Promise<(typeof DEFAULT_SETTINGS)[K]> {
  const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  const row = rows[0];
  if (!row || row.value === null) {
    return DEFAULT_SETTINGS[key];
  }
  return row.value as (typeof DEFAULT_SETTINGS)[K];
}

/**
 * Escreve uma setting (upsert).
 */
export async function setSetting<K extends keyof typeof DEFAULT_SETTINGS>(
  key: K,
  value: (typeof DEFAULT_SETTINGS)[K],
): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value: value as object })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: value as object, updatedAt: sql`NOW()` },
    });
}

/**
 * Carrega todas as settings de uma vez (cache em memória do worker).
 */
export interface AllSettings {
  qualifierPhrase: string;
  purchasePhrase: string;
  defaultPurchaseValue: number;
  defaultPurchaseCurrency: string;
  ghlStageMap: GhlStageMap;
  welcomeMessageSignatures: WelcomeMessageSignatures;
}

export async function loadAllSettings(): Promise<AllSettings> {
  const [qp, pp, dpv, dpc, gsm, wms] = await Promise.all([
    getSetting(SETTING_KEYS.QUALIFIER_PHRASE),
    getSetting(SETTING_KEYS.PURCHASE_PHRASE),
    getSetting(SETTING_KEYS.DEFAULT_PURCHASE_VALUE),
    getSetting(SETTING_KEYS.DEFAULT_PURCHASE_CURRENCY),
    getSetting(SETTING_KEYS.GHL_STAGE_MAP),
    getSetting(SETTING_KEYS.WELCOME_MESSAGE_SIGNATURES),
  ]);

  return {
    qualifierPhrase: qp,
    purchasePhrase: pp,
    defaultPurchaseValue: dpv,
    defaultPurchaseCurrency: dpc,
    ghlStageMap: gsm,
    welcomeMessageSignatures: wms,
  };
}

/**
 * Garante que todas as settings padrão existam no banco.
 * Roda uma vez na inicialização do worker.
 */
export async function seedDefaultSettings(): Promise<void> {
  const existing = await db.select({ key: settings.key }).from(settings);
  const existingKeys = new Set(existing.map((row) => row.key));

  let inserted = 0;
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (existingKeys.has(key)) continue;
    await db.insert(settings).values({ key, value: value as object });
    inserted++;
  }
  if (inserted > 0) {
    log.info({ inserted }, 'seeded default settings');
  }
}
