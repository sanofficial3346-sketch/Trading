import React from 'react';
import { mockPerformanceOverview } from '../mockData';

export const PerformanceOverview: React.FC = () => {
  const p = mockPerformanceOverview;

  const items = [
    { label: 'Total Trades', value: `${p.totalTrades}`, color: 'text-white' },
    { label: 'Win Rate', value: `${p.winRate}%`, color: 'text-emerald-500' },
    { label: 'Net P&L', value: `+$${p.netPnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, color: 'text-emerald-500' },
    { label: 'Profit Factor', value: `${p.profitFactor}`, color: 'text-blue-400' },
    { label: 'Avg. R / Trade', value: `${p.avgRPerTrade}R`, color: 'text-emerald-500' },
    { label: 'Total Fees', value: `-$${Math.abs(p.totalFees).toFixed(2)}`, color: 'text-red-500' },
    { label: 'Holding Time', value: p.avgHoldingTime, color: 'text-white' },
    { label: 'Best Trade', value: `+$${p.bestTrade.toFixed(2)}`, color: 'text-emerald-500' },
    { label: 'Worst Trade', value: `-$${Math.abs(p.worstTrade).toFixed(2)}`, color: 'text-red-500' },
    { label: 'Max Drawdown', value: `${p.maxDrawdown}%`, color: 'text-red-500' },
  ];

  return (
    <div
      id="performance-overview-card"
      className="bg-[#0B0E14] border border-[#1E293B] rounded-xl p-4 shadow-sm flex flex-col justify-between"
    >
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#1E293B]">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#64748B]">
          Performance (1M)
        </h3>
        <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 font-mono-nums">
          62.5% WR
        </span>
      </div>

      {/* Institutional stats 2-column grid */}
      <div className="grid grid-cols-2 gap-2">
        {items.map((item, idx) => (
          <div
            key={idx}
            className="flex items-center justify-between p-2 rounded-lg bg-[#0D1117] border border-[#1E293B]"
          >
            <span className="text-[11px] text-[#94A3B8]">{item.label}</span>
            <span className={`text-xs font-bold font-mono-nums ${item.color}`}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
