'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';
import type { LeadSource } from '@/lib/queries/overview';

const PRESETS = [
  { label: 'Hoje', days: 0 },
  { label: '7 dias', days: 7 },
  { label: '14 dias', days: 14 },
  { label: '30 dias', days: 30 },
];

const SOURCES: Array<{ value: LeadSource; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'site_ghl', label: 'Site' },
];

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

interface FilterBarProps {
  from: string;
  to: string;
  source: LeadSource;
  showSourceFilter?: boolean;
}

export function FilterBar({ from, to, source, showSourceFilter = true }: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function update(updates: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      sp.set(key, value);
    }
    startTransition(() => {
      router.push(`${pathname}?${sp.toString()}`);
    });
  }

  function applyPreset(days: number) {
    const newFrom = days === 0 ? new Date().toISOString().slice(0, 10) : isoDaysAgo(days);
    const newTo = new Date().toISOString().slice(0, 10);
    update({ from: newFrom, to: newTo });
  }

  const today = new Date().toISOString().slice(0, 10);
  let activePreset: number | null = null;
  if (to === today) {
    for (const preset of PRESETS) {
      const expectedFrom = preset.days === 0 ? today : isoDaysAgo(preset.days);
      if (from === expectedFrom) {
        activePreset = preset.days;
        break;
      }
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-1">
          {PRESETS.map((preset) => (
            <button
              key={preset.days}
              onClick={() => applyPreset(preset.days)}
              disabled={isPending}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activePreset === preset.days
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {showSourceFilter && (
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-1">
            {SOURCES.map((s) => (
              <button
                key={s.value}
                onClick={() => update({ source: s.value })}
                disabled={isPending}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  source === s.value
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-600">
        <input
          type="date"
          value={from}
          onChange={(e) => update({ from: e.target.value })}
          className="px-2 py-1.5 border border-slate-300 rounded-md text-xs"
        />
        <span>até</span>
        <input
          type="date"
          value={to}
          onChange={(e) => update({ to: e.target.value })}
          className="px-2 py-1.5 border border-slate-300 rounded-md text-xs"
        />
        {isPending && <span className="text-brand-600 ml-2">…</span>}
      </div>
    </div>
  );
}

