/**
 * Formatadores BR — moeda, percentual, números, datas.
 */

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const integer = new Intl.NumberFormat('pt-BR');

const decimal = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatBRL(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return brl.format(value);
}

export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return integer.format(value);
}

export function formatDecimal(value: number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined) return '—';
  return decimal.format(value) + suffix;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return decimal.format(value) + '%';
}

export function formatDateBr(date: string): string {
  // input: YYYY-MM-DD → DD/MM
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
