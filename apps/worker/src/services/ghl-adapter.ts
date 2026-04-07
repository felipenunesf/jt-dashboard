import { z } from 'zod';

/**
 * Adapter do payload de webhook do Go High Level → estrutura normalizada interna.
 *
 * GHL Workflows com action "Webhook" envia payloads que VARIAM por trigger:
 * - Contact Created
 * - Opportunity Created
 * - Opportunity Status Changed
 * - Pipeline Stage Changed
 *
 * Cada um envia um schema ligeiramente diferente. Schema é tolerante.
 *
 * Formato típico (Pipeline Stage Changed):
 * {
 *   "type": "OpportunityPipelineStageUpdate",
 *   "locationId": "...",
 *   "id": "<opportunity_id>",
 *   "contact_id": "...",
 *   "name": "...",
 *   "pipeline_id": "...",
 *   "pipeline_stage_id": "...",
 *   "status": "open",
 *   "monetary_value": 5000,
 *   "source": "...",
 *   "assigned_to": "...",
 *   ...
 * }
 *
 * Algumas variantes envolvem em { customData: {...} } ou { opportunity: {...} }.
 */

const ghlWebhookSchema = z
  .object({
    type: z.string().optional(),
    locationId: z.string().optional(),
    location_id: z.string().optional(),
    // ID da opportunity pode vir como id, opportunityId, opportunity_id
    id: z.string().optional(),
    opportunityId: z.string().optional(),
    opportunity_id: z.string().optional(),
    // Contact id
    contactId: z.string().optional(),
    contact_id: z.string().optional(),
    // Dados de contato inline (alguns workflows do GHL incluem isso direto)
    full_name: z.string().optional(),
    fullName: z.string().optional(),
    first_name: z.string().optional(),
    firstName: z.string().optional(),
    last_name: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    fbclid: z.string().optional(),
    fbp: z.string().optional(),
    // Pipeline + stage
    pipelineId: z.string().optional(),
    pipeline_id: z.string().optional(),
    pipelineStageId: z.string().optional(),
    pipeline_stage_id: z.string().optional(),
    pipelineStageName: z.string().optional(),
    pipeline_stage_name: z.string().optional(),
    // Status do funil
    status: z.string().optional(),
    // Valor
    monetaryValue: z.union([z.number(), z.string()]).optional(),
    monetary_value: z.union([z.number(), z.string()]).optional(),
    // URL da página de origem (custom field comum)
    page_url: z.string().optional(),
    pageUrl: z.string().optional(),
    // Variantes que envolvem em { opportunity: {...} }
    opportunity: z
      .object({
        id: z.string().optional(),
        contactId: z.string().optional(),
        pipelineId: z.string().optional(),
        pipelineStageId: z.string().optional(),
        status: z.string().optional(),
        monetaryValue: z.union([z.number(), z.string()]).optional(),
      })
      .passthrough()
      .optional(),
    contact: z
      .object({
        id: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export interface NormalizedGhlEvent {
  /** Tipo do evento (ex: "OpportunityPipelineStageUpdate") */
  type: string;
  /** ID da opportunity (chave única) */
  opportunityId: string;
  /** ID do contato */
  contactId: string | null;
  /** ID da location */
  locationId: string | null;
  /** ID do pipeline */
  pipelineId: string | null;
  /** ID do stage atual */
  stageId: string | null;
  /** Nome do stage atual (se vier) */
  stageName: string | null;
  /** Status do funil ("open"|"won"|"lost"|"abandoned") */
  status: string | null;
  /** Monetary value se vier no payload */
  monetaryValue: number | null;
  /** Dados de contato inline (quando webhook do GHL inclui — evita fetch extra) */
  inlineContact: {
    name: string | null;
    email: string | null;
    phone: string | null;
    fbclid: string | null;
    fbp: string | null;
  };
  /** URL da página de origem (se vier no payload) */
  sourceUrl: string | null;
}

export function normalizeGhlWebhook(raw: unknown): NormalizedGhlEvent | null {
  const parsed = ghlWebhookSchema.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data;
  const opp = d.opportunity ?? {};
  const c = d.contact ?? {};

  const opportunityId = d.id ?? d.opportunityId ?? d.opportunity_id ?? opp.id;
  if (!opportunityId) return null;

  const contactId = d.contactId ?? d.contact_id ?? opp.contactId ?? c.id ?? null;
  const locationId = d.locationId ?? d.location_id ?? null;
  const pipelineId = d.pipelineId ?? d.pipeline_id ?? opp.pipelineId ?? null;
  const stageId = d.pipelineStageId ?? d.pipeline_stage_id ?? opp.pipelineStageId ?? null;
  const stageName = d.pipelineStageName ?? d.pipeline_stage_name ?? null;
  const status = d.status ?? opp.status ?? null;

  const valueRaw = d.monetaryValue ?? d.monetary_value ?? opp.monetaryValue;
  let monetaryValue: number | null = null;
  if (valueRaw !== undefined && valueRaw !== null) {
    const n = typeof valueRaw === 'number' ? valueRaw : Number(valueRaw);
    if (Number.isFinite(n) && n > 0) monetaryValue = n;
  }

  // Constrói nome a partir dos vários formatos possíveis
  let name: string | null = d.full_name ?? d.fullName ?? null;
  if (!name) {
    const first = d.first_name ?? d.firstName ?? c.firstName ?? null;
    const last = d.last_name ?? d.lastName ?? c.lastName ?? null;
    const joined = [first, last].filter(Boolean).join(' ').trim();
    name = joined || null;
  }

  return {
    type: d.type ?? 'unknown',
    opportunityId,
    contactId,
    locationId,
    pipelineId,
    stageId,
    stageName,
    status,
    monetaryValue,
    inlineContact: {
      name,
      email: d.email ?? c.email ?? null,
      phone: d.phone ?? c.phone ?? null,
      fbclid: d.fbclid ?? null,
      fbp: d.fbp ?? null,
    },
    sourceUrl: d.page_url ?? d.pageUrl ?? null,
  };
}
