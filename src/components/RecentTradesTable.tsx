import React from 'react';
import { mockRecentTrades } from '../mockData';

export const RecentTradesTable: React.FC = () => {
  return (
    <div
      id="recent-trades-card"
      className="bg-[#0B0E14] border border-[#1E293B] rounded-xl overflow-hidden shadow-sm"
    >
      <div className="p-4 border-b border-[#1E293B] flex justify-between items-center">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#64748B]">
          Recent Trades
        </h3>
        <span className="text-xs text-blue-500 font-bold hover:underline cursor-pointer">
          View Full Log →
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#1E293B] text-[10px] text-[#64748B] uppercase tracking-wider bg-[#0D1117]">
              <th className="py-2.5 px-4 font-bold">Instrument</th>
              <th className="py-2.5 px-4 font-bold">Type</th>
              <th className="py-2.5 px-4 font-bold text-right">Entry</th>
              <th className="py-2.5 px-4 font-bold text-right">Exit</th>
              <th className="py-2.5 px-4 font-bold text-right">P&L</th>
              <th className="py-2.5 px-4 font-bold text-right">R</th>
              <th className="py-2.5 px-4 font-bold text-right">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1E293B] text-xs font-mono">
            {mockRecentTrades.map((trade) => {
              const isProfit = trade.pnl >= 0;
              const isLong = trade.side === 'LONG';

              return (
                <tr
                  key={trade.id}
                  id={`trade-row-${trade.id}`}
                  className="hover:bg-[#1E293B]/20 transition-colors"
                >
                  <td className="py-2.5 px-4 font-sans font-bold flex items-center gap-2 text-white">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                    {trade.symbol}
                  </td>
                  <td
                    className={`py-2.5 px-4 font-bold ${
                      isLong ? 'text-emerald-500' : 'text-red-500'
                    }`}
                  >
                    {trade.side}
                  </td>
                  <td className="py-2.5 px-4 text-right text-[#94A3B8]">
                    {trade.entry}
                  </td>
                  <td className="py-2.5 px-4 text-right text-[#94A3B8]">
                    {trade.exit}
                  </td>
                  <td
                    className={`py-2.5 px-4 text-right font-bold ${
                      isProfit ? 'text-emerald-500' : 'text-red-500'
                    }`}
                  >
                    {isProfit ? '+' : ''}${trade.pnl.toFixed(2)}
                  </td>
                  <td
                    className={`py-2.5 px-4 text-right font-bold ${
                      isProfit ? 'text-emerald-500' : 'text-red-500'
                    }`}
                  >
                    {isProfit ? '+' : ''}
                    {trade.r.toFixed(1)}R
                  </td>
                  <td className="py-2.5 px-4 text-right text-[#64748B]">
                    {trade.time}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
