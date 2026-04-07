import { z } from 'zod';

/**
 * Adapter Z-API → estrutura normalizada interna.
 *
 * Z-API é uma API não-oficial do WhatsApp que usa Baileys/web reverse-engineering.
 * O payload exato precisa ser confirmado em produção (Spike Fase 3.0). Esta
 * implementação usa um schema TOLERANTE — aceita múltiplos formatos comuns:
 *
 * 1. Formato canônico Z-API: { instanceId, messageId, fromMe, phone, chatName,
 *    text: { message }, momment, type, isGroup, ... }
 * 2. Formato alternativo (vide https://developer.z-api.io/en/webhooks): variantes
 *    com {data: {...}}, ou {body: {mensagem: {...}}} (formato Palm Up legacy)
 *
 * Quando Z-API expor referral CTWA, virá em algum desses paths possíveis:
 *   data.referral, message.referral, body.mensagem.referral
 *
 * O parser tenta cada um — se vier null, lead fica sem ad_id (atribuição perdida)
 * e o classificador pode ainda resolver via welcome_message_signatures.
 */

// ============================================================================
// Schema tolerante de input (Z-API + variantes)
// ============================================================================

const referralSchema = z
  .object({
    ctwa_clid: z.string().optional(),
    ctwaclid: z.string().optional(), // alguns providers usam camelCase sem underscore
    source_id: z.string().optional(),
    sourceId: z.string().optional(),
    source_url: z.string().optional(),
    sourceUrl: z.string().optional(),
    source_type: z.string().optional(),
    sourceType: z.string().optional(),
    headline: z.string().optional(),
    body: z.string().optional(),
    media_type: z.string().optional(),
    mediaType: z.string().optional(),
    thumbnail_url: z.string().optional(),
    thumbnailUrl: z.string().optional(),
  })
  .passthrough();

// Z-API formato 1: top-level fields
const zapiFlatSchema = z
  .object({
    instanceId: z.string().optional(),
    messageId: z.string().optional(),
    phone: z.string().optional(),
    fromMe: z.boolean().optional(),
    chatName: z.string().optional(),
    senderName: z.string().optional(),
    momment: z.union([z.number(), z.string()]).optional(), // sic, "moment" mistyped na docs Z-API
    moment: z.union([z.number(), z.string()]).optional(),
    type: z.string().optional(),
    text: z
      .object({
        message: z.string().optional(),
      })
      .passthrough()
      .optional(),
    referral: referralSchema.optional().nullable(),
    isGroup: z.boolean().optional(),
  })
  .passthrough();

