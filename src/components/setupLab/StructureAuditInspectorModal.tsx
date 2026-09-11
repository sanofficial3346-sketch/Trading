import React, { useState } from 'react';
import {
  X,
  Shield,
  Clock,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Activity,
  ArrowRight,
  Target,
  Layers,
  ChevronRight,
  ExternalLink,
  Flag,
} from 'lucide-react';
import {
  StructureDecisionAudit,
  StructurePoint,
  StructureAuditLabelRecord,
  AuditUserLabel,
  ManualPointType,
} from '../../../server/setupDetector/structureTypes';

interface StructureAuditInspectorModalProps {
  audit: StructureDecisionAudit | null;
  point: StructurePoint | null;
  existingLabel?: StructureAuditLabelRecord | null;
  onClose: () => void;
  onSaveLabel: (labelData: {
    label: AuditUserLabel;
    manualType?: ManualPointType | null;
    manualPrice?: number | null;
    notes?: string;
  }) => Promise<void>;
  onFocusCandleTime?: (time: string) => void;
}

export const StructureAuditInspectorModal: React.FC<StructureAuditInspectorModalProps> = ({
  audit,
  point,
  existingLabel,
  onClose,
  onSaveLabel,
  onFocusCandleTime,
}) => {
  const [selectedTag, setSelectedTag] = useState<AuditUserLabel>(existingLabel?.label || 'CORRECT');
  const [manualType, setManualType] = useState<ManualPointType | ''>(existingLabel?.manualType || '');
  const [manualPrice, setManualPrice] = useState<string>(
    existingLabel?.manualPrice !== undefined && existingLabel?.manualPrice !== null
      ? String(existingLabel.manualPrice)
      : point?.price ? String(point.price) : ''
  );
  const [notes, setNotes] = useState<string>(existingLabel?.notes || '');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  if (!audit && !point) return null;

  const eventType = audit?.eventType || point?.type || 'UNKNOWN';
  const price = audit?.price ?? point?.price ?? 0;
  const time = audit?.timestamp || point?.candleOpenTime || '';
  const seqLabel = audit?.sequenceId || point?.sequenceLabel || eventType;
  const regimeId = audit?.regimeId || point?.regimeId || 'N/A';
  const cycleId = audit?.cycleId || point?.cycleId || 'N/A';

  const isHigh = eventType === 'HH' || eventType === 'LH' || eventType === 'PROVISIONAL_HH';
  const isLow = eventType === 'HL' || eventType === 'LL' || eventType === 'PROVISIONAL_LL';

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await onSaveLabel({
        label: selectedTag,
        manualType: manualType ? (manualType as ManualPointType) : null,
        manualPrice: manualPrice ? parseFloat(manualPrice) : null,
        notes: notes.trim(),
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.error('Failed to save audit label:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[#080B10] border border-[#1E293B] rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-mono">
        {/* Header */}
        <div className="bg-[#0C1017] border-b border-[#1E293B] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-xl flex items-center justify-center ${
                isHigh
                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                  : 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
              }`}
            >
              {isHigh ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-white tracking-wide">
                  {seqLabel} Audit Record
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#1E293B] text-slate-300 border border-slate-700">
                  {audit?.decision || point?.confirmationReason || 'CONFIRMED'}
                </span>
              </div>
              <div className="text-xs text-[#64748B] flex items-center gap-3 mt-0.5">
                <span>Time: {new Date(time).toISOString().replace('T', ' ').slice(0, 19)} UTC</span>
                <span>•</span>
                <span>Price: <strong className="text-white">{price.toFixed(2)}</strong></span>
                <span>•</span>
                <span>Regime: <strong className="text-purple-400">{regimeId}</strong></span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onFocusCandleTime && time && (
              <button
                type="button"
                onClick={() => onFocusCandleTime(time)}
                className="px-3 py-1.5 rounded-lg bg-[#1E293B] hover:bg-[#2A374A] text-slate-300 hover:text-white text-xs flex items-center gap-1.5 transition cursor-pointer"
                title="Focus this candle on chart"
              >
                <Target className="w-3.5 h-3.5 text-cyan-400" />
                Focus Chart
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1E293B] transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-xs text-slate-300">
          {/* Executive Summary Banner */}
          <div className="p-4 rounded-xl bg-[#0C1017] border border-[#1E293B] flex items-start gap-3">
            <Shield className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-bold text-white uppercase tracking-wider">
                Deterministic Decision Rule
              </div>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                {audit?.decisionReason || point?.confirmationReason || 'Structure point locked according to V4 State Machine Retracement and Body Break rules.'}
              </p>
            </div>
          </div>

          {/* Core Decision Parameters Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Break / Expansion Section */}
            <div className="p-4 rounded-xl bg-[#0C1017] border border-[#1E293B] space-y-3">
              <div className="flex items-center justify-between border-b border-[#1E293B] pb-2">
                <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-amber-400" />
                  1. Expansion & Break Check
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded ${
                  audit?.breakRequired ? (audit.breakWasBodyClose ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-amber-500/20 text-amber-300 border border-amber-500/40') : 'bg-slate-800 text-slate-400'
                }`}>
                  {audit?.breakRequired ? (audit.breakWasBodyClose ? 'BODY CLOSE QUALIFIED' : 'PENDING BODY CLOSE') : 'NO BREAK REQUIRED (ANCHOR)'}
                </span>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-[#64748B]">Previous Structural Extreme:</span>
                  <span className="text-white font-medium">
                    {audit?.previousStructuralExtremeType ? `${audit.previousStructuralExtremeType} (${audit.previousStructuralExtremePrice?.toFixed(2)})` : 'None / Initialization Seed'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748B]">Break Threshold Level:</span>
                  <span className="text-cyan-400 font-medium">
                    {audit?.breakLevel !== null && audit?.breakLevel !== undefined ? audit.breakLevel.toFixed(2) : 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748B]">Break Candle Close:</span>
                  <span className="text-white font-medium">
                    {audit?.breakCandle?.close ? audit.breakCandle.close.toFixed(2) : 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748B]">Break Body Close Confirmed:</span>
                  <span className={audit?.breakWasBodyClose ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
                    {audit?.breakWasBodyClose ? 'YES (Strict Close Rule Satisfied)' : 'NO (Wick Only or Anchor)'}
                  </span>
                </div>
                {audit?.breakCandle && (
                  <div className="mt-2 p-2 bg-[#080B10] rounded border border-[#1E293B] text-[11px] text-[#94A3B8] space-y-0.5">
                    <div className="font-bold text-slate-300">Break Candle Detail:</div>
                    <div>Time: {audit.breakCandle.time} (Index #{audit.breakCandle.index})</div>
                    <div>O: {audit.breakCandle.open.toFixed(2)} | H: {audit.breakCandle.high.toFixed(2)} | L: {audit.breakCandle.low.toFixed(2)} | C: {audit.breakCandle.close.toFixed(2)}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Retracement & Fibonacci Section */}
            <div className="p-4 rounded-xl bg-[#0C1017] border border-[#1E293B] space-y-3">
              <div className="flex items-center justify-between border-b border-[#1E293B] pb-2">
                <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-purple-400" />
                  2. Retracement & Fibonacci
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded ${
                  audit?.fibQualified && audit?.candleCountQualified
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                }`}>
                  {audit?.fibQualified && audit?.candleCountQualified ? 'RETRACEMENT QUALIFIED' : 'UNQUALIFIED'}
                </span>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-[#64748B]">Active Reference Anchor:</span>
                  <span className="text-white font-medium">
                    {audit?.previousLockedAnchorType ? `${audit.previousLockedAnchorType} (${audit.previousLockedAnchorPrice?.toFixed(2)})` : 'Warm-Up Seed Anchor'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748B]">Fib Anchor Reference Price:</span>
                  <span className="text-slate-300 font-medium">
                    {audit?.fibAnchorPrice !== null && audit?.fibAnchorPrice !== undefined ? audit.fibAnchorPrice.toFixed(2) : '-'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748B]">Expansion Extreme Price:</span>
                  <span className="text-slate-300 font-medium">
                    {audit?.fibExtremePrice !== null && audit?.fibExtremePrice !== undefined ? audit.fibExtremePrice.toFixed(2) : '-'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748B]">Required Fib Ratio:</span>
                  <span className="text-purple-400 font-bold">
                    {audit?.fibRequiredRatio ? `${(audit.fibRequiredRatio * 100).toFixed(1)}%` : '38.2%'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748B]">Required Fib Price Level:</span>
                  <span className="text-purple-300 font-bold">
                    {audit?.fibRequiredPrice !== null && audit?.fibRequiredPrice !== undefined ? audit.fibRequiredPrice.toFixed(2) : '-'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748B]">Actual Retracement Depth:</span>
                  <span className="text-emerald-400 font-bold">
                    {audit?.actualRetracementRatio !== undefined ? `${(audit.actualRetracementRatio * 100).toFixed(1)}%` : point?.retracementFibDepth ? `${(point.retracementFibDepth * 100).toFixed(1)}%` : '-'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748B]">Retracement Candle Count:</span>
                  <span className="text-cyan-400 font-medium">
                    {audit?.retracementCandleCount !== undefined ? `${audit.retracementCandleCount} bars (min required: ${audit.requiredRetracementCandles ?? 4})` : point?.retracementCandles !== undefined ? `${point.retracementCandles} bars` : '-'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* State Machine Transition Trace */}
          <div className="p-4 rounded-xl bg-[#0C1017] border border-[#1E293B] space-y-2">
            <div className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <ChevronRight className="w-3.5 h-3.5 text-cyan-400" />
              State Machine Context
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-1">
              <div className="p-2 bg-[#080B10] rounded-lg border border-[#1E293B]">
                <div className="text-[10px] text-[#64748B]">Trend State Before:</div>
                <div className="text-white font-bold mt-0.5">{audit?.trendStateBefore || 'UNDEFINED'}</div>
              </div>
              <div className="p-2 bg-[#080B10] rounded-lg border border-[#1E293B]">
                <div className="text-[10px] text-[#64748B]">Trend State After:</div>
                <div className="text-cyan-400 font-bold mt-0.5">{audit?.trendStateAfter || 'BULLISH'}</div>
              </div>
              <div className="p-2 bg-[#080B10] rounded-lg border border-[#1E293B]">
                <div className="text-[10px] text-[#64748B]">Regime ID:</div>
                <div className="text-purple-300 font-bold mt-0.5 truncate">{regimeId}</div>
              </div>
              <div className="p-2 bg-[#080B10] rounded-lg border border-[#1E293B]">
                <div className="text-[10px] text-[#64748B]">Cycle ID:</div>
                <div className="text-amber-300 font-bold mt-0.5 truncate">{cycleId}</div>
              </div>
            </div>
          </div>

          {/* TradingView Manual Markup & Validation Section */}
          <div className="p-4 rounded-xl bg-[#0F172A]/50 border border-blue-500/30 space-y-4">
            <div className="flex items-center justify-between border-b border-blue-500/20 pb-2">
              <div className="flex items-center gap-2">
                <Flag className="w-4 h-4 text-blue-400" />
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  TradingView Divergence Markup & Verification
                </span>
              </div>
              <span className="text-[10px] text-[#64748B]">
                Tag this point against manual TradingView chart
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] text-[#94A3B8] uppercase font-bold tracking-wider block mb-1">
                  Algorithm Classification Status:
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(['CORRECT', 'WRONG', 'MISSING', 'IGNORE'] as AuditUserLabel[]).map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setSelectedTag(tag)}
                      className={`py-1.5 px-2 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                        selectedTag === tag
                          ? tag === 'CORRECT'
                            ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                            : tag === 'WRONG'
                            ? 'bg-rose-500/20 border-rose-500 text-rose-300'
                            : tag === 'MISSING'
                            ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                            : 'bg-slate-700 border-slate-500 text-slate-200'
                          : 'bg-[#080B10] border-[#1E293B] text-[#64748B] hover:text-white'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div>
                    <label className="text-[10px] text-[#94A3B8] uppercase font-bold tracking-wider block mb-1">
                      Expected TradingView Type:
                    </label>
                    <select
                      value={manualType}
                      onChange={(e) => setManualType(e.target.value as ManualPointType)}
                      className="w-full bg-[#080B10] border border-[#1E293B] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="">Match TradeMate ({seqLabel})</option>
                      <option value="M_HH">TradingView: HH</option>
                      <option value="M_HL">TradingView: HL</option>
                      <option value="M_LH">TradingView: LH</option>
                      <option value="M_LL">TradingView: LL</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-[#94A3B8] uppercase font-bold tracking-wider block mb-1">
                      TradingView Price:
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={manualPrice}
                      onChange={(e) => setManualPrice(e.target.value)}
                      placeholder={price.toFixed(2)}
                      className="w-full bg-[#080B10] border border-[#1E293B] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-[#94A3B8] uppercase font-bold tracking-wider block mb-1">
                  Auditor Notes / Reason for Divergence:
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. TradingView shows candle closed below HL at 14:25 UTC, but TradeMate did not confirm break until 14:35 UTC..."
                  rows={4}
                  className="w-full bg-[#080B10] border border-[#1E293B] rounded-lg p-2 text-xs text-white focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-[10px] text-slate-400">
                {existingLabel ? `Previously annotated on ${new Date(existingLabel.updatedAt).toLocaleDateString()}` : 'Not yet annotated'}
              </span>
              <div className="flex items-center gap-2">
                {saveSuccess && (
                  <span className="text-emerald-400 text-xs flex items-center gap-1 font-bold animate-pulse">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Saved!
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow transition cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save Validation Tag'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-[#0C1017] border-t border-[#1E293B] px-6 py-3 flex items-center justify-between text-xs text-[#64748B]">
          <div>
            Algorithm: <span className="text-white font-bold">{audit?.algorithmVersion || 'STRUCTURE_V4_WARMUP_LOCKED'}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#1E293B] hover:bg-[#2A374A] text-slate-300 hover:text-white transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
