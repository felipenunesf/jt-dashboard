import { createHash } from 'node:crypto';

/**
 * SHA256 hex (lowercase) — formato exigido pelo Meta CAPI para PII hasheada.
 * Sempre normaliza (trim + lowercase) antes de hashear, conforme spec do Meta.
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

/**
 * Normaliza telefone para E.164 sem o "+" (formato exigido pelo Meta CAPI).
 * - Remove tudo que não é dígito
 * - Garante formato com DDI (assume Brasil 55 se 10 ou 11 dígitos)
 *
 * Exemplos:
 *   "+55 (11) 99999-9999" → "5511999999999"
 *   "11999999999"          → "5511999999999"
 *   "5511999999999"        → "5511999999999"
 */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return digits;
}

/**
 * Hash de telefone normalizado (helper combinado para CAPI).
 */
export function hashPhone(input: string): string {
  return sha256(normalizePhone(input));
}

/**
 * Hash de email (se houver).
 */
export function hashEmail(input: string): string {
  return sha256(input);
}
