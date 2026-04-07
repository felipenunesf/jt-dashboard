import type { LeadSource } from '@/lib/queries/overview';

/**
 * Parser de searchParams. Server-safe (sem 'use client').
 */
export function parseSourceParam(value: string | undefined): LeadSource {
  if (value === 'whatsapp' || value === 'site_ghl') return value;
  return 'all';
}
