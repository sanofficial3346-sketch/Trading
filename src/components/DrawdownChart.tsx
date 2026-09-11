import React from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { mockDrawdownData } from '../mockData';

export const DrawdownChart: React.FC = () => {
  const maxDD = -6.21;

  return (
    <div
      id="drawdown-card"
      className="bg-[#0B0E14] border border-[#1E293B] rounded-xl p-4 shadow-sm flex flex-col justify-between"
    >
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-[#1E293B]">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#64748B]">
          Drawdown
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono-nums font-bold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">
            Max DD: {maxDD}%
          </span>
        </div>
      </div>

      <div className="w-full h-[190px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={mockDrawdownData}
            margin={{ top: 8, right: 10, left: -22, bottom: 0 }}
          >
            <defs>
              <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.0} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0.3} />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="4 4"
              stroke="#1E293B"
              vertical={false}
            />

            <XAxis
              dataKey="date"
              stroke="#475569"
              tickLine={false}
              axisLine={{ stroke: '#1E293B' }}
              tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              dy={5}
            />

            <YAxis
              stroke="#475569"
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              tickFormatter={(val) => `${val}%`}
              domain={[-8, 0]}
              ticks={[0, -2, -4, -6, -8]}
            />

            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const pt = payload[0].payload;
                return (
                  <div className="bg-[#1E293B] border border-blue-500 rounded p-2 shadow-xl text-xs font-mono-nums">
                    <div className="text-[#94A3B8] font-bold">{pt.date}</div>
                    <div className="text-red-500 font-bold mt-0.5">
                      Drawdown: {pt.drawdown.toFixed(2)}%
                    </div>
                  </div>
                );
              }}
            />

            <ReferenceLine
              y={maxDD}
              stroke="#ef4444"
              strokeDasharray="3 3"
              strokeWidth={1}
            />

            <Area
              type="monotone"
              dataKey="drawdown"
              stroke="#ef4444"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#drawdownGradient)"
              activeDot={{
                r: 4,
                fill: '#ef4444',
                stroke: '#ffffff',
                strokeWidth: 2,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-between text-[10px] text-[#64748B] border-t border-[#1E293B] pt-2 mt-1">
        <span>Current Recovery: 100%</span>
        <span className="font-mono-nums text-white font-bold">Peak Equity: $12,687.45</span>
      </div>
    </div>
  );
};
