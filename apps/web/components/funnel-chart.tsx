import type { FunnelStage } from '@/lib/queries/overview';
import { formatInt, formatDecimal } from '@/lib/format';

/**
 * Funil visual estilo "barras empilhadas" — não usa Recharts porque o
 * componente Funnel deles é limitado. Implementação CSS pura, mais bonita
 * e responsiva.
 */
export function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const maxValue = Math.max(...stages.map((s) => s.value), 1);

  return (
    <div className="space-y-3">
      {stages.map((stage, idx) => {
        const widthPct = maxValue > 0 ? (stage.value / maxValue) * 100 : 0;
        const isLast = idx === stages.length - 1;

        return (
          <div key={stage.label} className="group">
            <div className="flex items-center justify-between mb-1.5 text-xs">
              <span className="font-medium text-slate-700">{stage.label}</span>
              <div className="flex items-center gap-3">
                {stage.pctOfPrevious !== null && (
                  <span
                    className={`tabular-nums text-xs ${
                      stage.pctOfPrevious >= 30
                        ? 'text-emerald-600'
                        : stage.pctOfPrevious >= 10
                          ? 'text-amber-600'
                          : 'text-slate-400'
                    }`}
                  >
                    {formatDecimal(stage.pctOfPrevious, '%')} ↓
                  </span>
                )}
                <span className="tabular-nums font-semibold text-slate-900">
                  {formatInt(stage.value)}
                </span>
              </div>
            </div>
            <div className="relative h-9 bg-slate-100 rounded-lg overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ease-out ${
                  isLast
                    ? 'bg-gradient-to-r from-emerald-500 to-emerald-600'
                    : 'bg-gradient-to-r from-brand-500 to-brand-600'
                }`}
                style={{ width: `${Math.max(widthPct, 0.5)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
