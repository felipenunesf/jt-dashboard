import { createHash } from 'node:crypto';

/**
 * Gera um event_id determinístico para Meta CAPI.
 * Mesmo input → mesmo hash, garantindo que reenvios sejam dedupados pela Meta.
 *
 * Componentes:
 * - eventName: "Lead" | "QualifiedLead" | "Purchase"
 * - leadId: UUID interno do lead
 * - triggerId: ID estável do evento que disparou (wa_message_id ou stage_change_timestamp)
 */
export function makeEventId(eventName: string, leadId: string, triggerId: string): string {
  const input = `${eventName}:${leadId}:${triggerId}`;
  return createHash('sha256').update(input).digest('hex');
}
