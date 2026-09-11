import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  FastForward,
  Clock,
  Shield,
  Activity,
  Layers,
  Sparkles,
  Radio,
  Eye,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  CandleReplayStep,
  StructureState,
  StructurePointType,
} from '../../../server/setupDetector/structureTypes';

interface StructureReplayControlsProps {
  steps: CandleReplayStep[];
  currentStepIndex: number;
  isReplayActive: boolean;
  onToggleReplay: (active: boolean) => void;
  onSetStepIndex: (index: number) => void;
  onJumpToNextEvent: () => void;
  onJumpToPrevEvent: () => void;
}

export const StructureReplayControls: React.FC<StructureReplayControlsProps> = ({
  steps,
  currentStepIndex,
  isReplayActive,
  onToggleReplay,
  onSetStepIndex,
  onJumpToNextEvent,
  onJumpToPrevEvent,
}) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(600); // ms per step
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Playback timer loop
  useEffect(() => {
    if (isPlaying && isReplayActive) {
      timerRef.current = setInterval(() => {
        onSetStepIndex((prev) => {
          if (prev < steps.length - 1) {
            return prev + 1;
          } else {
            setIsPlaying(false);
            return prev;
          }
        });
      }, playbackSpeed);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, isReplayActive, steps.length, playbackSpeed, onSetStepIndex]);

  // If replay mode is turned off, stop playback
  useEffect(() => {
    if (!isReplayActive) {
      setIsPlaying(false);
    }
  }, [isReplayActive]);

  if (!steps || steps.length === 0) return null;

  const currentStep = steps[currentStepIndex] || steps[steps.length - 1];

  const handleStepBack = () => {
    setIsPlaying(false);
    if (currentStepIndex > 0) {
      onSetStepIndex(currentStepIndex - 1);
    }
  };

  const handleStepForward = () => {
    setIsPlaying(false);
    if (currentStepIndex < steps.length - 1) {
      onSetStepIndex(currentStepIndex + 1);
    }
  };

  const handleResetToStart = () => {
    setIsPlaying(false);
    onSetStepIndex(0);
  };

  const handleJumpToLive = () => {
    setIsPlaying(false);
    onSetStepIndex(steps.length - 1);
  };

  const isAtLive = currentStepIndex >= steps.length - 1;

  return (
    <div className="bg-[#080B10] border border-[#1E293B] rounded-xl overflow-hidden shadow-xl font-mono">
      {/* Top Bar: Mode Switcher & Replay Transport Controls */}
      <div className="bg-[#0C1017] border-b border-[#1E293B] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        {/* Mode Toggle Button */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const next = !isReplayActive;
              onToggleReplay(next);
              if (!next) {
                handleJumpToLive();
              }
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-sm ${
              isReplayActive
                ? 'bg-amber-500 text-black shadow-amber-500/20'
                : 'bg-[#1E293B] text-slate-300 hover:text-white hover:bg-[#2A374A]'
            }`}
          >
            <Radio className={`w-3.5 h-3.5 ${isReplayActive ? 'animate-pulse text-black' : 'text-slate-400'}`} />
            {isReplayActive ? 'AUDIT REPLAY ACTIVE' : 'ENTER REPLAY / AUDIT MODE'}
          </button>

          {isReplayActive && (
            <span className="text-[11px] text-[#64748B]">
              Step <strong className="text-white">{currentStepIndex + 1}</strong> of{' '}
              <strong className="text-slate-400">{steps.length}</strong>
            </span>
          )}
        </div>

        {/* Transport Buttons */}
        {isReplayActive && (
          <div className="flex items-center gap-1.5">
            {/* Reset to Start */}
            <button
              type="button"
              onClick={handleResetToStart}
              disabled={currentStepIndex === 0}
              className="p-1.5 rounded bg-[#1E293B] hover:bg-[#2A374A] text-slate-300 disabled:opacity-40 transition cursor-pointer"
              title="Reset to analysis window start"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            {/* Jump Prev Event */}
            <button
              type="button"
              onClick={onJumpToPrevEvent}
              disabled={currentStepIndex === 0}
              className="px-2 py-1 rounded bg-[#1E293B] hover:bg-[#2A374A] text-slate-300 text-xs flex items-center gap-1 disabled:opacity-40 transition cursor-pointer"
              title="Jump to previous structure event (HH, HL, LH, LL, Break)"
            >
              <SkipBack className="w-3.5 h-3.5 text-cyan-400" />
              <span>Prev Event</span>
            </button>

            {/* Step Back 1 Candle */}
            <button
              type="button"
              onClick={handleStepBack}
              disabled={currentStepIndex === 0}
              className="p-1.5 rounded bg-[#1E293B] hover:bg-[#2A374A] text-slate-300 disabled:opacity-40 transition cursor-pointer"
              title="Step backward 1 candle"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {/* Play / Pause */}
            <button
              type="button"
              onClick={() => setIsPlaying(!isPlaying)}
              disabled={isAtLive && !isPlaying}
              className={`px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                isPlaying
                  ? 'bg-amber-500 text-black'
                  : 'bg-cyan-600 hover:bg-cyan-500 text-white'
              }`}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              {isPlaying ? 'Pause' : 'Play'}
            </button>

            {/* Step Forward 1 Candle */}
            <button
              type="button"
              onClick={handleStepForward}
              disabled={isAtLive}
              className="p-1.5 rounded bg-[#1E293B] hover:bg-[#2A374A] text-slate-300 disabled:opacity-40 transition cursor-pointer"
              title="Step forward 1 candle"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            {/* Jump Next Event */}
            <button
              type="button"
              onClick={onJumpToNextEvent}
              disabled={isAtLive}
              className="px-2 py-1 rounded bg-[#1E293B] hover:bg-[#2A374A] text-slate-300 text-xs flex items-center gap-1 disabled:opacity-40 transition cursor-pointer"
              title="Jump to next structure event (HH, HL, LH, LL, Break)"
            >
              <span>Next Event</span>
              <SkipForward className="w-3.5 h-3.5 text-cyan-400" />
            </button>

            {/* Jump to Live */}
            <button
              type="button"
              onClick={handleJumpToLive}
              className={`px-2.5 py-1 rounded text-xs font-bold transition cursor-pointer ${
                isAtLive
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-[#1E293B] hover:bg-[#2A374A] text-slate-300'
              }`}
              title="Jump to most recent closed candle"
            >
              LIVE
            </button>

            {/* Speed Selector */}
            <div className="flex items-center gap-1 pl-2 border-l border-[#1E293B]">
              {[
                { label: '0.5s', val: 500 },
                { label: '1s', val: 1000 },
                { label: '0.2s', val: 200 },
              ].map((s) => (
                <button
                  key={s.val}
                  type="button"
                  onClick={() => setPlaybackSpeed(s.val)}
                  className={`px-1.5 py-0.5 rounded text-[10px] transition cursor-pointer ${
                    playbackSpeed === s.val
                      ? 'bg-purple-500/30 text-purple-300 font-bold border border-purple-500/40'
                      : 'bg-[#080B10] text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Scrubbing Slider Bar */}
      {isReplayActive && (
        <div className="px-4 py-2 border-b border-[#1E293B] bg-[#0A0E15]">
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-[#64748B] whitespace-nowrap">
              {steps[0]?.time?.slice(11, 16) || 'Start'}
            </span>
            <input
              type="range"
              min={0}
              max={steps.length - 1}
              value={currentStepIndex}
              onChange={(e) => {
                setIsPlaying(false);
                onSetStepIndex(parseInt(e.target.value, 10));
              }}
              className="w-full accent-amber-400 cursor-pointer h-1.5 bg-[#1E293B] rounded-lg"
            />
            <span className="text-[10px] text-[#64748B] whitespace-nowrap">
              {steps[steps.length - 1]?.time?.slice(11, 16) || 'Live'}
            </span>
          </div>
        </div>
      )}

      {/* Replay State Inspection HUD */}
      {isReplayActive && currentStep && (
        <div className="p-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-xs bg-[#080B10]">
          {/* 1. Candle & Timestamp */}
          <div className="p-2.5 rounded-lg bg-[#0C1017] border border-[#1E293B]">
            <div className="text-[10px] text-[#64748B] uppercase tracking-wider flex items-center gap-1">
              <Clock className="w-3 h-3 text-cyan-400" />
              Candle Replay Bar
            </div>
            <div className="text-white font-bold mt-1 truncate">
              {currentStep.time ? new Date(currentStep.time).toISOString().replace('T', ' ').slice(0, 16) : 'N/A'}
            </div>
            <div className="text-[11px] text-[#94A3B8] mt-0.5">
              C: <strong className="text-slate-200">{currentStep.close?.toFixed(2)}</strong> (Bar #{currentStep.candleIndex})
            </div>
          </div>

          {/* 2. State Machine State */}
          <div className="p-2.5 rounded-lg bg-[#0C1017] border border-[#1E293B]">
            <div className="text-[10px] text-[#64748B] uppercase tracking-wider">
              Structure Trend State
            </div>
            <div className={`font-bold mt-1 text-xs truncate ${
              currentStep.trendState === StructureState.BULLISH ? 'text-emerald-400' :
              currentStep.trendState === StructureState.BEARISH ? 'text-rose-400' :
              currentStep.trendState === StructureState.BULLISH_STRUCTURE_BROKEN ? 'text-amber-400' :
              currentStep.trendState === StructureState.BEARISH_STRUCTURE_BROKEN ? 'text-purple-400' :
              'text-slate-400'
            }`}>
              {currentStep.trendState || 'UNDEFINED'}
            </div>
            <div className="text-[10px] text-[#64748B] mt-0.5 truncate">
              Regime: {currentStep.regimeId || 'initial'}
            </div>
          </div>

          {/* 3. Active Invalidation Anchor */}
          <div className="p-2.5 rounded-lg bg-[#0C1017] border border-[#1E293B]">
            <div className="text-[10px] text-[#64748B] uppercase tracking-wider flex items-center gap-1">
              <Shield className="w-3 h-3 text-amber-400" />
              Active Locked Invalidation
            </div>
            <div className="text-amber-300 font-bold mt-1 truncate">
              {currentStep.activeLockedAnchor
                ? `${currentStep.activeLockedAnchor.type} @ ${currentStep.activeLockedAnchor.price.toFixed(2)}`
                : 'None Locked'}
            </div>
            <div className="text-[10px] text-[#64748B] mt-0.5">
              Strict body close required
            </div>
          </div>

          {/* 4. Active Extreme / Candidate Tracking */}
          <div className="p-2.5 rounded-lg bg-[#0C1017] border border-[#1E293B]">
            <div className="text-[10px] text-[#64748B] uppercase tracking-wider flex items-center gap-1">
              <Layers className="w-3 h-3 text-purple-400" />
              Candidate Retracement
            </div>
            {currentStep.candidate ? (
              <div>
                <div className="text-purple-300 font-bold mt-1 truncate">
                  {currentStep.candidate.type === StructurePointType.PROVISIONAL_HH ? 'Provisional HH' : 'Provisional LL'} @ {currentStep.candidate.price.toFixed(2)}
                </div>
                <div className="text-[10px] text-cyan-400 mt-0.5">
                  Retrace: {currentStep.candidate.retracementBars} bars | {((currentStep.candidate.currentFibDepth || 0) * 100).toFixed(1)}% Fib
                </div>
              </div>
            ) : (
              <div>
                <div className="text-slate-400 font-bold mt-1 truncate">
                  {currentStep.activeExtreme ? `${currentStep.activeExtreme.type} @ ${currentStep.activeExtreme.price.toFixed(2)}` : 'Waiting for break'}
                </div>
                <div className="text-[10px] text-[#64748B] mt-0.5">No active candidate</div>
              </div>
            )}
          </div>

          {/* 5. Candle Decision / Action */}
          <div className="p-2.5 rounded-lg bg-[#0C1017] border border-[#1E293B]">
            <div className="text-[10px] text-[#64748B] uppercase tracking-wider flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-emerald-400" />
              Candle Action / Decision
            </div>
            {currentStep.confirmedPointCreatedThisCandle ? (
              <div className="text-emerald-400 font-bold mt-1 flex items-center gap-1 truncate">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                {currentStep.confirmedPointCreatedThisCandle} CONFIRMED
              </div>
            ) : currentStep.structureBreakThisCandle ? (
              <div className="text-rose-400 font-bold mt-1 flex items-center gap-1 truncate">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {currentStep.structureBreakThisCandle}
              </div>
            ) : (
              <div className="text-slate-400 mt-1 text-[11px]">
                Tracking / Evaluating
              </div>
            )}
            <div className="text-[10px] text-[#64748B] mt-0.5 truncate">
              {currentStep.confirmedPointCreatedThisCandle || currentStep.structureBreakThisCandle || 'No transition this bar'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
