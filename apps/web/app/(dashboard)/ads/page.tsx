import { AdsHierarchyTable } from '@/components/ads-hierarchy-table';
import { FilterBar } from '@/components/filter-bar';
import { parseSourceParam } from '@/lib/parse-params';
import { buildHierarchy, getAdsWithMetrics } from '@/lib/queries/ads';
import type { LeadSource } from '@/lib/queries/overview';
import { daysAgoIso, todayIso } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function AdsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; source?: string }>;
}) {
  const params = await searchParams;
  const from = params.from ?? daysAgoIso(7);
  const to = params.to ?? todayIso();
  const source: LeadSource = parseSourceParam(params.source);

  const ads = await getAdsWithMetrics({ from, to, source });
  const campaigns = buildHierarchy(ads);

  return (
    <main className="p-8 max-w-[1400px] mx-auto">
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-slate-900">Anúncios</h1>
        <p className="text-sm text-slate-500 mt-1">
          {ads.length} {ads.length === 1 ? 'anúncio' : 'anúncios'} em {campaigns.length}{' '}
          {campaigns.length === 1 ? 'campanha' : 'campanhas'}
        </p>
      </div>

      <div className="mt-6">
        <FilterBar from={from} to={to} source={source} />
      </div>

      <AdsHierarchyTable campaigns={campaigns} />
    </main>
  );
}
