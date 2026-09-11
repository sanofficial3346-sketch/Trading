import React from 'react';
import { mockEconomicEvents, mockNoTradeAlert } from '../mockData';

export const EconomicEvents: React.FC = () => {
  return (
    <div
      id="economic-events-panel"
      className="bg-[#0B0E14] border border-[#1E293B] rounded-xl p-4 shadow-sm flex flex-col justify-between h-full"
    >
      <div>
        {/* Header */}
        <h3 className="text-xs font-bold mb-4 uppercase tracking-wider text-[#64748B]">
          Upcoming Events
        </h3>

        {/* Events List */}
        <div className="space-y-4">
          {mockEconomicEvents.map((event) => {
            const isHigh = event.impact === 'High';
            return (
              <div
                key={event.id}
                id={`event-item-${event.id}`}
                className="flex items-center gap-3"
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    isHigh
                      ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                      : 'bg-orange-500'
                  }`}
                />

                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-white truncate">
                    {event.title}
                  </p>
                  <p className="text-[10px] text-[#475569] font-mono-nums">
                    {event.date} • {event.time}
                  </p>
                </div>

                <span
                  className={`text-[10px] font-bold ${
                    isHigh ? 'text-red-400' : 'text-[#94A3B8]'
                  }`}
                >
                  {event.impact}
                </span>
              </div>
            );
          })}

          {/* Prominent Red Alert Card */}
          <div
            id="no-trade-window-alert"
            className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg"
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[10px] font-bold text-red-500 uppercase tracking-tighter">
                  NO-TRADE WINDOW (NFP)
                </p>
                <p className="text-[11px] font-bold text-white mt-1 font-mono-nums">
                  {mockNoTradeAlert.timeWindow}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[9px] text-red-400 opacity-80 uppercase tracking-wider">
                  STARTS IN
                </p>
                <p className="text-xs font-mono font-bold text-red-400">
                  {mockNoTradeAlert.startsIn}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
