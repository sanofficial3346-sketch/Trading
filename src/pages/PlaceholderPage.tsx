import React from 'react';
import {
  ArrowLeftRight,
  BarChart3,
  Lightbulb,
  Compass,
  Calendar,
  ShieldAlert,
  Settings,
  Construction,
  Info,
} from 'lucide-react';
import { PageId } from '../types';

interface PlaceholderPageProps {
  pageId: PageId;
}

const pageConfigs: Record<
  string,
  {
    title: string;
    subtitle: string;
    icon: React.ElementType;
    metrics: { label: string; value: string }[];
  }
> = {
  trades: {
    title: 'Trades Log',
    subtitle: 'Comprehensive execution audit, order types, slippage tracking, and trade journal.',
    icon: ArrowLeftRight,
    metrics: [
      { label: 'Total Logged Trades', value: '48' },
      { label: 'Avg Execution Price', value: '$58,480' },
      { label: 'Win/Loss Ratio', value: '30W / 18L' },
      { label: 'Avg Slippage', value: '0.02%' },
    ],
  },
  analytics: {
    title: 'Advanced Analytics',
    subtitle: 'Statistical distributions, MAE/MFE profiling, and duration correlation matrices.',
    icon: BarChart3,
    metrics: [
      { label: 'Sharpe Ratio', value: '2.14' },
      { label: 'Sortino Ratio', value: '3.42' },
      { label: 'Calmar Ratio', value: '4.80' },
      { label: 'Kelly Criterion', value: '18.4%' },
    ],
  },
  insights: {
    title: 'Insights & Behavior',
    subtitle: 'Rule-adherence diagnostics, psychological leakage detection, and session edge discovery.',
    icon: Lightbulb,
    metrics: [
      { label: 'Active Insights', value: '4' },
      { label: 'Best Setup', value: 'NY Breakout' },
      { label: 'Edge Expectancy', value: '+0.58R' },
      { label: 'Tilt Risk Score', value: 'Low' },
    ],
  },
  strategies: {
    title: 'Strategies & Playbooks',
    subtitle: 'Custom strategy tagging, backtest vs live divergence, and setup profitability breakdown.',
    icon: Compass,
    metrics: [
      { label: 'Active Playbooks', value: '3' },
      { label: 'Top Strategy', value: 'Liquidity Sweep' },
      { label: 'Strategy Win Rate', value: '68.2%' },
      { label: 'Avg Trade Count', value: '16/mo' },
    ],
  },
  'economic-calendar': {
    title: 'Economic Calendar',
    subtitle: 'Institutional macro releases, central bank consensus estimates, and no-trade blackout schedules.',
    icon: Calendar,
    metrics: [
      { label: 'Upcoming High Impact', value: '2 this week' },
      { label: 'Next Event', value: 'ADP Employment' },
      { label: 'Lockout Status', value: 'Armed' },
      { label: 'Primary Currency', value: 'USD / EUR' },
    ],
  },
  'risk-management': {
    title: 'Risk Management',
    subtitle: 'Account circuit breakers, max daily loss safeguards, margin utilization, and position sizing.',
    icon: ShieldAlert,
    metrics: [
      { label: 'Max Risk Per Trade', value: '1.0% ($126.87)' },
      { label: 'Daily Loss Limit', value: '-3.0% ($380.62)' },
      { label: 'Max Open Positions', value: '3 Concurrent' },
      { label: 'Circuit Breaker', value: 'Ready' },
    ],
  },
  settings: {
    title: 'Settings & Configurations',
    subtitle: 'Exchange API credentials, time zones, fee tiers, alert webhooks, and interface preferences.',
    icon: Settings,
    metrics: [
      { label: 'Selected Exchange', value: 'MEXC Global' },
      { label: 'API Connection Mode', value: 'Read-Only Mock' },
      { label: 'Display Currency', value: 'USD ($)' },
      { label: 'Timezone', value: 'America/New_York (EDT)' },
    ],
  },
};

export const PlaceholderPage: React.FC<PlaceholderPageProps> = ({ pageId }) => {
  const config = pageConfigs[pageId] || {
    title: 'Module',
    subtitle: 'Institutional trading analytics section.',
    icon: Info,
    metrics: [],
  };

  const Icon = config.icon;

  return (
    <div className="flex flex-col gap-4 max-w-[1600px] mx-auto">
      {/* Module Header */}
      <div className="flex justify-between items-center pb-2 border-b border-[#1E293B]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600/15 border border-blue-500/25 flex items-center justify-center text-blue-400">
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              {config.title}
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono-nums font-bold">
                Step 1 Interface
              </span>
            </h1>
            <p className="text-xs text-[#64748B]">
              {config.subtitle}
            </p>
          </div>
        </div>
      </div>

      {/* Quick Metrics Bar for Context */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {config.metrics.map((m, idx) => (
          <div
            key={idx}
            className="bg-[#0B0E14] border border-[#1E293B] rounded-xl p-3 hover:border-blue-500/50 transition-all"
          >
            <p className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider">
              {m.label}
            </p>
            <p className="text-lg font-bold text-white font-mono-nums mt-1">
              {m.value}
            </p>
          </div>
        ))}
      </div>

      {/* Structured Notice Card */}
      <div className="bg-[#0B0E14] border border-[#1E293B] rounded-xl p-8 text-center flex flex-col items-center justify-center min-h-[300px]">
        <div className="w-10 h-10 rounded-xl bg-[#0D1117] border border-[#1E293B] flex items-center justify-center text-blue-400 mb-3 shadow-inner">
          <Construction className="w-5 h-5 text-blue-400" />
        </div>
        <h3 className="text-sm font-bold text-white tracking-tight mb-1">
          {config.title} Staging Interface
        </h3>
        <p className="text-xs text-[#64748B] max-w-md mx-auto leading-relaxed">
          Module will be implemented in a later development step.
        </p>
        <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-[#0D1117] border border-[#1E293B] text-[10px] text-[#64748B] font-mono-nums">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
          <span>UI shell verified • Ready for API hookup</span>
        </div>
      </div>
    </div>
  );
};
