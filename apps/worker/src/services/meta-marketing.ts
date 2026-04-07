import { logger } from '../lib/logger.js';

const log = logger.child({ module: 'meta-marketing' });

/**
 * Cliente HTTP da Meta Marketing API + Graph API.
 * Encapsula paginação automática, retry em rate limit, e parse de erros.
 *
 * Token nunca é logado nem retornado em mensagens de erro.
 */

export interface MetaApiClientOptions {
  accessToken: string;
  apiVersion?: string;
  testEventCode?: string;
}

export interface MetaApiError extends Error {
  code?: number;
  subcode?: number;
  fbtrace_id?: string;
  type?: string;
}

export interface MetaPaging {
  cursors?: { before?: string; after?: string };
  next?: string;
}

export interface MetaListResponse<T> {
  data: T[];
  paging?: MetaPaging;
}

/**
 * Estruturas brutas devolvidas pelos endpoints da Marketing API
 * (campos limitados aos que precisamos — schema parcial intencional).
 */
export interface MetaAdRaw {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  adset?: { id: string; name?: string; destination_type?: string };
  campaign?: { id: string; name?: string; objective?: string };
  creative?: { id: string };
}

export interface MetaCreativeRaw {
  id: string;
  thumbnail_url?: string;
  image_url?: string;
  instagram_permalink_url?: string;
  object_story_spec?: {
    video_data?: { image_url?: string };
    link_data?: { picture?: string };
  };
}

export interface MetaInsightActionRaw {
  action_type: string;
  value: string;
}

export interface MetaInsightRaw {
  ad_id: string;
  date_start: string;
  date_stop: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  inline_link_clicks?: string;
  unique_inline_link_clicks?: string;
  ctr?: string;
  cpc?: string;
  frequency?: string;
  actions?: MetaInsightActionRaw[];
}

export interface MetaTrackingSpec {
  fb_pixel?: string[];
  dataset?: string[];
  page?: string[];
  [key: string]: unknown;
}

export class MetaApiClient {
  private readonly token: string;
  private readonly apiVersion: string;
  private readonly testEventCode?: string;
  private readonly baseUrl: string;

  constructor(options: MetaApiClientOptions) {
    if (!options.accessToken) {
      throw new Error('MetaApiClient: accessToken is required');
    }
    this.token = options.accessToken;
    this.apiVersion = options.apiVersion ?? 'v22.0';
    this.testEventCode = options.testEventCode;
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
  }

  /**
   * Lista TODOS os anúncios de uma conta (inclui DELETED, ARCHIVED, WITH_ISSUES).
   * Importante pra reconciliar totais históricos de spend com o Ads Manager —
   * campanhas antigas paradas ainda contribuem pro total do período.
   */
  async listAds(accountId: string): Promise<MetaAdRaw[]> {
    const fields = [
      'id',
      'name',
      'status',
      'effective_status',
      'adset{id,name,destination_type}',
      'campaign{id,name,objective}',
      'creative{id}',
    ].join(',');

    const params = new URLSearchParams({
      fields,
      limit: '500',
    });

    const url = `${this.baseUrl}/${normalizeAccountId(accountId)}/ads?${params.toString()}`;
    return this.paginate<MetaAdRaw>(url);
  }

  /**
   * Busca o creative de um anúncio (para obter thumbnail e permalink).
   */
  async getCreative(creativeId: string): Promise<MetaCreativeRaw> {
    const fields = [
      'id',
      'thumbnail_url',
      'image_url',
      'instagram_permalink_url',
      'object_story_spec',
    ].join(',');
    const url = `${this.baseUrl}/${creativeId}?fields=${fields}`;
    return this.get<MetaCreativeRaw>(url);
  }

  /**
   * Busca tracking_specs de um anúncio para descobrir pixel_id e page_id.
   * Reaproveitado da lógica n8n: o resultado é um array com chaves variáveis,
   * por isso o caller precisa fazer flatten/extract.
   */
  async getAdTrackingSpecs(adId: string): Promise<MetaTrackingSpec[]> {
    const url = `${this.baseUrl}/${adId}?fields=tracking_specs`;
    const response = await this.get<{ tracking_specs?: MetaTrackingSpec[] }>(url);
    return response.tracking_specs ?? [];
  }

  /**
   * Insights de um único dia, level=ad, com paginação automática.
   * Retorna 1 row por (ad, dia).
   * Nota: landing_page_views vem como action_type, não como field top-level.
   */
  async getInsightsForDay(accountId: string, day: string): Promise<MetaInsightRaw[]> {
    const fields = [
      'ad_id',
      'date_start',
      'date_stop',
      'spend',
      'impressions',
      'reach',
      'inline_link_clicks',
      'unique_inline_link_clicks',
      'ctr',
      'cpc',
      'frequency',
      'actions',
    ].join(',');

    const params = new URLSearchParams({
      level: 'ad',
      time_range: JSON.stringify({ since: day, until: day }),
      fields,
      limit: '500',
    });

    const url = `${this.baseUrl}/${normalizeAccountId(accountId)}/insights?${params.toString()}`;
    return this.paginate<MetaInsightRaw>(url);
  }

