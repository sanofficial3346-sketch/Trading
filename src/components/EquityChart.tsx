import React, { useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { EquityTabType, EquityDataPoint } from '../types';
import { mockEquityHistory } from '../mockData';

interface EquityChartProps {
  currentBalance?: string;
  periodReturn?: string;
  height?: number;
  data?: EquityDataPoint[];
}

export const EquityChart: React.FC<EquityChartProps> = ({
  currentBalance = '$12,687.45',
  periodReturn = '+16.78% (1M)',
  height = 310,
  data = mockEquityHistory,
}) => {
  const [activeTab, setActiveTab] = useState<EquityTabType>('Equity');

  // Determine data key and formatting based on active tab
  const dataKey =
    activeTab === 'Equity'
      ? 'equity'
      : activeTab === 'Cumulative P&L'
      ? 'cumPnl'
      : 'cumR';

  const formatYAxis = (val: number) => {
    if (activeTab === 'Equity') {
      return `$${(val / 1000).toFixed(1)}k`;
    }
    if (activeTab === 'Cumulative P&L') {
      return `$${val >= 0 ? '+' : ''}${Math.round(val)}`;
    }
    return `${val.toFixed(1)}R`;
  };

  return (
    <div
      id="account-equity-card"
      className="bg-[#0B0E14] border border-[#1E293B] rounded-xl p-4 shadow-sm flex flex-col justify-between"
    >
      {/* Header section with metrics and tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-bold flex items-center gap-2 text-white">
            Account Equity
            <span className="text-xs font-normal text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
              {periodReturn}
            </span>
          </h3>
          <p className="text-xl font-bold text-white font-mono-nums mt-0.5">
            {currentBalance}
          </p>
        </div>

        <div className="flex items-center gap-4 self-start sm:self-auto">
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-[#64748B] uppercase font-bold">Drawdown</span>
            <span className="text-xs font-bold text-red-500 font-mono-nums">-2.14%</span>
          </div>

          {/* 3 Internal Tabs */}
          <div
            id="equity-chart-tabs"
            className="flex bg-[#1E293B]/40 p-0.5 rounded-lg border border-[#1E293B]"
          >
            <button
              id="tab-equity"
              onClick={() => setActiveTab('Equity')}
              className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors cursor-pointer ${
                activeTab === 'Equity'
                  ? 'bg-[#2563EB] text-white'
                  : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              Equity
            </button>
            <button
              id="tab-cum-pnl"
              onClick={() => setActiveTab('Cumulative P&L')}
              className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors cursor-pointer ${
                activeTab === 'Cumulative P&L'
                  ? 'bg-[#2563EB] text-white'
                  : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              P&L
            </button>
            <button
              id="tab-cum-r"
              onClick={() => setActiveTab('Cumulative R')}
              className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors cursor-pointer ${
                activeTab === 'Cumulative R'
                  ? 'bg-[#2563EB] text-white'
                  : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              R-Mult
            </button>
          </div>
        </div>
      </div>

      {/* Recharts Area Chart */}
      <div className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 10, right: 12, left: -10, bottom: 0 }}
          >
            <defs>
              <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
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
              dy={6}
            />

            <YAxis
              stroke="#475569"
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              tickFormatter={formatYAxis}
              domain={['auto', 'auto']}
              dx={-4}
            />

            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const pt = payload[0].payload as EquityDataPoint;
                return (
                  <div className="bg-[#1E293B] border border-blue-500 rounded p-2.5 shadow-xl min-w-[190px] text-xs font-mono-nums">
                    <div className="text-[#94A3B8] font-bold border-b border-[#0B0E14] pb-1 mb-1.5 flex items-center justify-between">
                      <span className="text-[10px] uppercase">{pt.fullDate}</span>
                      <span className="text-[9px] text-emerald-400 font-bold">
                        +{pt.returnPct.toFixed(2)}%
                      </span>
                    </div>

                    <div className="space-y-1 text-[11px]">
                      <div className="flex justify-between items-center">
                        <span className="text-[#64748B]">Equity:</span>
                        <span className="font-bold text-white">
                          ${pt.equity.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[#64748B]">P&L:</span>
                        <span
                          className={`font-bold ${
                            pt.pnl >= 0 ? 'text-emerald-500' : 'text-red-500'
                          }`}
                        >
                          {pt.pnl >= 0 ? '+' : ''}${pt.pnl.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[#64748B]">Wins/Losses:</span>
                        <span className="text-white font-bold">
                          {pt.wins}/{pt.losses}
                        </span>
                      </div>
                      {activeTab === 'Cumulative R' && (
                        <div className="flex justify-between items-center pt-1 text-blue-400">
                          <span>Cumulative R:</span>
                          <span className="font-bold">+{pt.cumR.toFixed(1)}R</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }}
            />

            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={activeTab === 'Cumulative R' ? '#3b82f6' : '#10b981'}
              strokeWidth={2}
              fillOpacity={1}
              fill={activeTab === 'Cumulative R' ? 'url(#pnlGradient)' : 'url(#equityGradient)'}
              activeDot={{
                r: 4,
                fill: activeTab === 'Cumulative R' ? '#3b82f6' : '#10b981',
                stroke: '#ffffff',
                strokeWidth: 2,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
