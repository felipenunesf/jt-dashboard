import Link from 'next/link';
import { notFound } from 'next/navigation';
import { KpiCard } from '@/components/kpi-card';
import { getAdById } from '@/lib/queries/ads';
import { listLeadsByAd } from '@/lib/queries/leads';
import { daysAgoIso, formatBRL, formatInt, formatPercent, todayIso } from '@/lib/format';
import { LeadStatusBadge } from '@/components/lead-status-badge';

export const dynamic = 'force-dynamic';

export default async function AdDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ adId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { adId } = await params;
  const sp = await searchParams;
  const from = sp.from ?? daysAgoIso(30);
  const to = sp.to ?? todayIso();

  const [ad, leads] = await Promise.all([
    getAdById(adId, { from, to }),
    listLeadsByAd(adId, { from, to }),
  ]);

  if (!ad) {
    notFound();
  }

  return (
    <main className="p-8 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <Link
          href={`/ads?from=${from}&to=${to}`}
          className="text-xs text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"
        >
          ← Voltar para anúncios
        </Link>
      </div>

      <div className="flex items-start gap-5 mb-8">
        {ad.thumbnail_url ? (
          <img
            src={ad.thumbnail_url}
            alt={ad.ad_name ?? 'Ad'}
            className="w-32 h-32 rounded-xl object-cover border border-slate-200"
          />
        ) : (
          <div className="w-32 h-32 rounded-xl bg-slate-100 border border-slate-200" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-500 mb-1">{ad.campaign_name}</p>
          <h1 className="text-xl font-bold text-slate-900 leading-tight">{ad.ad_name}</h1>
          <p className="text-xs text-slate-500 mt-1">
            {ad.adset_name} · ID {ad.ad_id} ·{' '}
            <span
              className={ad.status === 'ACTIVE' ? 'text-emerald-600 font-medium' : 'text-slate-400'}
            >
              {ad.status}
            </span>
          </p>
          {ad.permalink_url && (
            <a
              href={ad.permalink_url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-brand-600 hover:text-brand-700 mt-2 inline-block"
            >
              Ver no Instagram ↗
            </a>
          )}
        </div>
      </div>

      <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-8">
        <KpiCard label="Gasto" value={formatBRL(ad.spend)} highlight />
        <KpiCard label="Impressões" value={formatInt(ad.impressions)} />
        <KpiCard label="Cliques" value={formatInt(ad.clicks)} hint={formatPercent(ad.ctr)} />
        <KpiCard label="Leads" value={formatInt(ad.leads)} hint={formatBRL(ad.cpl)} />
        <KpiCard label="Qualificados" value={formatInt(ad.qualified)} highlight />
        <KpiCard label="CPL Q." value={formatBRL(ad.cpl_qualified)} highlight />
      </section>

      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Leads desse anúncio</h2>
          <span className="text-xs text-slate-500">
            {leads.length} {leads.length === 1 ? 'lead' : 'leads'}
          </span>
        </div>
        {leads.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-400">
            Nenhum lead atribuído a este anúncio no período.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3">Lead</th>
                <th className="px-4 py-3">Origem</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Atribuição</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3 text-right">Quando</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{lead.name ?? '(sem nome)'}</p>
                    <p className="text-xs text-slate-500">{lead.phone ?? lead.email ?? '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-md ${
                        lead.source === 'whatsapp'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-blue-50 text-blue-700'
                      }`}
                    >
                      {lead.source === 'whatsapp' ? 'WhatsApp' : 'Site'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <LeadStatusBadge status={lead.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {lead.attribution_method ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-xs">
                    {lead.purchase_value ? formatBRL(Number(lead.purchase_value)) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-500">
                    {new Date(lead.first_seen_at).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
