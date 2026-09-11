import React from 'react';
import { Target, ArrowDownRight, ArrowUpRight, ShieldCheck, Lock, AlertTriangle, HelpCircle } from 'lucide-react';
import { StructuralRange, StructureState } from '../../../server/setupDetector/structureTypes';

interface ActiveRangeCardProps {
  activeRange: StructuralRange | null | undefined;
  structureState: StructureState;
  showDebug: boolean;
  lastClose?: number;
  onFocusPriceLevel?: (price: number) => void;
}

export const ActiveRangeCard: React.FC<ActiveRangeCardProps> = ({
  activeRange,
  structureState,
  showDebug,
  lastClose,
}) => {
  if (!activeRange) {
    return null;
  }

  const isBearish = activeRange.direction === 'BEARISH';
  const rangeHeight = Math.abs(activeRange.top.price - activeRange.bottom.price);
  const rangeHeightPct = activeRange.bottom.price > 0 ? (rangeHeight / activeRange.bottom.price) * 100 : 0;

  const currentPriceInside =
    typeof lastClose === 'number' &&
    lastClose >= activeRange.bottom.price &&
    lastClose <= activeRange.top.price;

  return (
    <div
      id="active-range-card"
      className={`border rounded-xl p-4 shadow-md backdrop-blur transition-all ${
        isBearish
          ? 'bg-[#0B0F19]/90 border-amber-500/30'
          : 'bg-[#0B0F19]/90 border-emerald-500/30'
      }`}
    >
      {/* Card Header */}
      <div className="flex flex-wrap items-center justify-between pb-3 border-b border-slate-800 gap-2">
        <div className="flex items-center gap-2">
          <Target className={`w-4 h-4 ${isBearish ? 'text-amber-400' : 'text-emerald-400'}`} />
          <h3 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5 font-mono">
            <span>Active Structural Range (V5 Range-Locked)</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
              {activeRange.rangeId}
            </span>
          </h3>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`px-2.5 py-0.5 rounded text-xs font-mono font-bold border flex items-center gap-1 ${
              isBearish
                ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
            }`}
          >
            {isBearish ? <ArrowDownRight className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
            {activeRange.direction} RANGE
          </span>
          <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800 text-slate-300 border border-slate-700 flex items-center gap-1">
            <Lock className="w-3 h-3 text-cyan-400" />
            RANGE LOCKED
          </span>
        </div>
      </div>

      {/* Primary Range Boundaries Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 py-3">
        {/* Top Boundary */}
        <div
          className={`p-3 rounded-lg border flex flex-col justify-between ${
            isBearish
              ? 'bg-amber-950/15 border-amber-500/25'
              : 'bg-emerald-950/15 border-emerald-500/25'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              {isBearish ? 'Active Top Boundary (LH Anchor)' : 'Active Top Boundary (HH Anchor)'}
            </span>
            <span className="text-xs font-mono font-bold text-emerald-400 px-1.5 py-0.2 rounded bg-emerald-500/10">
              {activeRange.top.label}
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl font-bold font-mono text-white">
              {activeRange.top.price.toFixed(2)}
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              {new Date(activeRange.top.candleTime).toISOString().replace('T', ' ').slice(0, 16)} UTC
            </span>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-800/80 text-[10px] font-mono text-slate-400">
            {isBearish ? (
              <span className="text-amber-300/90">
                Body-close ABOVE this breaks structure (Reversal to Bullish)
              </span>
            ) : (
              <span className="text-emerald-300/90">
                Body-close ABOVE this advances trend (Expansion / New HH)
              </span>
            )}
          </div>
        </div>

        {/* Bottom Boundary */}
        <div
          className={`p-3 rounded-lg border flex flex-col justify-between ${
            isBearish
              ? 'bg-rose-950/15 border-rose-500/25'
              : 'bg-cyan-950/15 border-cyan-500/25'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              {isBearish ? 'Active Bottom Boundary (LL Anchor)' : 'Active Bottom Boundary (HL Anchor)'}
            </span>
            <span className="text-xs font-mono font-bold text-cyan-400 px-1.5 py-0.2 rounded bg-cyan-500/10">
              {activeRange.bottom.label}
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl font-bold font-mono text-white">
              {activeRange.bottom.price.toFixed(2)}
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              {new Date(activeRange.bottom.candleTime).toISOString().replace('T', ' ').slice(0, 16)} UTC
            </span>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-800/80 text-[10px] font-mono text-slate-400">
            {isBearish ? (
              <span className="text-rose-300/90">
                Body-close BELOW this advances trend (Expansion / New LL)
              </span>
            ) : (
              <span className="text-cyan-300/90">
                Body-close BELOW this breaks structure (Reversal to Bearish)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Range Height & Internal Noise Policy Banner */}
      <div className="bg-[#080B10] p-3 rounded-lg border border-slate-800/80 space-y-2 font-mono text-xs">
        <div className="flex flex-wrap items-center justify-between text-[11px]">
          <div className="flex items-center gap-2 text-slate-400">
            <span>Range Span:</span>
            <strong className="text-white">${rangeHeight.toFixed(2)}</strong>
            <span className="text-slate-500">({rangeHeightPct.toFixed(2)}%)</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-400">Current Price:</span>
            <strong className="text-white">{lastClose ? `$${lastClose.toFixed(2)}` : 'N/A'}</strong>
            {currentPriceInside && (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                INSIDE RANGE (IGNORING NOISE)
              </span>
            )}
          </div>
        </div>

        <div className="flex items-start gap-2 pt-2 border-t border-slate-800 text-[11px] text-slate-300">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <strong className="text-white">Strict Range-Locked Principle:</strong> Anything that happens inside this range is{' '}
            <span className="text-amber-300 font-semibold">strictly irrelevant to market structure</span>.
            Wicks beyond boundaries do NOT break structure. Only a <strong>closed candle body-close</strong> beyond{' '}
            <span className="text-amber-300">{activeRange.top.price.toFixed(2)}</span> or{' '}
            <span className="text-rose-300">{activeRange.bottom.price.toFixed(2)}</span> can advance or break structure.
          </div>
        </div>
      </div>
    </div>
  );
};
