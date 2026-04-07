/**
 * Classificador de mensagens WhatsApp.
 * Verifica se o texto contém uma das frases-padrão configuradas em settings.
 *
 * Robustez:
 * - Case insensitive
 * - Remove acentos antes de comparar (qualifier_phrase pode ter "médicos"
 *   e mensagem ter "medicos")
 * - Remove pontuação adjacente
 *
 * Resolução de welcome_message → ad_id também mora aqui (Plano B caso Z-API
 * não exponha CTWA referral).
 */

export type Classification = 'qualifier_match' | 'purchase_match' | null;

export interface ClassifierConfig {
  qualifierPhrase: string;
  purchasePhrase: string;
}

/**
 * Normaliza texto para comparação fuzzy:
 * - lowercase
 * - remove diacríticos (NFD + filter)
 * - colapsa espaços em branco
 */
export function normalizeForMatch(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove combining marks
    .replace(/\s+/g, ' ')
    .trim();
}

export function classify(text: string, config: ClassifierConfig): Classification {
  if (!text) return null;
  const haystack = normalizeForMatch(text);
  const qualifier = normalizeForMatch(config.qualifierPhrase);
  const purchase = normalizeForMatch(config.purchasePhrase);

  // Purchase tem prioridade (a frase de fechamento implica que qualificou também)
  if (purchase && haystack.includes(purchase)) return 'purchase_match';
  if (qualifier && haystack.includes(qualifier)) return 'qualifier_match';
  return null;
}

/**
 * Tenta resolver `ad_id` via welcome_message_signatures (Plano B).
 * Cada anúncio pode ter uma "welcome_message" diferente; a primeira mensagem
 * do lead geralmente cita esse texto. Se match, retorna o ad_id correspondente.
 *
 * @param text Texto da primeira mensagem do lead
 * @param signatures Mapa { adId: "trecho da welcome message" }
 * @returns adId se houver match, null caso contrário
 */
export function resolveAdByWelcomeMessage(
  text: string,
  signatures: Record<string, string>,
): string | null {
  if (!text || Object.keys(signatures).length === 0) return null;
  const haystack = normalizeForMatch(text);

  for (const [adId, signature] of Object.entries(signatures)) {
    const normalized = normalizeForMatch(signature);
    if (normalized && haystack.includes(normalized)) {
      return adId;
    }
  }
  return null;
}
