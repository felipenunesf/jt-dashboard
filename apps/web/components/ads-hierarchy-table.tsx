'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { CampaignNode } from '@/lib/queries/ads';
import { formatBRL, formatInt, formatPercent } from '@/lib/format';

export function AdsHierarchyTable({ campaigns }: { campaigns: CampaignNode[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (campaigns.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-sm text-slate-400">
        Nenhuma campanha com gasto ou ativa no período selecionado.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
            <th className="px-4 py-3 w-[40%]">Nome</th>
            <th className="px-4 py-3 text-right">Gasto</th>
            <th className="px-4 py-3 text-right">Impressões</th>
            <th className="px-4 py-3 text-right">Cliques</th>
            <th className="px-4 py-3 text-right">CTR</th>
            <th className="px-4 py-3 text-right">Conversas</th>
            <th className="px-4 py-3 text-right">Qualif.</th>
            <th className="px-4 py-3 text-right">CPL Q.</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {campaigns.map((campaign) => (
            <CampaignRow
              key={campaign.campaign_id}
              campaign={campaign}
              expanded={expanded}
              toggle={toggle}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CampaignRow({
  campaign,
  expanded,
  toggle,
}: {
  campaign: CampaignNode;
  expanded: Set<string>;
  toggle: (key: string) => void;
}) {
  const isOpen = expanded.has(campaign.campaign_id);

  return (
    <>
      <tr
        onClick={() => toggle(campaign.campaign_id)}
        className="cursor-pointer hover:bg-slate-50 font-semibold"
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-xs w-3">{isOpen ? '▼' : '▶'}</span>
            <span className="text-slate-900">{campaign.campaign_name}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-slate-900">
          {formatBRL(campaign.spend)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-slate-700">
          {formatInt(campaign.impressions)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-slate-700">
          {formatInt(campaign.clicks)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-slate-700">
          {formatPercent(campaign.ctr)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-slate-700">
          {formatInt(campaign.messaging_started)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-slate-700">
          {formatInt(campaign.qualified)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-brand-700 font-semibold">
          {formatBRL(campaign.cpl_qualified)}
        </td>
      </tr>

      {isOpen &&
        campaign.adsets.map((adset) => {
          const adsetKey = `${campaign.campaign_id}::${adset.adset_id}`;
          const isAdsetOpen = expanded.has(adsetKey);
          return (
            <>
              <tr
                key={adsetKey}
                onClick={() => toggle(adsetKey)}
                className="cursor-pointer hover:bg-slate-50 bg-slate-50/30"
              >
                <td className="px-4 py-2.5 pl-10">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-xs w-3">{isAdsetOpen ? '▼' : '▶'}</span>
                    <span className="text-slate-700">{adset.adset_name}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-800">
                  {formatBRL(adset.spend)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                  {formatInt(adset.impressions)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                  {formatInt(adset.clicks)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600"></td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                  {formatInt(adset.messaging_started)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                  {formatInt(adset.qualified)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                  {formatBRL(adset.cpl_qualified)}
                </td>
              </tr>

              {isAdsetOpen &&
                adset.ads.map((ad) => (
                  <tr key={ad.ad_id} className="hover:bg-brand-50/40 group/ad cursor-pointer">
                    <td className="px-4 py-2 pl-16">
                      <Link
                        href={`/ads/${ad.ad_id}`}
                        className="flex items-center gap-2.5 group-hover/ad:text-brand-700"
                      >
                        {ad.thumbnail_url ? (
                          <img
                            src={ad.thumbnail_url}
                            alt=""
                            className="w-7 h-7 rounded object-cover bg-slate-100"
                          />
                        ) : (
                          <div className="w-7 h-7 rounded bg-slate-100" />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs text-slate-700 truncate max-w-[280px] group-hover/ad:text-brand-700">
                            {ad.ad_name ?? '(sem nome)'}
                          </p>
                          {ad.status && (
                            <p
                              className={`text-[10px] uppercase tracking-wide ${
                                ad.status === 'ACTIVE' ? 'text-emerald-600' : 'text-slate-400'
                              }`}
                            >
                              {ad.status}
                            </p>
                          )}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700 text-xs">
                      {formatBRL(ad.spend)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600 text-xs">
                      {formatInt(ad.impressions)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600 text-xs">
                      {formatInt(ad.clicks)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600 text-xs">
                      {formatPercent(ad.ctr)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600 text-xs">
                      {formatInt(ad.messaging_started)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600 text-xs">
                      {formatInt(ad.qualified)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600 text-xs">
                      {formatBRL(ad.cpl_qualified)}
                    </td>
                  </tr>
                ))}
            </>
          );
        })}
    </>
  );
}
