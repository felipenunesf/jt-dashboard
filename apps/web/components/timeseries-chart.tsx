'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatBRL, formatDateBr, formatInt } from '@/lib/format';

interface Point {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  messagingStarted: number;
}

export function TimeseriesChart({ data }: { data: Point[] }) {
  if (data.length === 0) {
    return (
      <div className="h-72 flex items-center justify-center text-sm text-slate-400">
        Sem dados no período selecionado
      </div>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#1e40af" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#1e40af" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDateBr}
            tick={{ fontSize: 11, fill: '#64748b' }}
            stroke="#cbd5e1"
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#64748b' }}
            stroke="#cbd5e1"
            tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'white',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(label: string) => `Dia ${formatDateBr(label)}`}
            formatter={(value: number, name: string) => {
              if (name === 'spend') return [formatBRL(value), 'Gasto'];
              if (name === 'impressions') return [formatInt(value), 'Impressões'];
              if (name === 'clicks') return [formatInt(value), 'Cliques'];
              if (name === 'messagingStarted') return [formatInt(value), 'Conversas'];
              return [value, name];
            }}
          />
          <Area
            type="monotone"
            dataKey="spend"
            stroke="#1e40af"
            strokeWidth={2}
            fill="url(#spendGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
