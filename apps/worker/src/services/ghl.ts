import { logger } from '../lib/logger.js';

const log = logger.child({ module: 'ghl' });

/**
 * Cliente HTTP da Go High Level API V2.
 *
 * Base URL: https://services.leadconnectorhq.com
 * Auth: Bearer <Private Integration Token>
 * Header obrigatório: Version: 2021-07-28
 *
 * Token nunca é logado nem retornado em mensagens de erro.
 */

export interface GhlClientOptions {
  privateToken: string;
  locationId?: string;
  apiVersion?: string;
}

export interface GhlApiError extends Error {
  status?: number;
  ghlMessage?: string;
}

export interface GhlContact {
  id: string;
  locationId?: string;
  firstName?: string | null;
  lastName?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  customFields?: Array<{ id: string; key?: string; value?: unknown }>;
  source?: string | null;
  attributionSource?: {
    fbclid?: string | null;
    fbp?: string | null;
    utmSource?: string | null;
    utmCampaign?: string | null;
    sessionSource?: string | null;
  };
  // GHL às vezes retorna campos planos no top-level
  [key: string]: unknown;
}

export interface GhlOpportunity {
  id: string;
  name?: string | null;
  contactId?: string;
  contact_id?: string; // alguns webhooks usam snake_case
  locationId?: string;
  pipelineId?: string;
  pipeline_id?: string;
  pipelineStageId?: string;
  pipeline_stage_id?: string;
  status?: string | null; // 'open' | 'won' | 'lost' | 'abandoned'
  monetaryValue?: number | string | null;
  monetary_value?: number | string | null;
  source?: string | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface GhlPipeline {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string; position?: number }>;
}

export class GhlClient {
  private readonly token: string;
  private readonly locationId?: string;
  private readonly baseUrl = 'https://services.leadconnectorhq.com';
  private readonly version: string;

  constructor(options: GhlClientOptions) {
    if (!options.privateToken) {
      throw new Error('GhlClient: privateToken is required');
    }
    this.token = options.privateToken;
    this.locationId = options.locationId;
    this.version = options.apiVersion ?? '2021-07-28';
  }

  /**
   * Busca uma oportunidade por ID (canônico, não confiar só no webhook).
   */
  async getOpportunity(opportunityId: string): Promise<GhlOpportunity> {
    const url = `${this.baseUrl}/opportunities/${opportunityId}`;
    const response = await this.get<{ opportunity?: GhlOpportunity } & GhlOpportunity>(url);
    // GHL às vezes envolve em { opportunity: ... }, às vezes não
    return response.opportunity ?? response;
  }

  /**
   * Busca contato por ID (pega custom fields incluindo fbclid se configurado).
   */
  async getContact(contactId: string): Promise<GhlContact> {
    const url = `${this.baseUrl}/contacts/${contactId}`;
    const response = await this.get<{ contact?: GhlContact } & GhlContact>(url);
    return response.contact ?? response;
  }

  /**
   * Lista pipelines de uma location (usado pra descobrir Stage IDs).
   */
  async listPipelines(locationId?: string): Promise<GhlPipeline[]> {
    const loc = locationId ?? this.locationId;
    if (!loc) throw new Error('locationId required for listPipelines');
    const url = `${this.baseUrl}/opportunities/pipelines?locationId=${encodeURIComponent(loc)}`;
    const response = await this.get<{ pipelines?: GhlPipeline[] }>(url);
    return response.pipelines ?? [];
  }

  // ========================================================================
  // Internals
  // ========================================================================

  private async get<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Version: this.version,
        Accept: 'application/json',
      },
    });
    return this.handleResponse<T>(response);
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (response.ok) {
      return (await response.json()) as T;
    }
    const text = await response.text();
    let parsed: { message?: string; error?: string } = {};
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      // body não-JSON
    }
    const ghlMessage = parsed.message ?? parsed.error ?? text.slice(0, 200);
    const err = new Error(`GHL API ${response.status}: ${ghlMessage}`) as GhlApiError;
    err.status = response.status;
    err.ghlMessage = ghlMessage;
    log.warn({ status: response.status, ghlMessage }, 'ghl api error');
    throw err;
  }
}

// ============================================================================
// Helpers de extração tolerante (custom fields variam por configuração)
// ============================================================================

/**
 * Procura recursivamente por um valor de custom field cujo key/name contenha
 * uma das palavras-chave fornecidas. Útil para fbclid/fbp porque o key real
 * depende de como o cliente nomeou o campo no GHL.
 */
export function findCustomFieldValue(
  contact: GhlContact,
  keywords: string[],
): string | null {
  // 1. Tenta direto no top-level (alguns providers expõem assim)
  for (const kw of keywords) {
    const direct = (contact as Record<string, unknown>)[kw];
    if (typeof direct === 'string' && direct) return direct;
  }

  // 2. Tenta em attributionSource (estrutura específica do GHL)
  const attr = contact.attributionSource;
  if (attr) {
    for (const kw of keywords) {
      const value = (attr as Record<string, unknown>)[kw];
      if (typeof value === 'string' && value) return value;
    }
  }

  // 3. Tenta nos customFields[]
  const customFields = contact.customFields ?? [];
  for (const field of customFields) {
    const key = (field.key ?? '').toLowerCase();
    if (keywords.some((kw) => key.includes(kw.toLowerCase()))) {
      if (typeof field.value === 'string' && field.value) return field.value;
    }
  }

  return null;
}

export function extractFbclid(contact: GhlContact): string | null {
  return findCustomFieldValue(contact, ['fbclid', 'fb_clid']);
}

export function extractFbp(contact: GhlContact): string | null {
  return findCustomFieldValue(contact, ['fbp', '_fbp']);
}

/**
 * Normaliza monetary_value (GHL às vezes retorna string, às vezes number).
 */
export function parseMonetaryValue(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
