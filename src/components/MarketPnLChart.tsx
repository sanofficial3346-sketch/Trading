import React from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { mockMarketPnL } from '../mockData';

export const MarketPnLChart: React.FC = () => {
  // Chart values use absolute values for proportional donut slice representation
  const chartData = mockMarketPnL.map((item) => ({
    name: item.market,
    value: Math.abs(item.pnl),
    actualPnl: item.pnl,
    color: item.color,
  }));

  const totalPnL = '+$1,824.60';

  return (
    <div
      id="market-pnl-card"
      className="bg-[#0B0E14] border border-[#1E293B] rounded-xl p-4 shadow-sm flex flex-col justify-between"
    >
      {/* Card Header */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#1E293B]">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#64748B]">
          P&L by Market (1M)
        </h3>
        <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 font-mono-nums">
          6 Assets
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 items-center gap-3">
        {/* Donut Chart with Center Text */}
        <div className="relative w-full h-[190px] flex items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null;
                  const item = payload[0].payload;
                  return (
                    <div className="bg-[#1E293B] border border-blue-500 rounded p-2 shadow-xl text-xs font-mono-nums">
                      <div className="text-[#94A3B8] font-bold">{item.name}</div>
                      <div
                        className={`font-bold mt-0.5 ${
                          item.actualPnl >= 0 ? 'text-emerald-500' : 'text-red-500'
                        }`}
                      >
                        {item.actualPnl >= 0 ? '+' : ''}$
                        {item.actualPnl.toFixed(2)}
                      </div>
                    </div>
                  );
                }}
              />
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                innerRadius={54}
                outerRadius={76}
                paddingAngle={3}
                stroke="#0B0E14"
                strokeWidth={2}
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>

          {/* Centered Total P&L Text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-sm font-bold text-white font-mono-nums tracking-tight">
              {totalPnL}
            </span>
            <span className="text-[9px] font-bold text-[#64748B] uppercase tracking-wider">
              Total P&L
            </span>
          </div>
        </div>

        {/* Legend / Category breakdown list */}
        <div className="space-y-1.5">
          {mockMarketPnL.map((item) => (
            <div
              key={item.market}
              className="flex items-center justify-between text-xs py-1 px-2.5 rounded-lg bg-[#0D1117] border border-[#1E293B]"
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span className="font-bold text-white text-[11px]">{item.market}</span>
              </div>
              <span
                className={`font-bold font-mono-nums text-xs ${
                  item.pnl >= 0 ? 'text-emerald-500' : 'text-red-500'
                }`}
              >
                {item.pnl >= 0 ? '+' : ''}${item.pnl.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
