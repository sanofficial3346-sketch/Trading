import React, { useState } from 'react';
import { Layers, CheckCircle2, AlertCircle, Clock, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { InitializationStructureResult, StructureState } from '../../../server/setupDetector/structureTypes';

interface InitialStructureCardProps {
  initialization: InitializationStructureResult | null | undefined;
  structureState: StructureState;
  showDebug: boolean;
}

export const InitialStructureCard: React.FC<InitialStructureCardProps> = ({
  initialization,
  structureState,
  showDebug,
}) => {
  const [showLogs, setShowLogs] = useState(false);

  if (!initialization) {
    return null;
  }

  const isBearish = initialization.initialState === StructureState.BEARISH;
  const isBullish = initialization.initialState === StructureState.BULLISH;
  const isUndefined = initialization.initialState === StructureState.UNDEFINED;

  const stateBadgeColor = isBearish
    ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
    : isBullish
    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
    : 'bg-slate-500/20 text-slate-400 border-slate-500/30';

  return (
    <div
      id="initial-structure-card"
      className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm backdrop-blur"
    >
      <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-indigo-400" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Initial Structure
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold border ${stateBadgeColor}`}
          >
            {initialization.initialState}
          </span>
          {initialization.initialSequence !== 'NONE' && (
            <span className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-slate-800 text-cyan-300 border border-slate-700">
              {initialization.initialSequence}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-3 text-xs">
        <div>
          <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Found At</span>
          <span className="font-mono font-medium text-slate-200 truncate block">
            {initialization.initialFoundAt
              ? new Date(initialization.initialFoundAt).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: 'UTC',
                }) + ' UTC'
              : 'N/A'}
          </span>
        </div>

        <div>
          <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Warm-Up Used</span>
          <span className="font-mono font-medium text-amber-400">
            {initialization.warmUpCandlesUsed} / {initialization.warmUpCandlesMax} candles
          </span>
        </div>

        {isBearish && (
          <>
            <div>
              <span className="text-[10px] text-amber-400 uppercase tracking-wider block">Initial LH (Lock)</span>
              <span className="font-mono font-semibold text-amber-300">
                {initialization.initialLH ? initialization.initialLH.toFixed(2) : 'N/A'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-rose-400 uppercase tracking-wider block">Initial LL</span>
              <span className="font-mono font-semibold text-rose-300">
                {initialization.initialLL ? initialization.initialLL.toFixed(2) : 'N/A'}
              </span>
            </div>
          </>
        )}

        {isBullish && (
          <>
            <div>
              <span className="text-[10px] text-cyan-400 uppercase tracking-wider block">Initial HL (Lock)</span>
              <span className="font-mono font-semibold text-cyan-300">
                {initialization.initialHL ? initialization.initialHL.toFixed(2) : 'N/A'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-emerald-400 uppercase tracking-wider block">Initial HH</span>
              <span className="font-mono font-semibold text-emerald-300">
                {initialization.initialHH ? initialization.initialHH.toFixed(2) : 'N/A'}
              </span>
            </div>
          </>
        )}

        {isUndefined && (
          <div className="col-span-2">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Status</span>
            <span className="font-mono text-slate-400">
              No valid incoming structure; awaiting chronological discovery
            </span>
          </div>
        )}
      </div>

      {showDebug && initialization.initializationLogs && initialization.initializationLogs.length > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-800/60">
          <button
            type="button"
            onClick={() => setShowLogs(!showLogs)}
            className="w-full flex items-center justify-between text-[11px] text-slate-400 hover:text-slate-200 transition-colors py-1"
          >
            <span className="flex items-center gap-1.5 font-medium">
              <Search className="w-3 h-3 text-indigo-400" />
              Initialization Audit Log ({initialization.initializationLogs.length} events)
            </span>
            {showLogs ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {showLogs && (
            <div className="mt-2 space-y-1 bg-slate-950/70 p-2.5 rounded-lg border border-slate-800 text-[11px] font-mono text-slate-300 max-h-48 overflow-y-auto">
              {initialization.initializationLogs.map((log, idx) => (
                <div key={idx} className="flex items-start gap-1.5 leading-relaxed">
                  <span className="text-slate-600 select-none">›</span>
                  <span
                    className={
                      log.includes('complete') || log.includes('confirmed')
                        ? 'text-emerald-400 font-medium'
                        : log.includes('No valid') || log.includes('UNDEFINED')
                        ? 'text-amber-400'
                        : 'text-slate-300'
                    }
                  >
                    {log}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
