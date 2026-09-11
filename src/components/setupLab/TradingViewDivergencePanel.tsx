import React, { useState } from 'react';
import {
  Compass,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Target,
  FileText,
  Search,
  ChevronRight,
  ExternalLink,
  Plus,
  Trash2,
  Sparkles,
  Zap,
  Info,
} from 'lucide-react';
import {
  StructurePoint,
  StructureAuditLabelRecord,
  FirstDivergenceAnalysis,
  AuditUserLabel,
  ManualPointType,
} from '../../../server/setupDetector/structureTypes';

interface TradingViewDivergencePanelProps {
  points: StructurePoint[];
  labels: StructureAuditLabelRecord[];
  divergenceAnalysis: FirstDivergenceAnalysis | null;
  onSelectPoint: (point: StructurePoint) => void;
  onOpenAuditModal: (point: StructurePoint) => void;
  onFocusCandleTime?: (time: string) => void;
  onDeleteLabel: (id: string) => Promise<void>;
  onAddManualPoint: (point: {
    candleOpenTime: string;
    candleOpenTimeUnix: number;
    manualType: ManualPointType;
    manualPrice: number;
    notes?: string;
  }) => Promise<void>;
}

export const TradingViewDivergencePanel: React.FC<TradingViewDivergencePanelProps> = ({
  points,
  labels,
  divergenceAnalysis,
  onSelectPoint,
  onOpenAuditModal,
  onFocusCandleTime,
  onDeleteLabel,
  onAddManualPoint,
}) => {
  const [showAddManualModal, setShowAddManualModal] = useState<boolean>(false);
  const [newTime, setNewTime] = useState<string>('');
  const [newType, setNewType] = useState<ManualPointType>('M_HH');
  const [newPrice, setNewPrice] = useState<string>('');
  const [newNotes, setNewNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Map labels by timestamp for easy lookup
  const labelsByTime = new Map<number, StructureAuditLabelRecord>();
  labels.forEach((lbl) => {
    labelsByTime.set(lbl.candleOpenTimeUnix, lbl);
  });

  const correctCount = labels.filter((l) => l.label === 'CORRECT').length;
  const wrongCount = labels.filter((l) => l.label === 'WRONG').length;
  const missingCount = labels.filter((l) => l.label === 'MISSING').length;

  const handleCreateManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTime || !newPrice) return;
    try {
      setIsSubmitting(true);
      const parsedTime = new Date(newTime).getTime();
      if (isNaN(parsedTime)) {
        alert('Please enter a valid ISO or date string, e.g. 2026-03-24 14:30');
        return;
      }
      await onAddManualPoint({
        candleOpenTime: new Date(parsedTime).toISOString(),
        candleOpenTimeUnix: parsedTime,
        manualType: newType,
        manualPrice: parseFloat(newPrice),
        notes: newNotes,
      });
      setShowAddManualModal(false);
      setNewTime('');
      setNewPrice('');
      setNewNotes('');
    } catch (err) {
      console.error('Failed to add manual point:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-[#080B10] border border-[#1E293B] rounded-xl overflow-hidden shadow-xl font-mono">
      {/* Header */}
      <div className="bg-[#0C1017] border-b border-[#1E293B] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400">
            <Compass className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              TradingView Divergence Audit Mode
            </h3>
            <p className="text-[11px] text-[#64748B]">
              Benchmark TradeMate structure against your manual TradingView markings to isolate divergence
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-[11px] mr-2">
            <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold">
              {correctCount} Correct
            </span>
            <span className="px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 font-bold">
              {wrongCount} Divergent
            </span>
            <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold">
              {missingCount} Missing
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowAddManualModal(true)}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            Add TradingView Mark
          </button>
        </div>
      </div>

      {/* First Divergence Alert Banner */}
      {divergenceAnalysis && divergenceAnalysis.hasDivergence ? (
        <div className="p-4 bg-rose-950/30 border-b border-rose-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400 shrink-0 mt-0.5">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-rose-300 uppercase tracking-wide">
                  FIRST DIVERGENCE DETECTED
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-rose-900/50 text-rose-200 border border-rose-700">
                  {divergenceAnalysis.divergenceType}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                {divergenceAnalysis.explanation}
              </p>
              {divergenceAnalysis.earliestTime && (
                <div className="text-[11px] text-[#94A3B8] mt-1 flex items-center gap-2">
                  <Clock className="w-3 h-3 text-rose-400" />
                  <span>Time: {new Date(divergenceAnalysis.earliestTime).toISOString().replace('T', ' ').slice(0, 19)} UTC</span>
                  {divergenceAnalysis.algorithmPoint && (
                    <span>• TradeMate: <strong className="text-white">{divergenceAnalysis.algorithmPoint.sequenceLabel || divergenceAnalysis.algorithmPoint.type} @ {divergenceAnalysis.algorithmPoint.price.toFixed(2)}</strong></span>
                  )}
                </div>
              )}
            </div>
          </div>

          {divergenceAnalysis.earliestTime && onFocusCandleTime && (
            <button
              type="button"
              onClick={() => onFocusCandleTime(divergenceAnalysis.earliestTime!)}
              className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1.5 shrink-0 transition cursor-pointer shadow"
            >
              <Target className="w-3.5 h-3.5" />
              Focus Divergence on Chart
            </button>
          )}
        </div>
      ) : (
        <div className="p-3 bg-[#0C1017] border-b border-[#1E293B] flex items-center justify-between text-xs text-[#64748B]">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>
              {labels.length === 0
                ? 'No manual TradingView markup recorded yet. Click "Audit" on any point below or "Add TradingView Mark" to start comparison.'
                : 'All marked structure points currently match your TradingView verification without divergence!'}
            </span>
          </div>
        </div>
      )}

      {/* Side-by-Side Points Comparison Table */}
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#0C1017]/90 text-[#64748B] uppercase text-[10px] sticky top-0 border-b border-[#1E293B]">
            <tr>
              <th className="py-2.5 px-3">Seq / Point</th>
              <th className="py-2.5 px-3">Candle Time (UTC)</th>
              <th className="py-2.5 px-3">TradeMate Price</th>
              <th className="py-2.5 px-3">TradingView Tag</th>
              <th className="py-2.5 px-3">TV Expected</th>
              <th className="py-2.5 px-3">Notes</th>
              <th className="py-2.5 px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1E293B]/40">
            {points.map((pt) => {
              const label = labelsByTime.get(pt.candleOpenTimeUnix);
              const isFirstDivergence =
                divergenceAnalysis?.hasDivergence &&
                divergenceAnalysis?.earliestTimeUnix === pt.candleOpenTimeUnix;

              return (
                <tr
                  key={pt.id}
                  className={`hover:bg-[#111622] transition-colors cursor-pointer ${
                    isFirstDivergence ? 'bg-rose-950/20 border-l-2 border-rose-500' : ''
                  }`}
                  onClick={() => onSelectPoint(pt)}
                >
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span
                      className={`font-bold px-2 py-0.5 rounded text-xs ${
                        pt.type === 'HH'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : pt.type === 'HL'
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                          : pt.type === 'LH'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      }`}
                    >
                      {pt.sequenceLabel || pt.type}
                    </span>
                    {isFirstDivergence && (
                      <span className="ml-2 text-[10px] text-rose-400 font-bold animate-pulse">
                        [1ST DIVERGENCE]
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-slate-300 whitespace-nowrap">
                    {new Date(pt.candleOpenTime).toISOString().replace('T', ' ').slice(0, 16)}
                  </td>
                  <td className="py-2.5 px-3 font-bold text-white whitespace-nowrap">
                    {pt.price.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {label ? (
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          label.label === 'CORRECT'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            : label.label === 'WRONG'
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                            : label.label === 'MISSING'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {label.label}
                      </span>
                    ) : (
                      <span className="text-[#64748B] text-[11px] italic">Untagged</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-slate-300 whitespace-nowrap">
                    {label?.manualType ? (
                      <span className="text-purple-300 font-bold">
                        {label.manualType.replace('M_', '')}{' '}
                        {label.manualPrice ? `@ ${label.manualPrice.toFixed(2)}` : ''}
                      </span>
                    ) : (
                      <span className="text-[#64748B]">-</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-[#94A3B8] text-[11px] max-w-[200px] truncate" title={label?.notes || ''}>
                    {label?.notes || '-'}
                  </td>
                  <td className="py-2.5 px-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => onOpenAuditModal(pt)}
                        className="px-2.5 py-1 rounded bg-[#1E293B] hover:bg-[#2A374A] text-cyan-300 hover:text-cyan-200 text-xs font-bold transition cursor-pointer"
                        title="Open complete deterministic audit details"
                      >
                        Audit
                      </button>
                      {label && (
                        <button
                          type="button"
                          onClick={() => onDeleteLabel(label.id)}
                          className="p-1 rounded text-[#64748B] hover:text-rose-400 hover:bg-[#1E293B] transition cursor-pointer"
                          title="Clear label"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Manual Point Creation Modal */}
      {showAddManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#080B10] border border-[#1E293B] rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#1E293B] pb-2">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <Plus className="w-4 h-4 text-blue-400" />
                Add TradingView Structure Mark
              </h4>
              <button
                type="button"
                onClick={() => setShowAddManualModal(false)}
                className="text-slate-400 hover:text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateManual} className="space-y-3 text-xs">
              <div>
                <label className="text-[10px] text-[#94A3B8] uppercase font-bold tracking-wider block mb-1">
                  Candle Open Time (UTC / ISO string):
                </label>
                <input
                  type="text"
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  placeholder="2026-03-24T14:30:00Z"
                  required
                  className="w-full bg-[#0C1017] border border-[#1E293B] rounded-lg p-2 text-white text-xs focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-[#94A3B8] uppercase font-bold tracking-wider block mb-1">
                    TradingView Classification:
                  </label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as ManualPointType)}
                    className="w-full bg-[#0C1017] border border-[#1E293B] rounded-lg p-2 text-white text-xs focus:outline-none focus:border-blue-500"
                  >
                    <option value="M_HH">Higher High (HH)</option>
                    <option value="M_HL">Higher Low (HL)</option>
                    <option value="M_LH">Lower High (LH)</option>
                    <option value="M_LL">Lower Low (LL)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] text-[#94A3B8] uppercase font-bold tracking-wider block mb-1">
                    Price:
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    placeholder="68450.00"
                    required
                    className="w-full bg-[#0C1017] border border-[#1E293B] rounded-lg p-2 text-white text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] text-[#94A3B8] uppercase font-bold tracking-wider block mb-1">
                  Observations / Divergence Reason:
                </label>
                <textarea
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="TradingView marked this swing high, TradeMate skipped due to 3-bar retrace (needed 4 bars)..."
                  rows={3}
                  className="w-full bg-[#0C1017] border border-[#1E293B] rounded-lg p-2 text-white text-xs focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddManualModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-[#1E293B] text-slate-300 hover:text-white text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Markup'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
