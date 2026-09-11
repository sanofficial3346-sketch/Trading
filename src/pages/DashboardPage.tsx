import React, { useState } from 'react';
import { PeriodFilter } from '../types';
import { PeriodSelector } from '../components/PeriodSelector';
import { MetricCard } from '../components/MetricCard';
import { EquityChart } from '../components/EquityChart';
import { EconomicEvents } from '../components/EconomicEvents';
import { PerformanceOverview } from '../components/PerformanceOverview';
import { MarketPnLChart } from '../components/MarketPnLChart';
import { WeeklyWinRateChart } from '../components/WeeklyWinRateChart';
import { RecentTradesTable } from '../components/RecentTradesTable';
import { DrawdownChart } from '../components/DrawdownChart';
import { InsightsPanel } from '../components/InsightsPanel';
import { mockPerformanceMetrics } from '../mockData';

export const DashboardPage: React.FC = () => {
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodFilter>('1M');

  return (
    <div className="flex flex-col gap-4 max-w-[1600px] mx-auto">
      {/* Dashboard Top Header & Period Filter Bar */}
      <div
        id="dashboard-header-banner"
        className="flex justify-between items-center pb-2 border-b border-[#1E293B]"
      >
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            Overview
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
              Execution Ready
            </span>
          </h1>
          <p className="text-xs text-[#64748B]">Real-time quantitative performance metrics</p>
        </div>

        {/* Period filter buttons: 1D, 1W, 1M, 3M, 6M, YTD, 1Y, ALL */}
        <PeriodSelector selected={selectedPeriod} onChange={setSelectedPeriod} />
      </div>

      {/* Row 1: Main Performance Metric Cards (6 cards in one row) */}
      <div
        id="performance-metrics-row"
        className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3"
      >
        {mockPerformanceMetrics.map((metric) => (
          <MetricCard key={metric.id} data={metric} />
        ))}
      </div>

      {/* Row 2: Main Equity Chart + Upcoming Economic Events Panel */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        <div className="xl:col-span-8 flex flex-col">
          <EquityChart
            currentBalance="$12,687.45"
            periodReturn={`+16.78% (${selectedPeriod})`}
            height={280}
          />
        </div>
        <div className="xl:col-span-4 flex flex-col">
          <EconomicEvents />
        </div>
      </div>

      {/* Row 3: Performance Overview (1M), P&L by Market, Win Rate by Day */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch">
        <PerformanceOverview />
        <MarketPnLChart />
        <WeeklyWinRateChart />
      </div>

      {/* Row 4: Recent Trades Table, Drawdown Chart, Insights Panel */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        <div className="xl:col-span-6 flex flex-col">
          <RecentTradesTable />
        </div>
        <div className="xl:col-span-3 flex flex-col">
          <DrawdownChart />
        </div>
        <div className="xl:col-span-3 flex flex-col">
          <InsightsPanel />
        </div>
      </div>
    </div>
  );
};
