import Link from 'next/link';
import { FilterBar } from '@/components/filter-bar';
import { parseSourceParam } from '@/lib/parse-params';
import { LeadStatusBadge } from '@/components/lead-status-badge';
import { listLeads } from '@/lib/queries/leads';
import { daysAgoIso, formatBRL, formatDateTimeBr, formatWaInstance, todayIso } from '@/lib/format';
import type { LeadSource } from '@/lib/queries/overview';

export const dynamic = 'force-dynamic';

const VALID_INSTANCES = new Set(['jt-ca02', 'jt-ca03']);

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    source?: string;
    q?: string;
    instance?: string;
  }>;
}) {
  const params = await searchParams;
  const from = params.from ?? daysAgoIso(30);
  const to = params.to ?? todayIso();
  const source: LeadSource = parseSourceParam(params.source);
  const search = params.q?.trim() || undefined;
  const instance =
    params.instance && VALID_INSTANCES.has(params.instance) ? params.instance : undefined;

  const leads = await listLeads({ from, to, source, search, instance });

  return (
    <main className="p-8 max-w-[1400px] mx-auto">
      <div className="mb-2 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Leads</h1>
          <p className="text-sm text-slate-500 mt-1">
            {leads.length} {leads.length === 1 ? 'lead' : 'leads'} no período
          </p>
        </div>

        <form className="flex items-center gap-2">
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="to" value={to} />
          <input type="hidden" name="source" value={source} />
          <input
            type="text"
            name="q"
            defaultValue={search ?? ''}
            placeholder="Buscar por nome, telefone ou email..."
            className="px-3 py-2 border border-slate-300 rounded-lg text-xs w-72"
          />
          <button
            type="submit"
            className="px-3 py-2 bg-brand-600 text-white text-xs rounded-lg hover:bg-brand-700"
          >
            Buscar
          </button>
        </form>
      </div>

      <div className="mt-6">
        <FilterBar from={from} to={to} source={source} instance={instance} showInstanceFilter />
      </div>

      {leads.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-sm text-slate-400">
          Nenhum lead encontrado com esses filtros.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3">Lead</th>
                <th className="px-4 py-3">Origem</th>
                <th className="px-4 py-3">Número</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Anúncio</th>
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
                  <td className="px-4 py-3 text-xs text-slate-600 tabular-nums">
                    {formatWaInstance(lead.wa_instance)}
                  </td>
                  <td className="px-4 py-3">
                    <LeadStatusBadge status={lead.status} />
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {lead.ad_id ? (
                      <Link
                        href={`/ads/${lead.ad_id}?from=${from}&to=${to}`}
                        className="text-brand-600 hover:text-brand-700 truncate inline-block max-w-[260px]"
                      >
                        {lead.ad_name ?? lead.ad_id}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {lead.attribution_method ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-xs">
                    {lead.purchase_value ? formatBRL(Number(lead.purchase_value)) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-500">
                    {formatDateTimeBr(lead.first_seen_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
