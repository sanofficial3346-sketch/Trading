import React, { useState } from 'react';
import { FileText, AlertTriangle, ArrowUpRight, ArrowDownRight, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { StructureEventLogItem } from '../../../server/setupDetector/structureTypes';

interface StructureEventLogCardProps {
  events: StructureEventLogItem[];
  onFocusCandleTime?: (openTime: string) => void;
}

export const StructureEventLogCard: React.FC<StructureEventLogCardProps> = ({
  events,
  onFocusCandleTime,
}) => {
  const [filterType, setFilterType] = useState<string>('ALL');
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);

  const filteredEvents = events.filter((ev) => {
    if (filterType === 'ALL') return true;
    const type = ev.eventType || '';
    if (filterType === 'BREAKS') return type.includes('BREAK');
    if (filterType === 'CONFIRMED') return type.includes('CONFIRMED');
    if (filterType === 'CANDIDATES') return type.includes('CANDIDATE');
    return true;
  });

  const getEventBadge = (type: string) => {
    if (type.includes('BREAK')) {
      return {
        bg: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
        label: 'STRUCTURE BREAK',
        icon: AlertTriangle,
      };
    }
    if (type.includes('CONFIRMED_BULLISH')) {
      return {
        bg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        label: 'TREND: BULLISH',
        icon: ArrowUpRight,
      };
    }
    if (type.includes('CONFIRMED_BEARISH')) {
      return {
        bg: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
        label: 'TREND: BEARISH',
        icon: ArrowDownRight,
      };
    }
    if (type.includes('CONFIRMED')) {
      return {
        bg: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
        label: 'CONFIRMED POINT',
        icon: CheckCircle2,
      };
    }
    return {
      bg: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
      label: 'EXPANSION LEG',
      icon: ArrowUpRight,
    };
  };

  return (
    <div className="bg-[#080B10] border border-[#1E293B] rounded-xl overflow-hidden shadow-lg font-mono text-xs">
      {/* Header */}
      <div className="bg-[#0C1017] border-b border-[#1E293B] px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-purple-400" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            Structure Engine Event Logs
          </h3>
          <span className="text-[11px] text-[#64748B]">
            ({events.length} chronological audit events)
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Filter Pills */}
          <div className="flex items-center gap-1 bg-[#1E293B]/50 p-0.5 rounded-lg text-[10px]">
            {['ALL', 'BREAKS', 'CONFIRMED', 'CANDIDATES'].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilterType(f)}
                className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                  filterType === f
                    ? 'bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-[#64748B] hover:text-white p-1 cursor-pointer"
            title={isCollapsed ? 'Expand logs' : 'Collapse logs'}
          >
            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Body */}
      {!isCollapsed && (
        <div className="max-h-60 overflow-y-auto divide-y divide-[#1E293B]/40">
          {filteredEvents.length === 0 ? (
            <div className="py-6 text-center text-[#64748B]">
              No events match the selected filter.
            </div>
          ) : (
            filteredEvents.map((ev, idx) => {
              const badge = getEventBadge(ev.eventType || '');
              const BadgeIcon = badge.icon;
              const formattedTime = ev.candleTime
                ? new Date(ev.candleTime).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
                : 'N/A';
              const priceVal = typeof ev.details?.price === 'number' ? ev.details.price.toFixed(2) : null;

              return (
                <div
                  key={ev.id || idx}
                  onClick={() => onFocusCandleTime && ev.candleTime && onFocusCandleTime(ev.candleTime)}
                  className="px-4 py-2.5 hover:bg-[#1E293B]/30 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="flex items-start sm:items-center gap-2.5">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border flex items-center gap-1 shrink-0 ${badge.bg}`}
                    >
                      <BadgeIcon className="w-3 h-3" />
                      {badge.label}
                    </span>
                    <div>
                      <div className="text-slate-200 font-medium">
                        <span className="text-white font-bold">{ev.title}</span>
                        {ev.message && <span className="text-slate-300 ml-1.5">— {ev.message}</span>}
                      </div>
                      <div className="text-[10px] text-[#64748B] flex items-center gap-2 mt-0.5">
                        <span>Time: {formattedTime}</span>
                        {priceVal !== null && (
                          <>
                            <span>•</span>
                            <span className="text-slate-400">
                              Ref: {priceVal}
                            </span>
                          </>
                        )}
                        {typeof ev.details?.fibDepth === 'number' && (
                          <>
                            <span>•</span>
                            <span className="text-cyan-300">
                              Fib: {(ev.details.fibDepth * 100).toFixed(1)}%
                            </span>
                          </>
                        )}
                        {typeof ev.details?.retracementCandles === 'number' && (
                          <>
                            <span>•</span>
                            <span className="text-purple-300">
                              Retrace: {ev.details.retracementCandles} bars
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {onFocusCandleTime && ev.candleTime && (
                    <span className="text-[10px] text-blue-400 hover:text-blue-300 underline shrink-0 sm:self-center">
                      Focus Bar
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
