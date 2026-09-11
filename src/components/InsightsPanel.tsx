import React from 'react';
import { mockInsights } from '../mockData';

export const InsightsPanel: React.FC = () => {
  return (
    <div
      id="insights-panel-card"
      className="bg-[#0B0E14] border border-[#1E293B] rounded-xl p-4 shadow-sm flex flex-col justify-between"
    >
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#1E293B]">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#64748B]">
          Algorithmic Insights
        </h3>
        <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20 font-mono-nums">
          Edge Analysis
        </span>
      </div>

      <div className="space-y-2">
        {mockInsights.map((item) => {
          const isPos = item.type === 'POSITIVE';

          return (
            <div
              key={item.id}
              id={`insight-item-${item.id}`}
              className="p-2.5 rounded-lg bg-[#0D1117] border border-[#1E293B]"
            >
              <div className="flex items-start gap-2">
                <span
                  className={`text-xs font-bold mt-0.5 ${
                    isPos ? 'text-emerald-500' : 'text-red-500'
                  }`}
                >
                  {isPos ? '↑' : '↓'}
                </span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[9px] font-bold uppercase px-1 py-0.2 rounded font-mono-nums tracking-wider ${
                        isPos
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-red-500/10 text-red-400'
                      }`}
                    >
                      {item.type}
                    </span>
                    <span className="text-[10px] font-mono-nums text-[#64748B]">
                      {item.trades} trades
                    </span>
                  </div>

                  <p className="text-xs text-[#94A3B8] mt-1 leading-snug">
                    {item.title}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[10px] font-mono-nums text-[#64748B]">
                    {item.winRate && (
                      <span>
                        WR: <strong className={isPos ? 'text-emerald-400' : 'text-red-400'}>{item.winRate}</strong>
                      </span>
                    )}
                    {item.expectancy && (
                      <span className={isPos ? 'text-emerald-400' : 'text-red-400'}>
                        {item.expectancy}
                      </span>
                    )}
                    {item.profitFactor && (
                      <span>
                        PF: <strong className="text-white">{item.profitFactor}</strong>
                      </span>
                    )}
                    {item.totalR && (
                      <span className="text-red-400 font-bold">
                        {item.totalR}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
