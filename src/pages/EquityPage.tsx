import React, { useState } from 'react';
import { PeriodFilter } from '../types';
import { PeriodSelector } from '../components/PeriodSelector';
import { EquityChart } from '../components/EquityChart';

export const EquityPage: React.FC = () => {
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodFilter>('1M');

  return (
    <div id="equity-page-container" className="flex flex-col gap-4 max-w-[1600px] mx-auto">
      {/* Header with Title and Period Filter */}
      <div className="flex justify-between items-center pb-2 border-b border-[#1E293B]">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            Equity
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono-nums font-bold">
              Live Curve
            </span>
          </h1>
          <p className="text-xs text-[#64748B]">
            Account growth trajectory, cumulative returns, and risk-adjusted metrics
          </p>
        </div>

        <PeriodSelector selected={selectedPeriod} onChange={setSelectedPeriod} />
      </div>

      {/* Large Mock Equity Chart */}
      <div className="w-full">
        <EquityChart
          currentBalance="$12,687.45"
          periodReturn={`+16.78% (${selectedPeriod})`}
          height={380}
        />
      </div>

      {/* Cards below chart */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {/* Starting Balance */}
        <div className="bg-[#0B0E14] border border-[#1E293B] rounded-xl p-3 hover:border-blue-500/50 transition-all">
          <p className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider">Starting Balance</p>
          <p className="text-lg font-bold text-white font-mono-nums mt-1">$6,500.00</p>
          <p className="text-[10px] text-[#64748B] mt-0.5 font-bold">Initial capital base</p>
        </div>

        {/* Current Balance */}
        <div className="bg-[#0B0E14] border border-[#1E293B] rounded-xl p-3 hover:border-blue-500/50 transition-all">
          <p className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider">Current Balance</p>
          <p className="text-lg font-bold text-white font-mono-nums mt-1">$12,687.45</p>
          <p className="text-[10px] text-emerald-500 mt-0.5 font-bold">+95.19% Growth</p>
        </div>

        {/* Net P&L */}
        <div className="bg-[#0B0E14] border border-[#1E293B] rounded-xl p-3 hover:border-blue-500/50 transition-all">
          <p className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider">Net P&L</p>
          <p className="text-lg font-bold text-emerald-500 font-mono-nums mt-1">+$6,187.45</p>
          <p className="text-[10px] text-[#64748B] mt-0.5 font-bold">After exchange fees</p>
        </div>

        {/* Return */}
        <div className="bg-[#0B0E14] border border-[#1E293B] rounded-xl p-3 hover:border-blue-500/50 transition-all">
          <p className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider">Total Return</p>
          <p className="text-lg font-bold text-emerald-500 font-mono-nums mt-1">+95.19%</p>
          <p className="text-[10px] text-[#64748B] mt-0.5 font-bold">Sharpe: 2.14 • Sortino: 3.42</p>
        </div>

        {/* Max Drawdown */}
        <div className="bg-[#0B0E14] border border-[#1E293B] rounded-xl p-3 hover:border-blue-500/50 transition-all col-span-2 md:col-span-1">
          <p className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider">Max Drawdown</p>
          <p className="text-lg font-bold text-red-500 font-mono-nums mt-1">-6.21%</p>
          <p className="text-[10px] text-[#64748B] mt-0.5 font-bold">Recovery: 4 sessions</p>
        </div>
      </div>
    </div>
  );
};
