import type { Lead, MetaAd } from '@jt/db';
import type { MetaAccount } from '@jt/shared';
import { hashEmail, sha256 } from '../lib/crypto.js';

/**
 * Serviço de montagem de payloads para Meta Conversions API.
 *
 * Eventos suportados:
 * - Contact              → 1º contato (lead novo entra)
 * - Lead                 → lead qualificado
 * - CompleteRegistration → enviado junto com Lead na qualificação
 * - Purchase             → fechamento de contrato
 *
 * Action source:
 * - lead.source='whatsapp' → "business_messaging" + messaging_channel: "whatsapp"
 * - lead.source='site_ghl' → "website" (futura Fase 5)
 */

export type CapiEventName = 'Contact' | 'Lead' | 'CompleteRegistration' | 'Purchase';

export interface BuildCapiPayloadInput {
  eventName: CapiEventName;
  eventId: string;
  eventTime: number; // ms (será convertido para segundos)
  lead: Lead;
  ad?: MetaAd | null;
  defaultPixelFromAccount?: string;
  defaultPurchaseValue?: number;
  defaultCurrency?: string;
}

export interface BuildCapiPayloadResult {
  pixelId: string;
  payload: { data: unknown[] };
}

export class MissingPixelError extends Error {
  constructor() {
    super('No pixel_id available for this lead/ad');
    this.name = 'MissingPixelError';
  }
}

/**
 * Monta o payload completo do CAPI para um lead WhatsApp.
 * Resolve pixel_id em cascata: ad.pixelId → fallback do account.
 */
export function buildWhatsappCapiPayload(input: BuildCapiPayloadInput): BuildCapiPayloadResult {
  const {
    eventName,
    eventId,
    eventTime,
    lead,
    ad,
    defaultPixelFromAccount,
    defaultPurchaseValue,
    defaultCurrency = 'BRL',
  } = input;

  // Resolve pixel: do ad → fallback do account → erro
  const pixelId = ad?.pixelId ?? defaultPixelFromAccount;
  if (!pixelId) {
    throw new MissingPixelError();
  }

  // user_data: somente campos com valor real (Meta valida e remove vazios)
  const userData: Record<string, unknown> = {};

  if (lead.phoneHash) {
    userData.ph = lead.phoneHash;
    userData.external_id = lead.phoneHash;
  }
  if (lead.emailHash) {
    userData.em = lead.emailHash;
  }
  if (lead.ctwaClid) {
    userData.ctwa_clid = lead.ctwaClid;
  }
  if (ad?.pageId) {
    userData.page_id = ad.pageId;
  }
  if (lead.name) {
    const parts = lead.name.trim().split(/\s+/);
    if (parts[0]) userData.fn = sha256(parts[0]);
    if (parts.length > 1 && parts[parts.length - 1]) {
      userData.ln = sha256(parts[parts.length - 1] as string);
    }
  }
  if (lead.email && !lead.emailHash) {
    userData.em = hashEmail(lead.email);
  }

  // custom_data só faz sentido para Purchase
  let customData: Record<string, unknown> | undefined;
  if (eventName === 'Purchase') {
    const value =
      lead.purchaseValue !== null && lead.purchaseValue !== undefined
        ? Number(lead.purchaseValue)
        : (defaultPurchaseValue ?? 0);
    customData = {
      value,
      currency: lead.purchaseCurrency ?? defaultCurrency,
    };
  }

  const dataItem: Record<string, unknown> = {
    event_name: eventName,
    event_time: Math.floor(eventTime / 1000),
    event_id: eventId,
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: userData,
  };

  if (customData) {
    dataItem.custom_data = customData;
  }

  // event_source_url ajuda atribuição quando o source_url do anúncio é conhecido
  if (lead.sourceUrl) {
    dataItem.event_source_url = lead.sourceUrl;
  }

  return {
    pixelId,
    payload: { data: [dataItem] },
  };
}

/**
 * Resolve pixel default a partir das META_ACCOUNTS (env).
 * Pega o pixel da account dona do ad (ou o primeiro pixel da primeira account
 * como último fallback).
 */
export function resolveDefaultPixel(
  accountId: string | null | undefined,
  metaAccounts: MetaAccount[],
): string | undefined {
  if (!accountId) return metaAccounts[0]?.pixel_ids[0];
  const normalized = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  const account = metaAccounts.find(
    (a) => a.account_id === normalized || `act_${a.account_id}` === normalized,
  );
  return account?.pixel_ids[0] ?? metaAccounts[0]?.pixel_ids[0];
}

/**
 * Monta o payload CAPI para um lead vindo do site (GHL).
 *
 * Diferenças vs WhatsApp:
 * - action_source: "website" (em vez de "business_messaging")
 * - SEM messaging_channel
 * - user_data inclui fbc/fbp (em vez de ctwa_clid)
 * - event_source_url é a landing page
 *
 * fbc é construído conforme spec do Meta: "fb.1.<unix_ts>.<fbclid>"
 */
export function buildSiteCapiPayload(input: BuildCapiPayloadInput): BuildCapiPayloadResult {
  const {
    eventName,
    eventId,
    eventTime,
    lead,
    ad,
    defaultPixelFromAccount,
    defaultPurchaseValue,
    defaultCurrency = 'BRL',
  } = input;

  const pixelId = ad?.pixelId ?? defaultPixelFromAccount;
  if (!pixelId) {
    throw new MissingPixelError();
  }

  const userData: Record<string, unknown> = {};

  if (lead.phoneHash) {
    userData.ph = lead.phoneHash;
    userData.external_id = lead.phoneHash;
  }
  if (lead.emailHash) {
    userData.em = lead.emailHash;
  }
  if (lead.email && !lead.emailHash) {
    userData.em = hashEmail(lead.email);
  }
  if (lead.name) {
    const parts = lead.name.trim().split(/\s+/);
    if (parts[0]) userData.fn = sha256(parts[0]);
    if (parts.length > 1 && parts[parts.length - 1]) {
      userData.ln = sha256(parts[parts.length - 1] as string);
    }
  }
  if (lead.fbclid) {
    // Format: fb.1.<unix_seconds>.<fbclid>
    const tsSeconds = Math.floor((lead.firstSeenAt?.getTime() ?? eventTime) / 1000);
    userData.fbc = `fb.1.${tsSeconds}.${lead.fbclid}`;
  }
  if (lead.fbp) {
    userData.fbp = lead.fbp;
  }

  let customData: Record<string, unknown> | undefined;
  if (eventName === 'Purchase') {
    const value =
      lead.purchaseValue !== null && lead.purchaseValue !== undefined
        ? Number(lead.purchaseValue)
        : (defaultPurchaseValue ?? 0);
    customData = {
      value,
      currency: lead.purchaseCurrency ?? defaultCurrency,
    };
  }

  const dataItem: Record<string, unknown> = {
    event_name: eventName,
    event_time: Math.floor(eventTime / 1000),
    event_id: eventId,
    action_source: 'website',
    user_data: userData,
  };

  if (lead.sourceUrl) {
    dataItem.event_source_url = lead.sourceUrl;
  }

  if (customData) {
    dataItem.custom_data = customData;
  }

  return {
    pixelId,
    payload: { data: [dataItem] },
  };
}
