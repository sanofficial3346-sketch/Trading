import React from 'react';
import { Activity, CheckCircle2, Clock, AlertTriangle, ArrowUpRight, ArrowDownRight, Compass } from 'lucide-react';
import { ActiveRetracementInfo, StructureState, StructurePointType } from '../../../server/setupDetector/structureTypes';

interface ActiveRetracementCardProps {
  activeRetracement: ActiveRetracementInfo | null;
  state: StructureState;
  minCandles: number;
  minFib: number;
}

export const ActiveRetracementCard: React.FC<ActiveRetracementCardProps> = ({
  activeRetracement,
  state,
  minCandles,
  minFib,
}) => {
  if (!activeRetracement) {
    return (
      <div className="bg-[#0C1017] border border-[#1E293B] rounded-xl p-3.5 text-xs font-mono text-[#64748B] flex items-center gap-2">
        <Activity className="w-4 h-4 text-[#475569]" />
        <span>No active retracement being measured in the current candle sequence.</span>
      </div>
    );
  }

  const isCandidateHigh =
    activeRetracement.candidateType === StructurePointType.PROVISIONAL_HH ||
    activeRetracement.candidateType === StructurePointType.HH;

  const currentCandles = activeRetracement.currentRetracementCandles ?? 0;
  const requiredCandles = activeRetracement.requiredRetracementCandles || minCandles || 4;
  const candlePercent = Math.min(
    100,
    Math.round((currentCandles / requiredCandles) * 100)
  );

  const currentFibDepth = typeof activeRetracement.currentFibDepth === 'number' ? activeRetracement.currentFibDepth : 0;
  const targetFibRatio = typeof activeRetracement.fibRatio === 'number' ? activeRetracement.fibRatio : (minFib || 0.382);
  const fibPercent = Math.min(
    100,
    Math.round((currentFibDepth / (targetFibRatio || 0.001)) * 100)
  );

  const candidatePriceStr = typeof activeRetracement.candidatePrice === 'number'
    ? activeRetracement.candidatePrice.toFixed(2)
    : 'None';

  const referencePriceStr = typeof activeRetracement.referencePrice === 'number'
    ? activeRetracement.referencePrice.toFixed(2)
    : 'None';

  const fibLevelPriceStr = typeof activeRetracement.fibLevelPrice === 'number'
    ? activeRetracement.fibLevelPrice.toFixed(2)
    : 'N/A';

  const currentRetracePriceStr = typeof activeRetracement.currentRetracementPrice === 'number'
    ? activeRetracement.currentRetracementPrice.toFixed(2)
    : 'N/A';

  const stateBadgeInfo = {
    [StructureState.UNDEFINED]: {
      label: 'UNDEFINED STRUCTURE',
      bg: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
      icon: Compass,
    },
    [StructureState.BULLISH]: {
      label: 'BULLISH TREND CONFIRMED',
      bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      icon: ArrowUpRight,
    },
    [StructureState.BULLISH_STRUCTURE_BROKEN]: {
      label: 'TRANSITIONAL: BULLISH STRUCTURE BROKEN',
      bg: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
      icon: AlertTriangle,
    },
    [StructureState.BEARISH]: {
      label: 'BEARISH TREND CONFIRMED',
      bg: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
      icon: ArrowDownRight,
    },
    [StructureState.BEARISH_STRUCTURE_BROKEN]: {
      label: 'TRANSITIONAL: BEARISH STRUCTURE BROKEN',
      bg: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
      icon: AlertTriangle,
    },
  }[state] || {
    label: state,
    bg: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    icon: Compass,
  };

  const StateIcon = stateBadgeInfo.icon;

  return (
    <div className="bg-[#080B10] border border-[#1E293B] rounded-xl p-3.5 space-y-3 font-mono text-xs shadow-lg">
      {/* Header with Active State Badge */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1E293B] pb-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            Active Retracement Inspector
          </h3>
        </div>
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-bold border flex items-center gap-1.5 ${stateBadgeInfo.bg}`}
        >
          <StateIcon className="w-3 h-3" />
          {stateBadgeInfo.label}
        </span>
      </div>

      {/* Candidate Point & Reference Level Info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
        <div className="bg-[#0C1017] p-2.5 rounded-lg border border-[#1E293B]">
          <div className="text-[#64748B] flex justify-between items-center">
            <span>Evaluating Candidate:</span>
            <span
              className={`font-bold ${
                isCandidateHigh ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {activeRetracement.candidateType || 'PROVISIONAL'}
            </span>
          </div>
          <div className="text-white font-bold text-base mt-0.5">
            {candidatePriceStr}
          </div>
          {activeRetracement.candidateTime && (
            <div className="text-[10px] text-[#475569] mt-0.5">
              Candidate formed: {new Date(activeRetracement.candidateTime).toISOString().replace('T', ' ').slice(0, 16)} UTC
            </div>
          )}
        </div>

        <div className="bg-[#0C1017] p-2.5 rounded-lg border border-[#1E293B]">
          <div className="text-[#64748B] flex justify-between items-center">
            <span>{isCandidateHigh ? 'Previous Structural HL:' : 'Previous Structural LH:'}</span>
            <span className="text-slate-300 font-medium">Anchor</span>
          </div>
          <div className="text-white font-bold text-base mt-0.5">
            {referencePriceStr}
          </div>
          <div className="text-[10px] text-[#475569] mt-0.5">
            {isCandidateHigh
              ? 'Bullish structure broken if close < this HL'
              : 'Bearish structure broken if close > this LH'}
          </div>
        </div>
      </div>

      {/* Dual Retracement Qualifications */}
      <div className="space-y-2.5 pt-1">
        {/* Criterion 1: Candle Count */}
        <div className="bg-[#0C1017] p-2.5 rounded-lg border border-[#1E293B] space-y-1.5">
          <div className="flex justify-between items-center text-[11px]">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#94A3B8]" />
              <span className="text-[#94A3B8]">1. Retracement Candle Count:</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-white font-bold">
                {currentCandles} / {requiredCandles} bars
              </span>
              <span
                className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                  activeRetracement.isCandleCountQualified
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                }`}
              >
                {activeRetracement.isCandleCountQualified ? 'QUALIFIED' : 'PENDING'}
              </span>
            </div>
          </div>
          <div className="w-full bg-[#1E293B] rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                activeRetracement.isCandleCountQualified ? 'bg-emerald-400' : 'bg-amber-400'
              }`}
              style={{ width: `${candlePercent}%` }}
            />
          </div>
        </div>

        {/* Criterion 2: Fibonacci Depth */}
        <div className="bg-[#0C1017] p-2.5 rounded-lg border border-[#1E293B] space-y-1.5">
          <div className="flex justify-between items-center text-[11px]">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#94A3B8]" />
              <span className="text-[#94A3B8]">2. Retracement Fib Depth (Wick Touch):</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-white font-bold">
                {(currentFibDepth * 100).toFixed(1)}% / {(targetFibRatio * 100).toFixed(1)}%
              </span>
              <span
                className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                  activeRetracement.isFibDepthQualified
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                }`}
              >
                {activeRetracement.isFibDepthQualified ? 'QUALIFIED' : 'PENDING'}
              </span>
            </div>
          </div>
          <div className="w-full bg-[#1E293B] rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                activeRetracement.isFibDepthQualified ? 'bg-emerald-400' : 'bg-amber-400'
              }`}
              style={{ width: `${fibPercent}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-[#64748B] pt-0.5">
            <span>
              Target Fib Level ({(targetFibRatio * 100).toFixed(1)}%):{' '}
              <strong className="text-purple-300">
                {fibLevelPriceStr}
              </strong>
            </span>
            <span>
              Extreme Wick Reached:{' '}
              <strong className="text-slate-300">
                {currentRetracePriceStr}
              </strong>
            </span>
          </div>
        </div>
      </div>

      {/* Overall Qualification Status Summary */}
      <div
        className={`p-2 rounded-lg border text-center text-[11px] font-semibold ${
          activeRetracement.isFullyQualified
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            : 'bg-[#0C1017] border-[#1E293B] text-amber-300/90'
        }`}
      >
        {activeRetracement.isFullyQualified ? (
          <div className="flex items-center justify-center gap-1.5 text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            <span>
              Candidate fully qualified by retracement rules (≥{minCandles} candles and ≥{(targetFibRatio * 100).toFixed(1)}% Fib depth). Confirmed on subsequent close sequence.
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1.5 text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>
              {!activeRetracement.isCandleCountQualified && !activeRetracement.isFibDepthQualified
                ? `Pending both ≥${minCandles} retracement bars and ≥${(targetFibRatio * 100).toFixed(1)}% Fib wick touch.`
                : !activeRetracement.isCandleCountQualified
                ? `Fib depth touched. Waiting for candle count (${currentCandles}/${requiredCandles} bars).`
                : `Candle count satisfied. Waiting for wick to touch ${(targetFibRatio * 100).toFixed(1)}% Fib (${fibLevelPriceStr}).`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
