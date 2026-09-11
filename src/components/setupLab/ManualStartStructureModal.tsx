import React, { useState } from 'react';
import { X, Play, RotateCcw, Crosshair, HelpCircle, Check, AlertCircle } from 'lucide-react';
import { NormalizedMarketCandle } from '../../../server/marketData/mexcPublicMarketClient';

interface ManualStartStructureModalProps {
  isOpen: boolean;
  onClose: () => void;
  candles: NormalizedMarketCandle[];
  currentManualStart?: {
    direction: 'BULLISH' | 'BEARISH';
    topPrice: string;
    topTime: string;
    bottomPrice: string;
    bottomTime: string;
  } | null;
  onApplyManualStart: (config: {
    direction: 'BULLISH' | 'BEARISH';
    topPrice: number;
    topTime: string;
    bottomPrice: number;
    bottomTime: string;
  }) => void;
  onClearManualStart: () => void;
}

export const ManualStartStructureModal: React.FC<ManualStartStructureModalProps> = ({
  isOpen,
  onClose,
  candles,
  currentManualStart,
  onApplyManualStart,
  onClearManualStart,
}) => {
  const [direction, setDirection] = useState<'BULLISH' | 'BEARISH'>(
    currentManualStart?.direction || 'BEARISH'
  );
  const [topPrice, setTopPrice] = useState<string>(
    currentManualStart?.topPrice || ''
  );
  const [topTime, setTopTime] = useState<string>(
    currentManualStart?.topTime || ''
  );
  const [bottomPrice, setBottomPrice] = useState<string>(
    currentManualStart?.bottomPrice || ''
  );
  const [bottomTime, setBottomTime] = useState<string>(
    currentManualStart?.bottomTime || ''
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  if (!isOpen) return null;

  // Auto-fill from visible candle extrema (e.g. highest high & lowest low in first 50 candles)
  const handleAutoFillExtrema = () => {
    if (candles.length === 0) return;
    const windowSlice = candles.slice(0, Math.min(80, candles.length));

    let maxHigh = -Infinity;
    let maxHighCandle = windowSlice[0];
    let minLow = Infinity;
    let minLowCandle = windowSlice[0];

    windowSlice.forEach((c) => {
      if (c.high > maxHigh) {
        maxHigh = c.high;
        maxHighCandle = c;
      }
      if (c.low < minLow) {
        minLow = c.low;
        minLowCandle = c;
      }
    });

    setTopPrice(maxHighCandle.high.toFixed(2));
    setTopTime(maxHighCandle.openTime);
    setBottomPrice(minLowCandle.low.toFixed(2));
    setBottomTime(minLowCandle.openTime);
    setValidationError(null);
  };

  const handleApply = () => {
    const tPrice = parseFloat(topPrice);
    const bPrice = parseFloat(bottomPrice);

    if (isNaN(tPrice) || tPrice <= 0) {
      setValidationError('Please enter a valid positive Top Price');
      return;
    }
    if (isNaN(bPrice) || bPrice <= 0) {
      setValidationError('Please enter a valid positive Bottom Price');
      return;
    }
    if (tPrice <= bPrice) {
      setValidationError('Top Price must be strictly higher than Bottom Price');
      return;
    }

    const tTime = topTime.trim() || (candles[0]?.openTime || new Date().toISOString());
    const bTime = bottomTime.trim() || (candles[0]?.openTime || new Date().toISOString());

    setValidationError(null);
    onApplyManualStart({
      direction,
      topPrice: tPrice,
      topTime: tTime,
      bottomPrice: bPrice,
      bottomTime: bTime,
    });
    onClose();
  };

  const handleClear = () => {
    onClearManualStart();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-[#0C1017] border border-[#1E293B] rounded-xl max-w-lg w-full p-5 shadow-2xl space-y-4 font-mono">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#1E293B]">
          <div className="flex items-center gap-2">
            <Crosshair className="w-5 h-5 text-amber-400" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Set Starting Structure (V5 Range Seed)
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Manually seed the initial structural range for testing and acceptance verification.
          The V5 engine will lock to this range and strictly track everything that follows.
        </p>

        {validationError && (
          <div className="bg-red-950/30 border border-red-500/40 p-2.5 rounded-lg flex items-center gap-2 text-xs text-red-300">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{validationError}</span>
          </div>
        )}

        {/* Direction Selection */}
        <div className="space-y-1.5">
          <label className="text-xs text-slate-300 font-semibold block">
            1. Starting Range Direction:
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDirection('BEARISH')}
              className={`py-2 px-3 rounded-lg border text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                direction === 'BEARISH'
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                  : 'bg-[#080B10] border-[#1E293B] text-slate-400 hover:text-white'
              }`}
            >
              <span>BEARISH (LH1 / LL1)</span>
            </button>
            <button
              type="button"
              onClick={() => setDirection('BULLISH')}
              className={`py-2 px-3 rounded-lg border text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                direction === 'BULLISH'
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                  : 'bg-[#080B10] border-[#1E293B] text-slate-400 hover:text-white'
              }`}
            >
              <span>BULLISH (HL1 / HH1)</span>
            </button>
          </div>
        </div>

        {/* Top Boundary Form */}
        <div className="space-y-1.5 bg-[#080B10] p-3 rounded-lg border border-[#1E293B]">
          <span className="text-xs font-bold text-amber-300 block">
            {direction === 'BEARISH' ? 'Starting High (Active LH1)' : 'Starting High (Active HH1)'}
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Price ($)</label>
              <input
                type="number"
                step="any"
                placeholder="e.g. 2513.00"
                value={topPrice}
                onChange={(e) => setTopPrice(e.target.value)}
                className="w-full bg-[#1E293B] text-white px-2.5 py-1.5 rounded border border-[#334155] focus:outline-none focus:border-amber-500 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Candle Open Time (ISO or UTC)</label>
              <input
                type="text"
                placeholder="e.g. 2026-03-08T10:00:00.000Z"
                value={topTime}
                onChange={(e) => setTopTime(e.target.value)}
                className="w-full bg-[#1E293B] text-white px-2.5 py-1.5 rounded border border-[#334155] focus:outline-none focus:border-amber-500 text-xs"
              />
            </div>
          </div>
        </div>

        {/* Bottom Boundary Form */}
        <div className="space-y-1.5 bg-[#080B10] p-3 rounded-lg border border-[#1E293B]">
          <span className="text-xs font-bold text-cyan-300 block">
            {direction === 'BEARISH' ? 'Starting Low (Active LL1)' : 'Starting Low (Active HL1)'}
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Price ($)</label>
              <input
                type="number"
                step="any"
                placeholder="e.g. 2473.00"
                value={bottomPrice}
                onChange={(e) => setBottomPrice(e.target.value)}
                className="w-full bg-[#1E293B] text-white px-2.5 py-1.5 rounded border border-[#334155] focus:outline-none focus:border-cyan-500 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Candle Open Time (ISO or UTC)</label>
              <input
                type="text"
                placeholder="e.g. 2026-03-08T11:00:00.000Z"
                value={bottomTime}
                onChange={(e) => setBottomTime(e.target.value)}
                className="w-full bg-[#1E293B] text-white px-2.5 py-1.5 rounded border border-[#334155] focus:outline-none focus:border-cyan-500 text-xs"
              />
            </div>
          </div>
        </div>

        {/* Helper Buttons */}
        <div className="flex items-center justify-between text-xs pt-1">
          <button
            type="button"
            onClick={handleAutoFillExtrema}
            className="text-xs text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
          >
            ⚡ Auto-fill with Highest/Lowest in Window
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-3 border-t border-[#1E293B]">
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset to Auto Detection</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded bg-transparent hover:bg-slate-800 text-slate-400 hover:text-white text-xs transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition shadow-lg cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Apply Starting Range</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
