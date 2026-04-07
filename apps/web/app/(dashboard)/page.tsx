import { KpiCard } from '@/components/kpi-card';
import { FilterBar } from '@/components/filter-bar';
import { parseSourceParam } from '@/lib/parse-params';
import { TimeseriesChart } from '@/components/timeseries-chart';
import { FunnelChart } from '@/components/funnel-chart';
import {
  getFunnel,
  getOverviewKpis,
  getSpendTimeseries,
  type LeadSource,
} from '@/lib/queries/overview';
import { formatBRL, formatInt, formatPercent, daysAgoIso, todayIso } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; source?: string }>;
}) {
  const params = await searchParams;
  const from = params.from ?? daysAgoIso(7);
  const to = params.to ?? todayIso();
  const source: LeadSource = parseSourceParam(params.source);

  const filters = { from, to, source };
  const [kpis, timeseries, funnel] = await Promise.all([
    getOverviewKpis(filters),
    getSpendTimeseries(filters),
    getFunnel(filters),
  ]);

  return (
    <main className="p-8 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Visão geral</h1>
          <p className="text-sm text-slate-500 mt-1">
            Performance consolidada de tráfego pago Meta Ads
          </p>
        </div>
      </div>

      <div className="mt-6">
        <FilterBar from={from} to={to} source={source} />
      </div>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Gasto" value={formatBRL(kpis.spend)} highlight />
        <KpiCard label="Impressões" value={formatInt(kpis.impressions)} />
        <KpiCard
          label="Cliques"
          value={formatInt(kpis.clicks)}
          hint={`CTR ${formatPercent(kpis.ctr)}`}
        />
        <KpiCard
          label="Conversas iniciadas"
          value={formatInt(kpis.messagingStarted)}
          hint="via CTWA (Meta)"
        />
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard label="Leads" value={formatInt(kpis.leads)} hint={formatBRL(kpis.cpl)} />
        <KpiCard label="Qualificados" value={formatInt(kpis.qualified)} highlight />
        <KpiCard label="CPL Qualificado" value={formatBRL(kpis.cplQualified)} highlight />
        <KpiCard
          label="Compras"
          value={formatInt(kpis.purchases)}
          hint={kpis.revenue > 0 ? formatBRL(kpis.revenue) : undefined}
        />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-slate-900">Gasto ao longo do período</h2>
            <p className="text-xs text-slate-500">
              {timeseries.length} {timeseries.length === 1 ? 'dia' : 'dias'}
            </p>
          </div>
          <TimeseriesChart data={timeseries} />
        </section>

        <section className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-slate-900">Funil</h2>
          </div>
          <FunnelChart stages={funnel} />
        </section>
      </div>
    </main>
  );
}
