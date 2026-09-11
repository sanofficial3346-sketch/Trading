import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  CartesianGrid,
} from 'recharts';
import { mockWeeklyWinRate } from '../mockData';

export const WeeklyWinRateChart: React.FC = () => {
  return (
    <div
      id="weekly-win-rate-card"
      className="bg-[#0B0E14] border border-[#1E293B] rounded-xl p-4 shadow-sm flex flex-col justify-between"
    >
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-[#1E293B]">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#64748B]">
          Win Rate by Day of Week
        </h3>
        <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 font-mono-nums">
          Avg: 61.1%
        </span>
      </div>

      <div className="w-full h-[190px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={mockWeeklyWinRate}
            margin={{ top: 12, right: 10, left: -20, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="4 4"
              stroke="#1E293B"
              vertical={false}
            />
            <XAxis
              dataKey="day"
              stroke="#475569"
              tickLine={false}
              axisLine={{ stroke: '#1E293B' }}
              tickFormatter={(val) => val.slice(0, 3)}
              tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              dy={5}
            />
            <YAxis
              stroke="#475569"
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              tickFormatter={(val) => `${val}%`}
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-[#1E293B] border border-blue-500 rounded p-2 shadow-xl text-xs font-mono-nums">
                    <div className="font-bold text-[#94A3B8]">{d.day}</div>
                    <div
                      className={`font-bold mt-0.5 ${
                        d.isStrong ? 'text-emerald-500' : 'text-red-500'
                      }`}
                    >
                      Win Rate: {d.winRate}%
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="winRate" radius={[4, 4, 0, 0]}>
              {mockWeeklyWinRate.map((entry, index) => (
                <Cell
                  key={`bar-${index}`}
                  fill={entry.isStrong ? '#10b981' : '#ef4444'}
                  fillOpacity={0.9}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-between text-[10px] text-[#64748B] border-t border-[#1E293B] pt-2 mt-1">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          <span>Strong Days (&gt;50%)</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
          <span>Weaker Days (&le;50%)</span>
        </span>
      </div>
    </div>
  );
};
