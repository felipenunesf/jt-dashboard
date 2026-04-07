import type { ReactNode } from 'react';

interface KpiCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  highlight?: boolean;
}

export function KpiCard({ label, value, hint, highlight }: KpiCardProps) {
  return (
    <div
      className={`bg-white rounded-xl border p-5 transition-shadow hover:shadow-sm ${
        highlight ? 'border-brand-200 bg-brand-50/50' : 'border-slate-200'
      }`}
    >
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${highlight ? 'text-brand-700' : 'text-slate-900'}`}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