  /**
   * Envia evento CAPI. Usado na Fase 4.
   */
  async sendCapiEvent(
    pixelId: string,
    payload: { data: unknown[] },
  ): Promise<{ events_received: number; messages?: string[]; fbtrace_id?: string }> {
    const url = `${this.baseUrl}/${pixelId}/events`;
    const body: Record<string, unknown> = { ...payload };
    if (this.testEventCode) {
      body.test_event_code = this.testEventCode;
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });
    return this.handleResponse(response);
  }

  // ========================================================================
  // Internals
  // ========================================================================

  private async get<T>(url: string): Promise<T> {
    const withToken = appendToken(url, this.token);
    const response = await fetch(withToken);
    return this.handleResponse<T>(response);
  }

  private async paginate<T>(initialUrl: string): Promise<T[]> {
    const out: T[] = [];
    let nextUrl: string | undefined = appendToken(initialUrl, this.token);
    let pageCount = 0;
    const maxPages = 50; // safety: 500 × 50 = 25k items por chamada

    while (nextUrl && pageCount < maxPages) {
      const response: Response = await fetch(nextUrl);
      const json = await this.handleResponse<MetaListResponse<T>>(response);
      out.push(...(json.data ?? []));
      pageCount++;

      // Meta retorna `paging.next` já com access_token embutido
      nextUrl = json.paging?.next;
    }

    if (pageCount >= maxPages) {
      log.warn({ initialUrl: redactToken(initialUrl), pageCount }, 'paginate hit safety limit');
    }

    return out;
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (response.ok) {
      return (await response.json()) as T;
    }
    const text = await response.text();
    let parsedError: {
      error?: {
        message?: string;
        type?: string;
        code?: number;
        error_subcode?: number;
        fbtrace_id?: string;
      };
    } = {};
    try {
      parsedError = JSON.parse(text) as typeof parsedError;
    } catch {
      // body não-JSON
    }
    const fbErr = parsedError.error ?? {};
    const err = new Error(
      `Meta API ${response.status}: ${fbErr.message ?? text.slice(0, 200)}`,
    ) as MetaApiError;
    err.code = fbErr.code;
    err.subcode = fbErr.error_subcode;
    err.fbtrace_id = fbErr.fbtrace_id;
    err.type = fbErr.type;
    throw err;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Garante prefixo "act_" no account ID. Aceita "act_123" ou "123".
 */
export function normalizeAccountId(accountId: string): string {
  return accountId.startsWith('act_') ? accountId : `act_${accountId}`;
}

/**
 * Adiciona o access_token na URL como query param se ainda não estiver.
 * Usado nos GETs simples (não em paging.next que já vem com token).
 */
function appendToken(url: string, token: string): string {
  if (url.includes('access_token=')) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}access_token=${encodeURIComponent(token)}`;
}

/**
 * Remove access_token de URL para logs (defesa em profundidade).
 */
export function redactToken(url: string): string {
  return url.replace(/access_token=[^&]+/g, 'access_token=REDACTED');
}

/**
 * Achata o array `actions[]` da Insights API em chaves planas.
 * Ex: actions[{action_type: "onsite_conversion.messaging_conversation_started_7d", value: "5"}]
 *  → { 'onsite_conversion.messaging_conversation_started_7d': '5' }
 */
export function flattenActions(
  actions: MetaInsightActionRaw[] | undefined,
): Record<string, string> {
  if (!actions || actions.length === 0) return {};
  const out: Record<string, string> = {};
  for (const action of actions) {
    out[action.action_type] = action.value;
  }
  return out;
}

/**
 * Extrai dataset (pixel_id) e page_id de uma lista de tracking_specs.
 * Implementação reaproveitada do JSON n8n com mesma semântica.
 */
export function extractPixelAndPage(specs: MetaTrackingSpec[]): {
  pixelId?: string;
  pageId?: string;
} {
  let pixelId: string | undefined;
  let pageId: string | undefined;

  const visit = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return;
    const record = obj as Record<string, unknown>;
    if (Array.isArray(record.dataset) && record.dataset.length > 0 && !pixelId) {
      pixelId = String(record.dataset[0]);
    } else if (Array.isArray(record.fb_pixel) && record.fb_pixel.length > 0 && !pixelId) {
      pixelId = String(record.fb_pixel[0]);
    }
    if (Array.isArray(record.page) && record.page.length > 0 && !pageId) {
      pageId = String(record.page[0]);
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') visit(value);
    }
  };

  for (const spec of specs) visit(spec);
  return { pixelId, pageId };
}

/**
 * Resolve a melhor URL de thumbnail a partir de um creative.
 * Reaproveita a cadeia de fallback dos workflows n8n:
 * object_story_spec.video_data.image_url > image_url > thumbnail_url
 */
export function resolveCreativeThumbnail(creative: MetaCreativeRaw): string | undefined {
  return (
    creative.object_story_spec?.video_data?.image_url ??
    creative.object_story_spec?.link_data?.picture ??
    creative.image_url ??
    creative.thumbnail_url
  );
}