// Z-API formato 2: aninhado em data
const zapiDataSchema = z
  .object({
    instance: z.string().optional(),
    event: z.string().optional(),
    data: z
      .object({
        id: z.string().optional(),
        timestamp: z.union([z.number(), z.string()]).optional(),
        chatId: z.string().optional(),
        sender: z
          .object({
            id: z.string().optional(),
            name: z.string().optional(),
          })
          .passthrough()
          .optional(),
        message: z
          .object({
            id: z.string().optional(),
            type: z.string().optional(),
            text: z.union([z.string(), z.object({ body: z.string() }).passthrough()]).optional(),
          })
          .passthrough()
          .optional(),
        referral: referralSchema.optional().nullable(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

// Formato Palm Up legacy (visto nos JSONs n8n) — valioso pra compatibilidade
const palmUpSchema = z
  .object({
    body: z
      .object({
        nome: z.string().optional(),
        telefone: z.string().optional(),
        mensagem: z
          .object({
            from: z.string().optional(),
            id: z.string().optional(),
            timestamp: z.union([z.number(), z.string()]).optional(),
            type: z.string().optional(),
            text: z.union([z.object({ body: z.string() }).passthrough(), z.string()]).optional(),
            referral: referralSchema.optional().nullable(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

// ============================================================================
// Tipo normalizado
// ============================================================================

export interface NormalizedReferral {
  ctwa_clid?: string;
  source_id?: string;
  source_url?: string;
  source_type?: string;
  headline?: string;
  body?: string;
  thumbnail_url?: string;
}

export interface NormalizedMessage {
  /** Identificador único da mensagem (wamid). Crítico para idempotência. */
  messageId: string;
  /** Telefone do contato (do lead, não do número da empresa). E.164 sem '+'. */
  phone: string;
  /** Instance: qual número da JT recebeu a mensagem. */
  instance: string;
  /** Nome do contato (se disponível). */
  contactName?: string;
  /** Texto da mensagem. */
  text: string;
  /** Direção: lead → empresa (inbound) ou empresa → lead (outbound). */
  direction: 'inbound' | 'outbound';
  /** Timestamp em ms. */
  timestamp: number;
  /** Referral CTWA (só na 1ª mensagem da conversa, se Z-API expuser). */
  referral?: NormalizedReferral;
}

// ============================================================================
// Parser
// ============================================================================

/**
 * Tenta normalizar um payload bruto em uma NormalizedMessage.
 * Retorna null se não conseguir extrair os campos mínimos (messageId + phone + text).
 */
export function normalizeZApiMessage(
  raw: unknown,
  fallbackInstance: string,
): NormalizedMessage | null {
  // Tenta cada formato em ordem
  return (
    tryFlatFormat(raw, fallbackInstance) ??
    tryDataFormat(raw, fallbackInstance) ??
    tryPalmUpFormat(raw, fallbackInstance) ??
    null
  );
}

function tryFlatFormat(raw: unknown, fallbackInstance: string): NormalizedMessage | null {
  const parsed = zapiFlatSchema.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data;
  if (!d.messageId || !d.phone) return null;

  const text = d.text?.message ?? '';
  if (!text && d.type !== 'text') return null;

  const tsRaw = d.momment ?? d.moment;
  const timestamp = parseTs(tsRaw);

  return {
    messageId: d.messageId,
    phone: d.phone,
    // Sempre usa o path param (/webhooks/whatsapp/:instance) como canônico.
    // O instanceId cru do Z-API é um hash longo que não queremos no banco.
    instance: fallbackInstance,
    contactName: d.senderName ?? d.chatName,
    text,
    direction: d.fromMe ? 'outbound' : 'inbound',
    timestamp,
    referral: extractReferral(d.referral),
  };
}

function tryDataFormat(raw: unknown, fallbackInstance: string): NormalizedMessage | null {
  const parsed = zapiDataSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.data) return null;
  const d = parsed.data.data;
  if (!d.id || !d.chatId) return null;

  const phone = d.chatId.split('@')[0] ?? '';
  if (!phone) return null;

  const text = extractText(d.message?.text);

  return {
    messageId: d.id,
    phone,
    instance: fallbackInstance,
    contactName: d.sender?.name,
    text,
    direction: 'inbound', // formato data não marca direção facilmente; default inbound
    timestamp: parseTs(d.timestamp),
    referral: extractReferral(d.referral),
  };
}

function tryPalmUpFormat(raw: unknown, fallbackInstance: string): NormalizedMessage | null {
  const parsed = palmUpSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.body?.mensagem) return null;
  const m = parsed.data.body.mensagem;
  if (!m.id) return null;

  const phone = parsed.data.body.telefone ?? m.from ?? '';
  if (!phone) return null;

  return {
    messageId: m.id,
    phone,
    instance: fallbackInstance,
    contactName: parsed.data.body.nome,
    text: extractText(m.text),
    direction: 'inbound',
    timestamp: parseTs(m.timestamp) * 1000, // palm up usa segundos
    referral: extractReferral(m.referral),
  };
}

// ============================================================================
// Helpers
// ============================================================================

function extractText(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object' && 'body' in input) {
    const body = (input as { body?: unknown }).body;
    return typeof body === 'string' ? body : '';
  }
  return '';
}

function parseTs(input: unknown): number {
  if (typeof input === 'number') return input;
  if (typeof input === 'string') {
    const n = Number(input);
    if (Number.isFinite(n)) return n;
  }
  return Date.now();
}

function extractReferral(
  input: z.infer<typeof referralSchema> | undefined | null,
): NormalizedReferral | undefined {
  if (!input) return undefined;
  const ctwa_clid = input.ctwa_clid ?? input.ctwaclid;
  const source_id = input.source_id ?? input.sourceId;
  const source_url = input.source_url ?? input.sourceUrl;
  const source_type = input.source_type ?? input.sourceType;
  const thumbnail_url = input.thumbnail_url ?? input.thumbnailUrl;
  const media_type = input.media_type ?? input.mediaType;

  // Se nenhum campo significativo veio, tratar como ausente
  if (!ctwa_clid && !source_id && !source_url) return undefined;

  return {
    ctwa_clid,
    source_id,
    source_url,
    source_type,
    headline: input.headline,
    body: input.body,
    thumbnail_url,
    ...(media_type !== undefined && { media_type }),
  };
}
