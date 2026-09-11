import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  UTCTimestamp,
  createSeriesMarkers,
} from 'lightweight-charts';
import {
  RefreshCw,
  Sliders,
  TrendingUp,
  TrendingDown,
  Info,
  Clock,
  Eye,
  EyeOff,
  AlertCircle,
  Database,
  Layers,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  Sparkles,
  Check,
  Zap,
  Target,
  Crosshair,
} from 'lucide-react';
import { setupLabService } from '../services/setupLabService';
import { MexcContractDirectoryItem, NormalizedMarketCandle } from '../../server/marketData/mexcPublicMarketClient';
import {
  StructureDetectionResult,
  StructurePoint,
  StructurePointType,
  StructureState,
  StructureDecisionAudit,
  StructureAuditLabelRecord,
  FirstDivergenceAnalysis,
  AuditUserLabel,
  ManualPointType,
  assertSingleStructureType,
} from '../../server/setupDetector/structureTypes';
import { SymbolSearchSelector } from '../components/setupLab/SymbolSearchSelector';
import { ActiveRetracementCard } from '../components/setupLab/ActiveRetracementCard';
import { ActiveRangeCard } from '../components/setupLab/ActiveRangeCard';
import { ManualStartStructureModal } from '../components/setupLab/ManualStartStructureModal';
import { StructureEventLogCard } from '../components/setupLab/StructureEventLogCard';
import { InitialStructureCard } from '../components/setupLab/InitialStructureCard';
import { StructureAuditInspectorModal } from '../components/setupLab/StructureAuditInspectorModal';
import { StructureReplayControls } from '../components/setupLab/StructureReplayControls';
import { TradingViewDivergencePanel } from '../components/setupLab/TradingViewDivergencePanel';

const ANALYSIS_CANDLE_PRESETS = [200, 280, 350, 500];
const WARM_UP_PRESETS = [0, 30, 50, 70, 100];
const RETRACEMENT_CANDLE_PRESETS = [2, 3, 4, 5, 6, 8];
const FIB_DEPTH_PRESETS = [
  { label: '23.6%', value: 0.236 },
  { label: '38.2%', value: 0.382 },
  { label: '50.0%', value: 0.500 },
  { label: '61.8%', value: 0.618 },
];

export const SetupLabPage: React.FC = () => {
  // Directory & Symbol State
  const [symbols, setSymbols] = useState<MexcContractDirectoryItem[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>(() => {
    return localStorage.getItem('setupLab.selectedSymbol') || 'BTC_USDT';
  });
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('setupLab.favorites');
      return saved ? JSON.parse(saved) : ['BTC_USDT', 'ETH_USDT', 'XAU_USDT'];
    } catch {
      return ['BTC_USDT', 'ETH_USDT', 'XAU_USDT'];
    }
  });
  const [recents, setRecents] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('setupLab.recents');
      return saved ? JSON.parse(saved) : ['BTC_USDT', 'ETH_USDT'];
    } catch {
      return ['BTC_USDT', 'ETH_USDT'];
    }
  });
  const [showInactive, setShowInactive] = useState<boolean>(false);
  const [refreshingDirectory, setRefreshingDirectory] = useState<boolean>(false);

  // Market & Structure Data State
  const [candles, setCandles] = useState<NormalizedMarketCandle[]>([]);
  const [structure, setStructure] = useState<StructureDetectionResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<StructurePoint | null>(null);

  // Audit Modal & TradingView Validation State
  const [auditModalOpen, setAuditModalOpen] = useState<boolean>(false);
  const [activeAuditRecord, setActiveAuditRecord] = useState<StructureDecisionAudit | null>(null);
  const [activeAuditPoint, setActiveAuditPoint] = useState<StructurePoint | null>(null);
  const [auditLabels, setAuditLabels] = useState<StructureAuditLabelRecord[]>([]);
  const [divergenceAnalysis, setDivergenceAnalysis] = useState<FirstDivergenceAnalysis | null>(null);

  // Structure Replay Mode State
  const [isReplayActive, setIsReplayActive] = useState<boolean>(false);
  const [replayStepIndex, setReplayStepIndex] = useState<number>(0);

  // Manual Starting Structure Tool State (V5 Acceptance / Debugging)
  const [manualStartConfig, setManualStartConfig] = useState<{
    direction: 'BULLISH' | 'BEARISH';
    topPrice: string;
    topTime: string;
    bottomPrice: string;
    bottomTime: string;
  } | null>(() => {
    try {
      const saved = localStorage.getItem('setupLab.manualStart');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [manualStartModalOpen, setManualStartModalOpen] = useState<boolean>(false);

  const structureRef = useRef<StructureDetectionResult | null>(null);
  useEffect(() => {
    structureRef.current = structure;
  }, [structure]);

  // Tunable V4 Parameters (with persistence)
  const [analysisCandles, setAnalysisCandles] = useState<number>(() => {
    const saved = localStorage.getItem('setupLab.analysisCandles');
    const parsed = saved ? parseInt(saved, 10) : 280;
    return isNaN(parsed) ? 280 : Math.max(100, Math.min(1000, parsed));
  });
  const [warmUpCandles, setWarmUpCandles] = useState<number>(() => {
    const saved = localStorage.getItem('setupLab.warmUpCandles');
    const parsed = saved ? parseInt(saved, 10) : 70;
    return isNaN(parsed) ? 70 : Math.max(0, Math.min(200, parsed));
  });
  const lookbackCandles = analysisCandles + warmUpCandles;

  const [minRetracementCandles, setMinRetracementCandles] = useState<number>(() => {
    const saved = localStorage.getItem('setupLab.minRetracementCandles');
    const parsed = saved ? parseInt(saved, 10) : 4;
    return isNaN(parsed) ? 4 : Math.max(1, Math.min(20, parsed));
  });
  const [minRetracementFib, setMinRetracementFib] = useState<number>(() => {
    const saved = localStorage.getItem('setupLab.minRetracementFib');
    const parsed = saved ? parseFloat(saved) : 0.382;
    return isNaN(parsed) ? 0.382 : Math.max(0.1, Math.min(1.0, parsed));
  });
  const [legacyPivotOverlay, setLegacyPivotOverlay] = useState<boolean>(() => {
    return localStorage.getItem('setupLab.legacyPivotOverlay') === 'true';
  });
  const [pivotLeftBars, setPivotLeftBars] = useState<number>(() => {
    const saved = localStorage.getItem('setupLab.pivotLeftBars');
    const parsed = saved ? parseInt(saved, 10) : 2;
    return isNaN(parsed) ? 2 : Math.max(1, Math.min(10, parsed));
  });
  const [pivotRightBars, setPivotRightBars] = useState<number>(() => {
    const saved = localStorage.getItem('setupLab.pivotRightBars');
    const parsed = saved ? parseInt(saved, 10) : 2;
    return isNaN(parsed) ? 2 : Math.max(1, Math.min(10, parsed));
  });

  // Visual Overlays & Display Toggles (with persistence)
  const [showStructure, setShowStructure] = useState<boolean>(() => {
    return localStorage.getItem('setupLab.showStructure') !== 'false';
  });
  const [showSwingHighs, setShowSwingHighs] = useState<boolean>(() => {
    return localStorage.getItem('setupLab.showSwingHighs') !== 'false';
  });
  const [showSwingLows, setShowSwingLows] = useState<boolean>(() => {
    return localStorage.getItem('setupLab.showSwingLows') !== 'false';
  });
  const [showKeyPriceLines, setShowKeyPriceLines] = useState<boolean>(() => {
    return localStorage.getItem('setupLab.showKeyPriceLines') !== 'false';
  });
  const [showSequenceNumbers, setShowSequenceNumbers] = useState<boolean>(() => {
    return localStorage.getItem('setupLab.showSequenceNumbers') !== 'false';
  });
  const [showConnectingLegs, setShowConnectingLegs] = useState<boolean>(() => {
    return localStorage.getItem('setupLab.showConnectingLegs') !== 'false';
  });
  const [showProvisionalStructure, setShowProvisionalStructure] = useState<boolean>(() => {
    return localStorage.getItem('setupLab.showProvisionalStructure') === 'true';
  });
  const [showMarkerPrices, setShowMarkerPrices] = useState<boolean>(() => {
    return localStorage.getItem('setupLab.showMarkerPrices') === 'true';
  });
  const [showInternalDebugEvents, setShowInternalDebugEvents] = useState<boolean>(() => {
    return localStorage.getItem('setupLab.showInternalDebugEvents') === 'true';
  });
  const [cleanChart, setCleanChart] = useState<boolean>(false);
  const [showDebug, setShowDebug] = useState<boolean>(true);
  const [warmUpBoundaryX, setWarmUpBoundaryX] = useState<number | null>(null);

  // Crosshair OHLC inspection state
  const [hoveredCandle, setHoveredCandle] = useState<{
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    isClosed: boolean;
  } | null>(null);

  // Chart References
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const seriesApiRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const structureLineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const markersPrimitiveRef = useRef<any>(null);
  const priceLinesRef = useRef<any[]>([]);

  // Load contract directory from MEXC public API
  const loadDirectory = useCallback(async (forceRefresh = false) => {
    try {
      if (forceRefresh) setRefreshingDirectory(true);
      const list = await setupLabService.getSymbols(forceRefresh, showInactive);
      setSymbols(list);
    } catch (err) {
      console.error('[SetupLabPage] Error loading contract directory:', err);
    } finally {
      if (forceRefresh) setRefreshingDirectory(false);
    }
  }, [showInactive]);

  useEffect(() => {
    loadDirectory(false);
  }, [loadDirectory]);

  // Handle symbol selection
  const handleSelectSymbol = (sym: string) => {
    setSelectedSymbol(sym);
    localStorage.setItem('setupLab.selectedSymbol', sym);
    setRecents((prev) => {
      const next = [sym, ...prev.filter((s) => s !== sym)].slice(0, 8);
      try {
        localStorage.setItem('setupLab.recents', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // Toggle favorite
  const handleToggleFavorite = (sym: string) => {
    setFavorites((prev) => {
      const next = prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym];
      try {
        localStorage.setItem('setupLab.favorites', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // Handle Analysis Candles Change (Default 280)
  const handleAnalysisCandlesChange = (val: number) => {
    const clamped = Math.max(100, Math.min(1000, val));
    setAnalysisCandles(clamped);
    localStorage.setItem('setupLab.analysisCandles', String(clamped));
  };

  // Handle Warm-Up Candles Change (Default 70)
  const handleWarmUpCandlesChange = (val: number) => {
    const clamped = Math.max(0, Math.min(200, val));
    setWarmUpCandles(clamped);
    localStorage.setItem('setupLab.warmUpCandles', String(clamped));
  };

  // Handle Minimum Retracement Candles Change
  const handleMinRetracementCandlesChange = (val: number) => {
    const clamped = Math.max(1, Math.min(20, val));
    setMinRetracementCandles(clamped);
    localStorage.setItem('setupLab.minRetracementCandles', String(clamped));
  };

  // Handle Minimum Fibonacci Retracement Depth Change
  const handleMinRetracementFibChange = (val: number) => {
    const clamped = Math.max(0.1, Math.min(1.0, val));
    setMinRetracementFib(clamped);
    localStorage.setItem('setupLab.minRetracementFib', String(clamped));
  };

  // Handle Legacy Pivot Comparison Overlay Toggle
  const handleToggleLegacyPivotOverlay = (val: boolean) => {
    setLegacyPivotOverlay(val);
    localStorage.setItem('setupLab.legacyPivotOverlay', String(val));
  };

  // Handle Pivot Left Change
  const handlePivotLeftChange = (val: number) => {
    const clamped = Math.max(1, Math.min(10, val));
    setPivotLeftBars(clamped);
    localStorage.setItem('setupLab.pivotLeftBars', String(clamped));
  };

  // Handle Pivot Right Change
  const handlePivotRightChange = (val: number) => {
    const clamped = Math.max(1, Math.min(10, val));
    setPivotRightBars(clamped);
    localStorage.setItem('setupLab.pivotRightBars', String(clamped));
  };

  // Handle Structure Overlay Toggles
  const handleToggleShowStructure = (val: boolean) => {
    setShowStructure(val);
    localStorage.setItem('setupLab.showStructure', String(val));
    if (val && cleanChart) {
      setCleanChart(false);
    }
  };

  const handleToggleSwingHighs = (val: boolean) => {
    setShowSwingHighs(val);
    localStorage.setItem('setupLab.showSwingHighs', String(val));
    if (val && cleanChart) {
      setCleanChart(false);
    }
  };

  const handleToggleSwingLows = (val: boolean) => {
    setShowSwingLows(val);
    localStorage.setItem('setupLab.showSwingLows', String(val));
    if (val && cleanChart) {
      setCleanChart(false);
    }
  };

  const handleToggleKeyPriceLines = (val: boolean) => {
    setShowKeyPriceLines(val);
    localStorage.setItem('setupLab.showKeyPriceLines', String(val));
  };

  const handleToggleSequenceNumbers = (val: boolean) => {
    setShowSequenceNumbers(val);
    localStorage.setItem('setupLab.showSequenceNumbers', String(val));
  };

  const handleToggleConnectingLegs = (val: boolean) => {
    setShowConnectingLegs(val);
    localStorage.setItem('setupLab.showConnectingLegs', String(val));
  };

  const handleToggleProvisionalStructure = (val: boolean) => {
    setShowProvisionalStructure(val);
    localStorage.setItem('setupLab.showProvisionalStructure', String(val));
  };

  const handleToggleMarkerPrices = (val: boolean) => {
    setShowMarkerPrices(val);
    localStorage.setItem('setupLab.showMarkerPrices', String(val));
  };

  const handleToggleInternalDebugEvents = (val: boolean) => {
    setShowInternalDebugEvents(val);
    localStorage.setItem('setupLab.showInternalDebugEvents', String(val));
  };

  // Clean Chart Mode: Toggles clean chart
  const handleToggleCleanChart = () => {
    setCleanChart((prev) => !prev);
  };

  // Force clean recompute from raw MEXC candles, clearing UI marker state first
  const handleForceCleanRecompute = async () => {
    try {
      setSyncing(true);
      // Clear calculated UI marker state first per Requirement 17
      setStructure(null);
      if (markersPrimitiveRef.current && typeof markersPrimitiveRef.current.setMarkers === 'function') {
        try {
          markersPrimitiveRef.current.setMarkers([]);
        } catch {}
      }
      priceLinesRef.current.forEach((l) => {
        try {
          seriesApiRef.current?.removePriceLine(l);
        } catch {}
      });
      priceLinesRef.current = [];
      structureLineSeriesRef.current?.setData([]);
      await loadData(true);
    } finally {
      setSyncing(false);
    }
  };

  // Reset Parameters to Official Defaults
  const handleResetParameters = () => {
    handleAnalysisCandlesChange(280);
    handleWarmUpCandlesChange(70);
    handleMinRetracementCandlesChange(4);
    handleMinRetracementFibChange(0.382);
    handleToggleLegacyPivotOverlay(false);
    handlePivotLeftChange(2);
    handlePivotRightChange(2);
    handleToggleShowStructure(true);
    handleToggleSwingHighs(true);
    handleToggleSwingLows(true);
    handleToggleKeyPriceLines(true);
    handleToggleSequenceNumbers(true);
    handleToggleConnectingLegs(true);
    handleToggleProvisionalStructure(false);
    setCleanChart(false);
  };

  // Fetch candle data and run market structure detection
  const loadData = useCallback(async (isManualSync: boolean = false) => {
    try {
      if (isManualSync) setSyncing(true);
      setErrorMessage(null);

      // Fetch enough candles to cover the total window (analysis + warm-up) plus buffer
      const fetchLimit = Math.max(analysisCandles + warmUpCandles + 50, 450);

      if (isManualSync) {
        await setupLabService.syncCandles(selectedSymbol, fetchLimit);
      }

      const manualStartParam = manualStartConfig
        ? {
            direction: manualStartConfig.direction,
            top: {
              price: parseFloat(manualStartConfig.topPrice),
              candleTime: manualStartConfig.topTime,
            },
            bottom: {
              price: parseFloat(manualStartConfig.bottomPrice),
              candleTime: manualStartConfig.bottomTime,
            },
          }
        : undefined;

      const [candleData, structureData, labelsData] = await Promise.all([
        setupLabService.getCandles(selectedSymbol, fetchLimit),
        setupLabService.getStructure(selectedSymbol, {
          minimumRetracementCandles: minRetracementCandles,
          minimumRetracementFib: minRetracementFib,
          analysisCandles,
          warmUpCandles,
          legacyPivotOverlay,
          showSequenceNumbers,
          pivotLeftBars,
          pivotRightBars,
          manualStart: manualStartParam,
        }),
        setupLabService.getAuditLabels(selectedSymbol, '5M'),
      ]);

      setCandles(candleData.candles);
      setStructure(structureData);
      setAuditLabels(labelsData || []);

      if (structureData?.points && labelsData) {
        setupLabService.calculateDivergence(structureData.points, labelsData).then((div) => {
          setDivergenceAnalysis(div);
        });
      }

      if (!isReplayActive && structureData?.candleReplaySteps && structureData.candleReplaySteps.length > 0) {
        setReplayStepIndex(structureData.candleReplaySteps.length - 1);
      }
    } catch (err: unknown) {
      setErrorMessage((err as Error).message || 'Failed to load market data');
    } finally {
      setLoading(false);
      if (isManualSync) setSyncing(false);
    }
  }, [
    selectedSymbol,
    minRetracementCandles,
    minRetracementFib,
    analysisCandles,
    warmUpCandles,
    legacyPivotOverlay,
    showSequenceNumbers,
    pivotLeftBars,
    pivotRightBars,
    manualStartConfig,
  ]);

  // Debounced load when symbol or parameters change
  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      loadData(false);
    }, 200);

    return () => clearTimeout(timer);
  }, [loadData]);

  // Auto-refresh timer (conservative 15-second polling interval for public MEXC data)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      loadData(false);
    }, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadData]);

  // Structure Replay Step & Sliced Data
  const currentReplayStep =
    isReplayActive && structure?.candleReplaySteps && structure.candleReplaySteps[replayStepIndex]
      ? structure.candleReplaySteps[replayStepIndex]
      : null;

  const displayedCandles = useMemo(() => {
    if (!isReplayActive || !currentReplayStep) return candles;
    return candles.filter((c) => c.openTimeUnix <= currentReplayStep.openTimeUnix);
  }, [candles, isReplayActive, currentReplayStep]);

  const displayedPoints = useMemo(() => {
    if (!structure?.points) return [];
    if (!isReplayActive || !currentReplayStep) return structure.points;
    return structure.points.filter((pt) => pt.candleOpenTimeUnix <= currentReplayStep.openTimeUnix);
  }, [structure, isReplayActive, currentReplayStep]);

  const activeAlgorithmVersion = structure?.algorithmVersion || 'STRUCTURE_V6_FIB_QUALIFIED_RANGE';

  // Confirmed External Structure Points ONLY: strictly HH, HL, LH, LL
  const confirmedExternalPoints = useMemo(() => {
    if (!structure?.points || cleanChart || !showStructure) return [];

    const allowedTypes = new Set([
      StructurePointType.HH,
      StructurePointType.HL,
      StructurePointType.LH,
      StructurePointType.LL,
    ]);

    const seenEventIds = new Set<string>();
    const seenCandleMap = new Map<number, StructurePoint>();
    const result: StructurePoint[] = [];

    // Filter points as of current replay step (if replay active)
    const pointsToProcess = isReplayActive && currentReplayStep
      ? structure.points.filter((pt) => pt.candleOpenTimeUnix <= currentReplayStep.openTimeUnix)
      : structure.points;

    for (const pt of pointsToProcess) {
      // Must be confirmed external structure
      if (pt.confirmed !== true && pt.structureScope !== 'EXTERNAL') continue;
      // Must not be provisional
      if (pt.isProvisional) continue;
      // Must belong to active algorithm version
      const isV6Family = (v?: string) => v === 'STRUCTURE_V6_FIB_QUALIFIED_RANGE' || v === 'STRUCTURE_V6_FIB_QUALIFIED_RANGE_REV2';
      if (pt.algorithmVersion && pt.algorithmVersion !== activeAlgorithmVersion && !(isV6Family(pt.algorithmVersion) && isV6Family(activeAlgorithmVersion))) continue;
      // Must be one of the four allowed types
      if (!allowedTypes.has(pt.type)) continue;
      // Validate hard invariant: single structure type
      if (!assertSingleStructureType(pt)) {
        console.error(`[Invariant Error] Multiple or invalid types in structure event rejected in UI:`, pt);
        continue;
      }

      // Deduplicate by algorithmVersion + eventId
      const eventKey = `${pt.algorithmVersion || activeAlgorithmVersion}_${pt.eventId || pt.id}`;
      if (seenEventIds.has(eventKey)) continue;
      seenEventIds.add(eventKey);

      // Enforce: exactly one type per structural point / candle
      const existingAtCandle = seenCandleMap.get(pt.candleOpenTimeUnix);
      if (existingAtCandle) {
        if (existingAtCandle.type !== pt.type) {
          console.error(
            `[Invariant Error] Multiple opposing types at same point (${pt.candleOpenTime}): ${existingAtCandle.type} vs ${pt.type}. Rejecting conflicting event.`
          );
          continue;
        }
        // Duplicate of same type at same candle
        continue;
      }

      seenCandleMap.set(pt.candleOpenTimeUnix, pt);
      result.push(pt);
    }

    return result.sort((a, b) => a.candleOpenTimeUnix - b.candleOpenTimeUnix);
  }, [structure, cleanChart, showStructure, activeAlgorithmVersion, isReplayActive, currentReplayStep]);

  const displayedBreakEvents = useMemo(() => {
    if (!structure?.structureBreakEvents) return [];
    if (!isReplayActive || !currentReplayStep) return structure.structureBreakEvents;
    return structure.structureBreakEvents.filter(
      (brk) => brk.candleTimeUnix <= currentReplayStep.openTimeUnix
    );
  }, [structure, isReplayActive, currentReplayStep]);

  const handleOpenAuditModal = useCallback((pt: StructurePoint) => {
    setSelectedPoint(pt);
    const curr = structureRef.current;
    const matchingAudit =
      curr?.audits?.find(
        (a) => a.eventId === pt.auditId || a.timestampUnix === pt.candleOpenTimeUnix
      ) || null;
    setActiveAuditRecord(matchingAudit);
    setActiveAuditPoint(pt);
    setAuditModalOpen(true);
  }, []);

  const handleFocusCandleTime = useCallback((openTime: string) => {
    if (!chartApiRef.current || displayedCandles.length === 0) return;
    try {
      const timeSec = Math.floor(new Date(openTime).getTime() / 1000) as UTCTimestamp;
      if (isNaN(timeSec)) return;
      chartApiRef.current.timeScale().scrollToPosition(1, false);
      const minTime = Math.floor(displayedCandles[0].openTimeUnix / 1000);
      const maxTime = Math.floor(displayedCandles[displayedCandles.length - 1].openTimeUnix / 1000);
      const fromTime = Math.max(minTime, timeSec - 25 * 300) as UTCTimestamp;
      const toTime = Math.min(maxTime, timeSec + 25 * 300) as UTCTimestamp;
      if (fromTime < toTime) {
        chartApiRef.current.timeScale().setVisibleRange({
          from: fromTime,
          to: toTime,
        });
      }
    } catch (err) {
      console.warn('[SetupLab] Failed to focus candle time:', err);
    }
  }, [displayedCandles]);

  const handleJumpToNextEvent = useCallback(() => {
    if (!structure?.candleReplaySteps) return;
    const steps = structure.candleReplaySteps;
    for (let idx = replayStepIndex + 1; idx < steps.length; idx++) {
      if (steps[idx].confirmedPointCreatedThisCandle || steps[idx].structureBreakThisCandle) {
        setReplayStepIndex(idx);
        return;
      }
    }
    setReplayStepIndex(steps.length - 1);
  }, [structure, replayStepIndex]);

  const handleJumpToPrevEvent = useCallback(() => {
    if (!structure?.candleReplaySteps) return;
    const steps = structure.candleReplaySteps;
    for (let idx = replayStepIndex - 1; idx >= 0; idx--) {
      if (steps[idx].confirmedPointCreatedThisCandle || steps[idx].structureBreakThisCandle) {
        setReplayStepIndex(idx);
        return;
      }
    }
    setReplayStepIndex(0);
  }, [structure, replayStepIndex]);

  const handleSaveAuditLabel = useCallback(async (labelData: {
    label: AuditUserLabel;
    manualType?: ManualPointType | null;
    manualPrice?: number | null;
    notes?: string;
  }) => {
    if (!activeAuditPoint) return;
    try {
      const recordToSave: Partial<StructureAuditLabelRecord> = {
        symbol: selectedSymbol,
        timeframe: '5M',
        candleOpenTime: activeAuditPoint.candleOpenTime,
        candleOpenTimeUnix: activeAuditPoint.candleOpenTimeUnix,
        algorithmVersion: activeAuditPoint.algorithmVersion || 'STRUCTURE_V4_WARMUP_LOCKED',
        algorithmEventId: activeAuditPoint.auditId || activeAuditRecord?.eventId,
        manualType: labelData.manualType,
        manualPrice: labelData.manualPrice,
        label: labelData.label,
        notes: labelData.notes,
      };

      const saved = await setupLabService.saveAuditLabel(recordToSave);
      const updated = auditLabels.filter((l) => l.candleOpenTimeUnix !== saved.candleOpenTimeUnix).concat(saved);
      setAuditLabels(updated);
      if (structure?.points) {
        const div = await setupLabService.calculateDivergence(structure.points, updated);
        setDivergenceAnalysis(div);
      }
    } catch (err) {
      console.error('[SetupLab] Error saving audit label:', err);
    }
  }, [activeAuditPoint, selectedSymbol, activeAuditRecord, auditLabels, structure]);

  const handleDeleteAuditLabel = useCallback(async (id: string) => {
    try {
      const success = await setupLabService.deleteAuditLabel(id);
      if (success) {
        const updated = auditLabels.filter((l) => l.id !== id);
        setAuditLabels(updated);
        if (structure?.points) {
          const div = await setupLabService.calculateDivergence(structure.points, updated);
          setDivergenceAnalysis(div);
        }
      }
    } catch (err) {
      console.error('[SetupLab] Error deleting audit label:', err);
    }
  }, [auditLabels, structure]);

  const handleAddManualPoint = useCallback(async (pointData: {
    candleOpenTime: string;
    candleOpenTimeUnix: number;
    manualType: ManualPointType;
    manualPrice: number;
    notes?: string;
  }) => {
    try {
      const saved = await setupLabService.saveAuditLabel({
        symbol: selectedSymbol,
        timeframe: '5M',
        candleOpenTime: pointData.candleOpenTime,
        candleOpenTimeUnix: pointData.candleOpenTimeUnix,
        algorithmVersion: 'STRUCTURE_V4_WARMUP_LOCKED',
        manualType: pointData.manualType,
        manualPrice: pointData.manualPrice,
        label: 'MISSING',
        notes: pointData.notes,
      });
      const updated = auditLabels.filter((l) => l.candleOpenTimeUnix !== saved.candleOpenTimeUnix).concat(saved);
      setAuditLabels(updated);
      if (structure?.points) {
        const div = await setupLabService.calculateDivergence(structure.points, updated);
        setDivergenceAnalysis(div);
      }
    } catch (err) {
      console.error('[SetupLab] Error adding manual point:', err);
    }
  }, [selectedSymbol, auditLabels, structure]);

  // Initialize and maintain TradingView Lightweight Chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight || 560,
      layout: {
        background: { type: ColorType.Solid, color: '#080B10' },
        textColor: '#94A3B8',
        fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace, sans-serif',
      },
      grid: {
        vertLines: { color: '#1E293B33' },
        horzLines: { color: '#1E293B33' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#475569',
          width: 1,
          style: 3,
          labelBackgroundColor: '#1E293B',
        },
        horzLine: {
          color: '#475569',
          width: 1,
          style: 3,
          labelBackgroundColor: '#1E293B',
        },
      },
      rightPriceScale: {
        borderColor: '#1E293B',
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
      timeScale: {
        borderColor: '#1E293B',
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10B981',
      downColor: '#EF4444',
      borderVisible: false,
      wickUpColor: '#10B981',
      wickDownColor: '#EF4444',
    });

    const structureLineSeries = chart.addSeries(LineSeries, {
      color: '#818CF8', // Indigo / Slate connecting legs
      lineWidth: 2,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartApiRef.current = chart;
    seriesApiRef.current = candleSeries;
    structureLineSeriesRef.current = structureLineSeries;

    // Crosshair move handler
    chart.subscribeCrosshairMove((param) => {
      if (
        !param.time ||
        !param.point ||
        param.point.x < 0 ||
        param.point.y < 0 ||
        !param.seriesData.get(candleSeries)
      ) {
        setHoveredCandle(null);
        return;
      }

      const data = param.seriesData.get(candleSeries) as {
        open: number;
        high: number;
        low: number;
        close: number;
      } | null;

      if (data) {
        const timeSec = param.time as number;
        const matching = candles.find(
          (c) => Math.floor(c.openTimeUnix / 1000) === timeSec
        );

        setHoveredCandle({
          time: new Date(timeSec * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close,
          isClosed: matching ? matching.isClosed : true,
        });
      }
    });

    // Chart Click Handler for Structure Point Inspection / Audit
    chart.subscribeClick((param) => {
      if (!param.time) return;
      const timeSec = param.time as number;
      const timeMs = timeSec * 1000;
      const curr = structureRef.current;
      if (!curr?.points) return;

      const found = curr.points.find(
        (p) => Math.abs(p.candleOpenTimeUnix - timeMs) <= 300000
      );
      if (found) {
        handleOpenAuditModal(found);
      }
    });

    // Time scale subscription for warm-up shading boundary
    chart.timeScale().subscribeVisibleTimeRangeChange(() => {
      const initTime = structureRef.current?.initialization?.mainAnalysisStartTime;
      if (!chartApiRef.current || !initTime) {
        setWarmUpBoundaryX(null);
        return;
      }
      try {
        const timeSec = Math.floor(new Date(initTime).getTime() / 1000) as UTCTimestamp;
        const coord = chartApiRef.current.timeScale().timeToCoordinate(timeSec);
        setWarmUpBoundaryX(typeof coord === 'number' && coord > 0 ? coord : null);
      } catch {
        setWarmUpBoundaryX(null);
      }
    });

    // Resize observer
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || !entries[0].contentRect) return;
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height: height > 200 ? height : 560 });
    });

    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartApiRef.current = null;
      seriesApiRef.current = null;
      structureLineSeriesRef.current = null;
      markersPrimitiveRef.current = null;
    };
  }, []);

  // Recalculate warm-up boundary when structure changes
  useEffect(() => {
    if (!chartApiRef.current || !structure?.initialization?.mainAnalysisStartTime || cleanChart || !showDebug) {
      setWarmUpBoundaryX(null);
      return;
    }
    try {
      const timeSec = Math.floor(new Date(structure.initialization.mainAnalysisStartTime).getTime() / 1000) as UTCTimestamp;
      const coord = chartApiRef.current.timeScale().timeToCoordinate(timeSec);
      setWarmUpBoundaryX(typeof coord === 'number' && coord > 0 ? coord : null);
    } catch {
      setWarmUpBoundaryX(null);
    }
  }, [structure, cleanChart, showDebug]);

  // Update candlestick data when candles change or replay steps
  useEffect(() => {
    if (!seriesApiRef.current || displayedCandles.length === 0) return;

    try {
      const formattedData = displayedCandles.map((c) => ({
        time: Math.floor(c.openTimeUnix / 1000) as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      seriesApiRef.current.setData(formattedData);
      if (!isReplayActive) {
        chartApiRef.current?.timeScale().fitContent();
      }
    } catch (err) {
      console.warn('[SetupLab] Error setting candle data on series:', err);
    }
  }, [displayedCandles, isReplayActive]);

  // Update structure markers, connecting legs, and key price lines on the chart
  useEffect(() => {
    if (!seriesApiRef.current || displayedCandles.length === 0) return;

    // Clear existing price lines
    if (priceLinesRef.current.length > 0) {
      priceLinesRef.current.forEach((line) => {
        try {
          seriesApiRef.current?.removePriceLine(line);
        } catch {}
      });
      priceLinesRef.current = [];
    }

    // If clean chart active or master toggle off or structure empty, clear markers and lines
    if (cleanChart || !showStructure || !structure) {
      if (markersPrimitiveRef.current) {
        try {
          markersPrimitiveRef.current.setMarkers([]);
        } catch {}
      }
      structureLineSeriesRef.current?.setData([]);
      return;
    }

    const validCandleTimeSet = new Set(
      displayedCandles.map((c) => Math.floor(c.openTimeUnix / 1000))
    );

    // 1. Connecting Legs (Zig-Zag line connecting confirmed external structure points)
    if (showConnectingLegs && showDebug && confirmedExternalPoints.length > 0) {
      const confirmedLineData = confirmedExternalPoints
        .filter(
          (pt) =>
            typeof pt.price === 'number' &&
            !isNaN(pt.price) &&
            validCandleTimeSet.has(Math.floor(pt.candleOpenTimeUnix / 1000))
        )
        .map((pt) => ({
          time: Math.floor(pt.candleOpenTimeUnix / 1000) as UTCTimestamp,
          value: pt.price,
        }))
        .sort((a, b) => (a.time as number) - (b.time as number));

      const uniqueData = confirmedLineData.filter(
        (pt, idx, arr) => idx === 0 || pt.time > arr[idx - 1].time
      );
      structureLineSeriesRef.current?.setData(uniqueData);
    } else {
      structureLineSeriesRef.current?.setData([]);
    }

    // 2. Draw Active Structural Range Price Lines (V5 Strict Boundaries)
    if (isReplayActive && currentReplayStep?.activeRange) {
      const replayRange = currentReplayStep.activeRange;
      const isBearishRange = replayRange.direction === 'BEARISH';
      try {
        const topLine = seriesApiRef.current.createPriceLine({
          price: replayRange.topPrice,
          color: isBearishRange ? '#F59E0B' : '#10B981', // Amber (LH) or Emerald (HH)
          lineWidth: 2,
          lineStyle: 0,
          axisLabelVisible: true,
          title: `REPLAY TOP: ${replayRange.topLabel} (${replayRange.topPrice.toFixed(2)})`,
        });
        priceLinesRef.current.push(topLine);
      } catch {}

      try {
        const bottomLine = seriesApiRef.current.createPriceLine({
          price: replayRange.bottomPrice,
          color: isBearishRange ? '#EF4444' : '#06B6D4', // Red (LL) or Cyan (HL)
          lineWidth: 2,
          lineStyle: 0,
          axisLabelVisible: true,
          title: `REPLAY BOTTOM: ${replayRange.bottomLabel} (${replayRange.bottomPrice.toFixed(2)})`,
        });
        priceLinesRef.current.push(bottomLine);
      } catch {}
    } else if (isReplayActive && currentReplayStep?.activeLockedAnchor) {
      const anchor = currentReplayStep.activeLockedAnchor;
      try {
        const line = seriesApiRef.current.createPriceLine({
          price: anchor.price,
          color: anchor.type === StructurePointType.HL ? '#06B6D4' : '#F59E0B',
          lineWidth: 2,
          lineStyle: 0,
          axisLabelVisible: true,
          title: `REPLAY ${anchor.type} (${anchor.price.toFixed(2)})`,
        });
        priceLinesRef.current.push(line);
      } catch {}
    } else if (showKeyPriceLines) {
      // V5 Range-Locked Active Range Top and Bottom Lines
      if (structure.activeRange && structure.activeRange.status === 'ACTIVE') {
        const range = structure.activeRange;
        const isBearishRange = range.direction === 'BEARISH';
        const isValid =
          isBearishRange
            ? range.top.type === StructurePointType.LH &&
              range.bottom.type === StructurePointType.LL &&
              range.top.price > range.bottom.price
            : range.top.type === StructurePointType.HH &&
              range.bottom.type === StructurePointType.HL &&
              range.top.price > range.bottom.price;

        if (isValid) {
          try {
            const topLine = seriesApiRef.current.createPriceLine({
              price: range.top.price,
              color: '#10B981', // Green for Range Top (HH & LH)
              lineWidth: 2,
              lineStyle: 0, // Solid
              axisLabelVisible: true,
              title: `RANGE TOP: ${range.top.label} (${range.top.price.toFixed(2)})`,
            });
            priceLinesRef.current.push(topLine);
          } catch {}

          try {
            const bottomLine = seriesApiRef.current.createPriceLine({
              price: range.bottom.price,
              color: isBearishRange ? '#EF4444' : '#06B6D4', // Red for LL or Cyan for HL
              lineWidth: 2,
              lineStyle: 0, // Solid
              axisLabelVisible: true,
              title: `RANGE BOTTOM: ${range.bottom.label} (${range.bottom.price.toFixed(2)})`,
            });
            priceLinesRef.current.push(bottomLine);
          } catch {}
        }
      } else {
        const isBullishState =
          structure.structureState === StructureState.BULLISH ||
          structure.structureState === StructureState.BULLISH_STRUCTURE_BROKEN;
        const isBearishState =
          structure.structureState === StructureState.BEARISH ||
          structure.structureState === StructureState.BEARISH_STRUCTURE_BROKEN;

        if (isBullishState) {
          const hlPoint = (structure as any).lastConfirmedHL || structure.lastHL;
          if (hlPoint && typeof hlPoint.price === 'number') {
            try {
              const hlLine = seriesApiRef.current.createPriceLine({
                price: hlPoint.price,
                color: '#06B6D4', // Cyan
                lineWidth: 2,
                lineStyle: 0, // Solid
                axisLabelVisible: true,
                title: `ACTIVE HL INVALIDATION (${hlPoint.price.toFixed(2)})`,
              });
              priceLinesRef.current.push(hlLine);
            } catch {}
          }
        } else if (isBearishState) {
          const lhPoint = (structure as any).lastConfirmedLH || structure.lastLH;
          if (lhPoint && typeof lhPoint.price === 'number') {
            try {
              const lhLine = seriesApiRef.current.createPriceLine({
                price: lhPoint.price,
                color: '#10B981', // Green for LH
                lineWidth: 2,
                lineStyle: 0, // Solid
                axisLabelVisible: true,
                title: `ACTIVE LH INVALIDATION (${lhPoint.price.toFixed(2)})`,
              });
              priceLinesRef.current.push(lhLine);
            } catch {}
          }
        }
      }

      // Active Retracement Fib Target Line (Only in debug mode)
      if (showDebug && typeof structure.activeRetracement?.fibLevelPrice === 'number') {
        try {
          const fibRatio =
            typeof structure.activeRetracement.fibRatio === 'number'
              ? structure.activeRetracement.fibRatio
              : 0.382;
          const fibLine = seriesApiRef.current.createPriceLine({
            price: structure.activeRetracement.fibLevelPrice,
            color: '#A855F7',
            lineWidth: 1,
            lineStyle: 2, // Dashed
            axisLabelVisible: true,
            title: `ACTIVE ${(fibRatio * 100).toFixed(1)}% FIB (${structure.activeRetracement.fibLevelPrice.toFixed(2)})`,
          });
          priceLinesRef.current.push(fibLine);
        } catch {}
      }
    }

    // 3. Build Markers for Confirmed External Points ONLY (HH, HL, LH, LL)
    const markers: any[] = [];

    confirmedExternalPoints.forEach((pt) => {
      const timeSec = Math.floor(pt.candleOpenTimeUnix / 1000) as UTCTimestamp;
      if (!validCandleTimeSet.has(timeSec)) return;
      if (typeof pt.price !== 'number' || isNaN(pt.price)) return;

      const isHigh = pt.type === StructurePointType.HH || pt.type === StructurePointType.LH;
      const isLow = pt.type === StructurePointType.HL || pt.type === StructurePointType.LL;

      if (isHigh && !showSwingHighs) return;
      if (isLow && !showSwingLows) return;

      const seqTag = showSequenceNumbers && pt.sequenceLabel ? pt.sequenceLabel : pt.type;
      const markerText = showMarkerPrices ? `${seqTag} ${pt.price.toFixed(2)}` : seqTag;

      if (pt.type === StructurePointType.HH) {
        markers.push({
          time: timeSec,
          position: 'aboveBar' as const,
          color: '#10B981', // Green
          shape: 'arrowDown' as const,
          text: markerText,
        });
      } else if (pt.type === StructurePointType.LH) {
        markers.push({
          time: timeSec,
          position: 'aboveBar' as const,
          color: '#10B981', // Green (HH/LH markers = GREEN, yellow LH removed)
          shape: 'arrowDown' as const,
          text: markerText,
        });
      } else if (pt.type === StructurePointType.HL) {
        markers.push({
          time: timeSec,
          position: 'belowBar' as const,
          color: '#06B6D4', // Cyan (retained)
          shape: 'arrowUp' as const,
          text: markerText,
        });
      } else if (pt.type === StructurePointType.LL) {
        markers.push({
          time: timeSec,
          position: 'belowBar' as const,
          color: '#EF4444', // Red (retained)
          shape: 'arrowUp' as const,
          text: markerText,
        });
      }
    });

    // 4. Optional Internal Debug Events Layer (Default: OFF, distinct debug styling)
    if (showInternalDebugEvents && showDebug && structure?.points) {
      structure.points.forEach((pt) => {
        if (pt.structureScope !== 'INTERNAL' && !pt.isProvisional) return;
        const timeSec = Math.floor(pt.candleOpenTimeUnix / 1000) as UTCTimestamp;
        if (!validCandleTimeSet.has(timeSec)) return;
        const isHighType = pt.type.includes('HIGH') || pt.type.includes('HH');
        markers.push({
          time: timeSec,
          position: isHighType ? ('aboveBar' as const) : ('belowBar' as const),
          color: '#64748B',
          shape: 'circle' as const,
          text: `[debug] ${pt.sequenceLabel || pt.type}`,
        });
      });
    }

    // 5. Legacy Pivot Markers for Comparison if overlay enabled
    if (legacyPivotOverlay && structure.legacyPoints && structure.legacyPoints.length > 0) {
      structure.legacyPoints.forEach((pt) => {
        if (isReplayActive && currentReplayStep && pt.candleOpenTimeUnix > currentReplayStep.openTimeUnix) {
          return;
        }
        const timeSec = Math.floor(pt.candleOpenTimeUnix / 1000) as UTCTimestamp;
        if (!validCandleTimeSet.has(timeSec)) return;

        if (pt.type === StructurePointType.SWING_HIGH && showSwingHighs) {
          markers.push({
            time: timeSec,
            position: 'aboveBar' as const,
            color: '#64748B',
            shape: 'circle' as const,
            text: `pSH ${pt.price.toFixed(2)}`,
          });
        } else if (pt.type === StructurePointType.SWING_LOW && showSwingLows) {
          markers.push({
            time: timeSec,
            position: 'belowBar' as const,
            color: '#64748B',
            shape: 'circle' as const,
            text: `pSL ${pt.price.toFixed(2)}`,
          });
        }
      });
    }

    // Sort markers chronologically by time to comply with Lightweight Charts requirements
    markers.sort((a, b) => (a.time as number) - (b.time as number));

    try {
      if (!markersPrimitiveRef.current) {
        markersPrimitiveRef.current = createSeriesMarkers(seriesApiRef.current, markers);
      } else {
        markersPrimitiveRef.current.setMarkers(markers);
      }
    } catch (err) {
      console.warn('[SetupLab] Error setting markers on series:', err);
    }
  }, [
    structure,
    displayedPoints,
    confirmedExternalPoints,
    displayedBreakEvents,
    displayedCandles,
    isReplayActive,
    currentReplayStep,
    cleanChart,
    showStructure,
    showSwingHighs,
    showSwingLows,
    showKeyPriceLines,
    showSequenceNumbers,
    showMarkerPrices,
    showConnectingLegs,
    showProvisionalStructure,
    showInternalDebugEvents,
    showDebug,
    legacyPivotOverlay,
  ]);

  // Focus chart on a selected structure point
  const handleSelectPoint = (pt: StructurePoint) => {
    setSelectedPoint(pt);
    if (chartApiRef.current && displayedCandles.length > 0) {
      try {
        const timeSec = Math.floor(pt.candleOpenTimeUnix / 1000) as UTCTimestamp;
        if (isNaN(timeSec)) return;
        chartApiRef.current.timeScale().scrollToPosition(1, false);
        const minTime = Math.floor(displayedCandles[0].openTimeUnix / 1000);
        const maxTime = Math.floor(displayedCandles[displayedCandles.length - 1].openTimeUnix / 1000);
        const fromTime = Math.max(minTime, timeSec - 30 * 300) as UTCTimestamp;
        const toTime = Math.min(maxTime, timeSec + 30 * 300) as UTCTimestamp;
        if (fromTime < toTime) {
          chartApiRef.current.timeScale().setVisibleRange({
            from: fromTime,
            to: toTime,
          });
        }
      } catch (err) {
        console.warn('[SetupLab] Failed to set visible range for selected point:', err);
      }
    }
  };

  const selectedSymbolMeta = symbols.find((s) => s.rawSymbol === selectedSymbol);

  return (
    <div className="space-y-4">
      {/* Top Header & Context */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 border-b border-[#1E293B]/70 pb-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-white tracking-wide">Setup Lab</h1>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              PHASE 1 & 2 ACTIVE
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
              PUBLIC MARKET DATA
            </span>
          </div>
          <p className="text-xs text-[#94A3B8] mt-0.5">
            Visual market structure validation • 5-minute candle ingestion & deterministic swing detection
          </p>
        </div>

        {/* Global Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Searchable Dynamic Symbol Selector */}
          <SymbolSearchSelector
            symbols={symbols}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={handleSelectSymbol}
            onRefreshDirectory={() => loadDirectory(true)}
            refreshingDirectory={refreshingDirectory}
            favorites={favorites}
            onToggleFavorite={handleToggleFavorite}
            recents={recents}
            showInactive={showInactive}
            onToggleShowInactive={(val) => {
              setShowInactive(val);
              loadDirectory(false);
            }}
          />

          {/* Timeframe (Locked to 5M per specification) */}
          <div className="flex items-center bg-[#0C1017] border border-[#1E293B] rounded-lg px-2.5 py-1 text-xs font-mono">
            <span className="text-[#64748B] mr-1.5">TF:</span>
            <span className="text-emerald-400 font-bold">5M</span>
          </div>

          {/* Analysis Candles (Default 280) */}
          <div className="flex items-center bg-[#0C1017] border border-[#1E293B] hover:border-[#334155] rounded-lg px-2 py-0.5 text-xs font-mono">
            <span className="text-[#64748B] mr-1.5 text-[11px]" title="Main Structure Analysis Range (Target ~280 candles)">Analysis:</span>
            <button
              type="button"
              onClick={() => handleAnalysisCandlesChange(analysisCandles - 20)}
              disabled={analysisCandles <= 100}
              title="Decrease analysis window by 20 candles"
              className="px-1 py-0.5 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
            >
              -
            </button>
            <input
              type="number"
              min="100"
              max="1000"
              value={analysisCandles}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) handleAnalysisCandlesChange(v);
              }}
              className="w-12 bg-transparent text-center font-bold text-white focus:outline-none focus:text-emerald-400"
            />
            <button
              type="button"
              onClick={() => handleAnalysisCandlesChange(analysisCandles + 20)}
              disabled={analysisCandles >= 1000}
              title="Increase analysis window by 20 candles"
              className="px-1 py-0.5 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
            >
              +
            </button>
          </div>

          {/* Warm-Up Search Window (Default 70) */}
          <div className="flex items-center bg-[#0C1017] border border-[#1E293B] hover:border-[#334155] rounded-lg px-2 py-0.5 text-xs font-mono">
            <span className="text-[#64748B] mr-1.5 text-[11px]" title="Warm-up search window to the left of the analysis range (0–200 candles)">Warm-Up:</span>
            <button
              type="button"
              onClick={() => handleWarmUpCandlesChange(warmUpCandles - 10)}
              disabled={warmUpCandles <= 0}
              title="Decrease warm-up window by 10 candles"
              className="px-1 py-0.5 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
            >
              -
            </button>
            <input
              type="number"
              min="0"
              max="200"
              value={warmUpCandles}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) handleWarmUpCandlesChange(v);
              }}
              className="w-10 bg-transparent text-center font-bold text-cyan-300 focus:outline-none focus:text-cyan-400"
            />
            <button
              type="button"
              onClick={() => handleWarmUpCandlesChange(warmUpCandles + 10)}
              disabled={warmUpCandles >= 200}
              title="Increase warm-up window by 10 candles"
              className="px-1 py-0.5 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
            >
              +
            </button>
          </div>

          {/* Quick Analysis Presets Menu in Header */}
          <div className="hidden sm:flex items-center gap-1 bg-[#0C1017] border border-[#1E293B] rounded-lg p-0.5 text-[10px] font-mono">
            {ANALYSIS_CANDLE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => handleAnalysisCandlesChange(preset)}
                className={`px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                  analysisCandles === preset
                    ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>

          {/* Auto Refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono transition-colors cursor-pointer border ${
              autoRefresh
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-[#0C1017] border-[#1E293B] text-[#64748B]'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-emerald-400 animate-pulse' : 'bg-[#64748B]'}`} />
            {autoRefresh ? 'Live (15s)' : 'Manual'}
          </button>

          {/* Manual Sync Button */}
          <button
            onClick={() => loadData(true)}
            disabled={syncing}
            className="flex items-center gap-1.5 bg-[#1E293B] hover:bg-[#283548] text-white px-3 py-1 rounded-lg text-xs font-medium border border-[#334155] transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-emerald-400' : 'text-slate-300'}`} />
            {syncing ? 'Syncing...' : 'Sync MEXC'}
          </button>

          {/* Clean Recompute Button */}
          <button
            onClick={handleForceCleanRecompute}
            disabled={syncing}
            title="Clean structure recomputation from raw MEXC candles, clearing calculated UI marker state first"
            className="flex items-center gap-1.5 bg-[#0C1017] hover:bg-[#1E293B] text-slate-300 hover:text-white px-3 py-1 rounded-lg text-xs font-mono border border-[#334155] transition-colors cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-cyan-400' : 'text-cyan-400'}`} />
            {syncing ? 'Recomputing...' : 'Clean Recompute'}
          </button>

          {/* Clean Chart Mode Toggle Button */}
          <button
            onClick={handleToggleCleanChart}
            title={cleanChart ? 'Exit Clean Chart mode and restore overlays' : 'Clean Normal Mode: shows only confirmed HH/HL/LH/LL and active invalidation line'}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono border transition-colors cursor-pointer ${
              cleanChart
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 font-semibold'
                : 'bg-[#0C1017] border-[#1E293B] text-[#94A3B8] hover:text-white'
            }`}
          >
            {cleanChart ? <EyeOff className="w-3.5 h-3.5 text-amber-400" /> : <Eye className="w-3.5 h-3.5" />}
            {cleanChart ? 'Clean Active' : 'Clean Chart'}
          </button>

          {/* Debug Panel Toggle */}
          <button
            onClick={() => setShowDebug(!showDebug)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono border transition-colors cursor-pointer ${
              showDebug
                ? 'bg-purple-500/10 border-purple-500/30 text-purple-300'
                : 'bg-[#0C1017] border-[#1E293B] text-[#64748B]'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            {showDebug ? 'Hide Debug' : 'Debug Panel'}
          </button>
        </div>
      </div>

      {/* Mode & Transition Banner (Prominently displaying current structural state) */}
      {structure && (
        <div className={`rounded-lg px-4 py-2.5 border font-mono flex flex-wrap items-center justify-between gap-3 shadow-md ${
          structure.structureState === StructureState.BULLISH
            ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
            : structure.structureState === StructureState.BEARISH
            ? 'bg-amber-950/30 border-amber-500/40 text-amber-300'
            : structure.structureState === StructureState.BULLISH_STRUCTURE_BROKEN
            ? 'bg-rose-950/30 border-rose-500/40 text-rose-300'
            : structure.structureState === StructureState.BEARISH_STRUCTURE_BROKEN
            ? 'bg-indigo-950/30 border-indigo-500/40 text-indigo-300'
            : 'bg-slate-900/40 border-slate-700/50 text-slate-300'
        }`}>
          <div className="flex items-center gap-3">
            <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider bg-black/40 border border-current">
              MODE
            </span>
            <span className="text-sm font-bold tracking-wide">
              {structure.structureState === StructureState.BULLISH && 'BULLISH STRUCTURE ACTIVE'}
              {structure.structureState === StructureState.BEARISH && 'BEARISH STRUCTURE ACTIVE'}
              {structure.structureState === StructureState.BULLISH_STRUCTURE_BROKEN && 'BULLISH STRUCTURE BROKEN — LOOKING FOR NEW LH / LL'}
              {structure.structureState === StructureState.BEARISH_STRUCTURE_BROKEN && 'BEARISH STRUCTURE BROKEN — LOOKING FOR NEW HH / HL'}
              {structure.structureState === StructureState.UNDEFINED && 'STRUCTURE UNDEFINED'}
            </span>
          </div>

          <div className="flex items-center gap-4 text-xs">
            {structure.initialization && (
              <div className="flex items-center gap-1.5">
                <span className="text-[#64748B]">Init:</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                  structure.initialization.usedWarmUp
                    ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
                    : structure.initialization.initialTrend !== StructureState.UNDEFINED
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}>
                  {structure.initialization.usedWarmUp
                    ? `Warm-Up (${structure.initialization.candlesEvaluated}c searched)`
                    : structure.initialization.initialTrend !== StructureState.UNDEFINED
                    ? 'Main Analysis Range'
                    : 'No Init Found'}
                </span>
              </div>
            )}

            {structure.activeRange ? (
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/30">
                  <span className="text-[10px] text-purple-300 font-bold">RANGE:</span>
                  <span className={`text-[10px] font-bold ${
                    structure.activeRange.direction === 'BEARISH' ? 'text-amber-400' : 'text-emerald-400'
                  }`}>
                    {structure.activeRange.direction} ({structure.activeRange.rangeId})
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[#64748B]">Top:</span>
                  <span className="text-amber-400 font-bold">{structure.activeRange.top.label} ({structure.activeRange.top.price.toFixed(2)})</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[#64748B]">Bottom:</span>
                  <span className="text-rose-400 font-bold">{structure.activeRange.bottom.label} ({structure.activeRange.bottom.price.toFixed(2)})</span>
                </div>
              </div>
            ) : (
              <>
                {(structure as any).lastConfirmedHL && (
                  <div className="flex items-center gap-1">
                    <span className="text-[#64748B]">Active HL:</span>
                    <span className="text-cyan-400 font-bold">{(structure as any).lastConfirmedHL.price.toFixed(2)}</span>
                  </div>
                )}
                {(structure as any).lastConfirmedLH && (
                  <div className="flex items-center gap-1">
                    <span className="text-[#64748B]">Active LH:</span>
                    <span className="text-amber-400 font-bold">{(structure as any).lastConfirmedLH.price.toFixed(2)}</span>
                  </div>
                )}
              </>
            )}

            {manualStartConfig && (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/40">
                <span className="text-[10px] text-amber-300 font-bold">MANUAL SEED ACTIVE</span>
                <button
                  type="button"
                  onClick={() => {
                    setManualStartConfig(null);
                    localStorage.removeItem('setupLab.manualStart');
                  }}
                  className="text-[10px] text-slate-400 hover:text-white underline cursor-pointer"
                  title="Clear manual starting structure"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Unsupported Symbol Warning Banner */}
      {selectedSymbolMeta && !selectedSymbolMeta.isTradable && (
        <div className="bg-amber-950/20 border border-amber-500/30 rounded-lg p-2.5 flex items-center gap-2 text-xs text-amber-300 font-mono">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
          <span>
            <strong>{selectedSymbol}</strong> is marked inactive or untradable on the official MEXC contract exchange.
          </span>
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && (
        <div className="bg-red-950/20 border border-red-500/30 rounded-lg p-2.5 flex items-center justify-between text-xs text-red-300 font-mono">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => loadData(false)}
            className="text-xs underline text-red-400 hover:text-red-300 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Main Grid: Chart & Side Debug Panel */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Large Financial Candlestick Chart Area */}
        <div className={`${showDebug ? 'xl:col-span-9' : 'xl:col-span-12'} bg-[#080B10] border border-[#1E293B] rounded-xl overflow-hidden flex flex-col shadow-lg transition-all`}>
          {/* Chart Sub-Header / Real-Time OHLC Inspector */}
          <div className="bg-[#0C1017] border-b border-[#1E293B] px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
            <div className="flex items-center gap-3">
              <span className="text-white font-bold tracking-wide">{selectedSymbol}</span>
              <span className="text-[#64748B]">5M Candle</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Official MEXC Contract
              </span>
              {cleanChart && (
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                  Clean Chart Mode
                </span>
              )}
            </div>

            {/* OHLC inspection display */}
            {hoveredCandle ? (
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="text-[#64748B]">{hoveredCandle.time}</span>
                <span className="text-[#64748B]">O: <span className="text-white">{typeof hoveredCandle.open === 'number' ? hoveredCandle.open.toFixed(2) : '-'}</span></span>
                <span className="text-[#64748B]">H: <span className="text-emerald-400">{typeof hoveredCandle.high === 'number' ? hoveredCandle.high.toFixed(2) : '-'}</span></span>
                <span className="text-[#64748B]">L: <span className="text-red-400">{typeof hoveredCandle.low === 'number' ? hoveredCandle.low.toFixed(2) : '-'}</span></span>
                <span className="text-[#64748B]">C: <span className="text-white">{typeof hoveredCandle.close === 'number' ? hoveredCandle.close.toFixed(2) : '-'}</span></span>
                <span
                  className={`px-1.5 py-0.2 rounded text-[10px] ${
                    hoveredCandle.isClosed
                      ? 'bg-slate-800 text-slate-300'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  }`}
                >
                  {hoveredCandle.isClosed ? 'CLOSED' : 'FORMING (Excluded)'}
                </span>
              </div>
            ) : (
              <div className="text-[11px] text-[#64748B] italic">
                Hover over candles to inspect OHLC and formation status
              </div>
            )}
          </div>

          {/* Chart Canvas */}
          <div className="relative w-full h-[560px] bg-[#080B10] overflow-hidden">
            {loading && (
              <div className="absolute inset-0 bg-[#080B10]/80 backdrop-blur-xs flex items-center justify-center z-10">
                <div className="flex items-center gap-2 text-xs font-mono text-[#94A3B8]">
                  <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                  Loading 5-minute candles from MEXC public contract API...
                </div>
              </div>
            )}

            {/* Warm-Up Search Window Shading Overlay */}
            {warmUpBoundaryX !== null && !cleanChart && showDebug && (
              <div
                className="absolute top-0 bottom-0 left-0 pointer-events-none z-5 transition-all"
                style={{
                  width: `${Math.max(0, warmUpBoundaryX)}px`,
                  backgroundColor: 'rgba(30, 41, 59, 0.25)',
                  borderRight: '1px dashed #64748B',
                }}
              >
                <div className="absolute top-3 left-3 bg-[#0F172A]/90 border border-slate-700/60 rounded px-2 py-0.5 text-[10px] font-mono text-cyan-300 shadow-md">
                  WARM-UP REGION ({structure?.initialization?.warmUpCandlesCount ?? warmUpCandles}c)
                </div>
              </div>
            )}

            <div ref={chartContainerRef} className="w-full h-full" />
          </div>

          {/* Chart Footer: Working Window Status Banner */}
          <div className="bg-[#0C1017] border-t border-[#1E293B] px-3.5 py-2 flex flex-wrap items-center justify-between text-[11px] font-mono text-[#64748B]">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>
                  Analysis Range: <strong className="text-white">{analysisCandles}c</strong>
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                <span>
                  Warm-Up Window: <strong className="text-white">{warmUpCandles}c</strong>
                </span>
              </div>
              <span>
                (Total {lookbackCandles}c evaluated • {structure?.points.length || 0} confirmed points)
              </span>
            </div>
            <div>
              {structure?.unclosedCandleExcluded && (
                <span className="text-amber-400">
                  Current unclosed candle displayed but strictly excluded from swing confirmation
                </span>
              )}
            </div>
          </div>

          {/* Structure Replay Controls */}
          <div className="p-3 border-t border-[#1E293B] bg-[#0A0E17]">
            <StructureReplayControls
              steps={structure?.candleReplaySteps || []}
              currentStepIndex={replayStepIndex}
              isReplayActive={isReplayActive}
              onToggleReplay={setIsReplayActive}
              onSetStepIndex={setReplayStepIndex}
              onJumpToNextEvent={handleJumpToNextEvent}
              onJumpToPrevEvent={handleJumpToPrevEvent}
            />
          </div>
        </div>

        {/* Structure Debug Panel */}
        {showDebug && (
          <div className="xl:col-span-3 space-y-4">
            {/* Panel: Algorithm Parameters & Controls */}
            <div className="bg-[#080B10] border border-[#1E293B] rounded-xl p-3.5 space-y-3.5 shadow-lg">
              <div className="flex items-center justify-between border-b border-[#1E293B] pb-2">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-purple-400" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                    Structure Engine (V6 Fib-Qualified Range)
                  </h3>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setManualStartModalOpen(true)}
                    title="Set manual starting structure (LH/LL or HL/HH seed for testing)"
                    className="flex items-center gap-1 text-[10px] text-amber-300 hover:text-white px-2 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 cursor-pointer transition-colors"
                  >
                    <Crosshair className="w-3 h-3" />
                    <span>Seed Range</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleResetParameters}
                    title="Reset parameters to official defaults (Analysis 280, Warm-Up 70, Min Candles 4, Min Fib 0.382)"
                    className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded bg-[#1E293B]/70 hover:bg-[#1E293B] border border-[#334155] cursor-pointer transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset</span>
                  </button>
                </div>
              </div>

              {/* 1. Main Analysis Candles Selector */}
              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between items-center">
                  <span className="text-[#94A3B8]" title="Target analysis range (~280 candles)">Analysis Candles:</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="100"
                      max="1000"
                      value={analysisCandles}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!isNaN(v)) handleAnalysisCandlesChange(v);
                      }}
                      className="w-14 bg-[#1E293B] text-white font-bold text-right px-1.5 py-0.5 rounded border border-[#334155] focus:outline-none focus:border-purple-500"
                    />
                    <span className="text-[10px] text-[#64748B]">bars</span>
                  </div>
                </div>

                <input
                  type="range"
                  min="100"
                  max="1000"
                  step="20"
                  value={analysisCandles}
                  onChange={(e) => handleAnalysisCandlesChange(parseInt(e.target.value, 10))}
                  className="w-full accent-purple-500 cursor-pointer h-1.5"
                />

                <div className="pt-0.5">
                  <div className="grid grid-cols-4 gap-1 text-[10px]">
                    {ANALYSIS_CANDLE_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => handleAnalysisCandlesChange(preset)}
                        className={`py-0.5 text-center rounded border transition-colors cursor-pointer ${
                          analysisCandles === preset
                            ? 'bg-purple-500/20 border-purple-500/50 text-purple-300 font-bold'
                            : 'bg-[#0C1017] border-[#1E293B] text-slate-400 hover:text-white'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 2. Warm-Up Search Window Selector */}
              <div className="space-y-1.5 text-xs font-mono pt-2 border-t border-[#1E293B]">
                <div className="flex justify-between items-center">
                  <span className="text-[#94A3B8]" title="Warm-up search window to the left of the analysis range (0–200 candles)">
                    Warm-Up Search Window:
                  </span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      max="200"
                      value={warmUpCandles}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!isNaN(v)) handleWarmUpCandlesChange(v);
                      }}
                      className="w-14 bg-[#1E293B] text-cyan-300 font-bold text-right px-1.5 py-0.5 rounded border border-[#334155] focus:outline-none focus:border-cyan-500"
                    />
                    <span className="text-[10px] text-[#64748B]">bars</span>
                  </div>
                </div>

                <input
                  type="range"
                  min="0"
                  max="200"
                  step="10"
                  value={warmUpCandles}
                  onChange={(e) => handleWarmUpCandlesChange(parseInt(e.target.value, 10))}
                  className="w-full accent-cyan-400 cursor-pointer h-1.5"
                />

                <div className="pt-0.5">
                  <div className="grid grid-cols-5 gap-1 text-[10px]">
                    {WARM_UP_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => handleWarmUpCandlesChange(preset)}
                        className={`py-0.5 text-center rounded border transition-colors cursor-pointer ${
                          warmUpCandles === preset
                            ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 font-bold'
                            : 'bg-[#0C1017] border-[#1E293B] text-slate-400 hover:text-white'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Retracement Parameters */}
              <div className="space-y-2.5 text-xs font-mono pt-2 border-t border-[#1E293B]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-cyan-400 tracking-wider">
                    Retracement Qualification
                  </span>
                  <span className="text-[10px] text-[#64748B]">Deterministic</span>
                </div>

                {/* 1. Min Retracement Candles */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-[#94A3B8]">1. Min Retrace Candles:</span>
                    <span className="text-white font-bold px-2 py-0.5 rounded bg-[#1E293B]">
                      {minRetracementCandles} bars
                    </span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="15"
                    value={minRetracementCandles}
                    onChange={(e) => handleMinRetracementCandlesChange(parseInt(e.target.value, 10))}
                    className="w-full accent-cyan-400 cursor-pointer h-1.5"
                  />
                  <div className="flex items-center gap-1 text-[10px]">
                    {RETRACEMENT_CANDLE_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => handleMinRetracementCandlesChange(preset)}
                        className={`flex-1 py-0.5 rounded border transition-colors cursor-pointer ${
                          minRetracementCandles === preset
                            ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300 font-bold'
                            : 'bg-[#0C1017] border-[#1E293B] text-slate-400 hover:text-white'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2. Min Retracement Fib Depth */}
                <div className="space-y-1 pt-1">
                  <div className="flex justify-between items-center">
                    <span className="text-[#94A3B8]">2. Min Fib Depth:</span>
                    <span className="text-white font-bold px-2 py-0.5 rounded bg-[#1E293B]">
                      {(minRetracementFib * 100).toFixed(1)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="80"
                    step="1"
                    value={Math.round(minRetracementFib * 100)}
                    onChange={(e) => handleMinRetracementFibChange(parseInt(e.target.value, 10) / 100)}
                    className="w-full accent-purple-400 cursor-pointer h-1.5"
                  />
                  <div className="grid grid-cols-4 gap-1 text-[10px]">
                    {FIB_DEPTH_PRESETS.map((f) => (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() => handleMinRetracementFibChange(f.value)}
                        className={`py-0.5 rounded border transition-colors cursor-pointer ${
                          Math.abs(minRetracementFib - f.value) < 0.005
                            ? 'bg-purple-500/20 border-purple-500/40 text-purple-300 font-bold'
                            : 'bg-[#0C1017] border-[#1E293B] text-slate-400 hover:text-white'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="text-[10px] text-[#64748B] pt-0.5 leading-relaxed bg-[#0C1017] p-2 rounded border border-[#1E293B]">
                  * Structure locks anchor sequence upon qualifying retracement. Invalidation occurs strictly on candle close beyond active locked level.
                </div>
              </div>

              {/* Chart Overlays Controls */}
              <div className="pt-2 border-t border-[#1E293B] space-y-2 text-xs font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-[#94A3B8] uppercase text-[10px] font-bold tracking-wider">
                    Chart Overlays
                  </span>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showStructure}
                      onChange={(e) => handleToggleShowStructure(e.target.checked)}
                      className="rounded border-[#1E293B] bg-[#0C1017] text-purple-500 focus:ring-0 cursor-pointer w-3.5 h-3.5"
                    />
                    <span className="text-[11px] text-purple-300 font-medium">Show Markers</span>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className={`flex items-center gap-2 p-2 rounded-lg border transition-colors cursor-pointer select-none ${
                    showSwingHighs
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-[#0C1017] border-[#1E293B] text-slate-500'
                  }`}>
                    <input
                      type="checkbox"
                      checked={showSwingHighs}
                      onChange={(e) => handleToggleSwingHighs(e.target.checked)}
                      className="rounded border-[#1E293B] bg-[#0C1017] text-emerald-500 focus:ring-0 cursor-pointer w-3.5 h-3.5"
                    />
                    <span className="text-[11px] font-bold">Highs (HH/LH)</span>
                  </label>

                  <label className={`flex items-center gap-2 p-2 rounded-lg border transition-colors cursor-pointer select-none ${
                    showSwingLows
                      ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
                      : 'bg-[#0C1017] border-[#1E293B] text-slate-500'
                  }`}>
                    <input
                      type="checkbox"
                      checked={showSwingLows}
                      onChange={(e) => handleToggleSwingLows(e.target.checked)}
                      className="rounded border-[#1E293B] bg-[#0C1017] text-cyan-500 focus:ring-0 cursor-pointer w-3.5 h-3.5"
                    />
                    <span className="text-[11px] font-bold">Lows (HL/LL)</span>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className={`flex items-center gap-2 p-2 rounded-lg border transition-colors cursor-pointer select-none ${
                    showSequenceNumbers
                      ? 'bg-purple-500/10 border-purple-500/30 text-purple-300'
                      : 'bg-[#0C1017] border-[#1E293B] text-slate-500'
                  }`}>
                    <input
                      type="checkbox"
                      checked={showSequenceNumbers}
                      onChange={(e) => handleToggleSequenceNumbers(e.target.checked)}
                      className="rounded border-[#1E293B] bg-[#0C1017] text-purple-500 focus:ring-0 cursor-pointer w-3.5 h-3.5"
                    />
                    <span className="text-[11px] font-bold">Sequences (HH1)</span>
                  </label>

                  <label className={`flex items-center gap-2 p-2 rounded-lg border transition-colors cursor-pointer select-none ${
                    showConnectingLegs
                      ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300'
                      : 'bg-[#0C1017] border-[#1E293B] text-slate-500'
                  }`}>
                    <input
                      type="checkbox"
                      checked={showConnectingLegs}
                      onChange={(e) => handleToggleConnectingLegs(e.target.checked)}
                      className="rounded border-[#1E293B] bg-[#0C1017] text-indigo-500 focus:ring-0 cursor-pointer w-3.5 h-3.5"
                    />
                    <span className="text-[11px] font-bold">Connecting Legs</span>
                  </label>
                </div>

                <div className="space-y-1.5 pt-1">
                  <label className="flex items-center justify-between p-2 rounded-lg bg-[#0C1017] border border-[#1E293B] cursor-pointer select-none">
                    <span className="text-[11px] text-slate-300">Active Invalidation Line</span>
                    <input
                      type="checkbox"
                      checked={showKeyPriceLines}
                      onChange={(e) => handleToggleKeyPriceLines(e.target.checked)}
                      className="rounded border-[#1E293B] bg-[#0C1017] text-blue-500 focus:ring-0 cursor-pointer w-3.5 h-3.5"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2 rounded-lg bg-[#0C1017] border border-[#1E293B] cursor-pointer select-none">
                    <span className="text-[11px] text-slate-300">Show Marker Prices</span>
                    <input
                      type="checkbox"
                      checked={showMarkerPrices}
                      onChange={(e) => handleToggleMarkerPrices(e.target.checked)}
                      className="rounded border-[#1E293B] bg-[#0C1017] text-purple-500 focus:ring-0 cursor-pointer w-3.5 h-3.5"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2 rounded-lg bg-[#0C1017] border border-[#1E293B] cursor-pointer select-none">
                    <span className="text-[11px] text-slate-400">Internal Debug Events Layer</span>
                    <input
                      type="checkbox"
                      checked={showInternalDebugEvents}
                      onChange={(e) => handleToggleInternalDebugEvents(e.target.checked)}
                      className="rounded border-[#1E293B] bg-[#0C1017] text-slate-400 focus:ring-0 cursor-pointer w-3.5 h-3.5"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2 rounded-lg bg-[#0C1017] border border-[#1E293B] cursor-pointer select-none">
                    <span className="text-[11px] text-slate-400">Provisional Markers (pHH/pLL)</span>
                    <input
                      type="checkbox"
                      checked={showProvisionalStructure}
                      onChange={(e) => handleToggleProvisionalStructure(e.target.checked)}
                      className="rounded border-[#1E293B] bg-[#0C1017] text-slate-400 focus:ring-0 cursor-pointer w-3.5 h-3.5"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2 rounded-lg bg-[#0C1017] border border-[#1E293B] cursor-pointer select-none">
                    <span className="text-[11px] text-slate-400">Legacy V1 Pivot Overlay</span>
                    <input
                      type="checkbox"
                      checked={legacyPivotOverlay}
                      onChange={(e) => handleToggleLegacyPivotOverlay(e.target.checked)}
                      className="rounded border-[#1E293B] bg-[#0C1017] text-slate-400 focus:ring-0 cursor-pointer w-3.5 h-3.5"
                    />
                  </label>
                </div>

                {legacyPivotOverlay && (
                  <div className="p-2 rounded bg-[#0C1017] border border-[#1E293B] space-y-2">
                    <div className="text-[10px] text-[#64748B]">Legacy V1 Pivot Left/Right:</div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-[#94A3B8]">Left:</span>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={pivotLeftBars}
                        onChange={(e) => handlePivotLeftChange(parseInt(e.target.value, 10))}
                        className="w-10 bg-[#1E293B] text-center text-white py-0.5 rounded"
                      />
                      <span className="text-[10px] text-[#94A3B8]">Right:</span>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={pivotRightBars}
                        onChange={(e) => handlePivotRightChange(parseInt(e.target.value, 10))}
                        className="w-10 bg-[#1E293B] text-center text-white py-0.5 rounded"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Confirmed Structure Points Counts Grid */}
              <div className="pt-2 border-t border-[#1E293B]">
                <div className="text-[10px] text-[#94A3B8] uppercase font-bold tracking-wider mb-1.5 font-mono">
                  Confirmed Structure Breakdown
                </div>
                <div className="grid grid-cols-4 gap-1.5 font-mono">
                  <div className="bg-[#0C1017] border border-emerald-500/20 rounded p-1.5 text-center">
                    <div className="text-[10px] text-emerald-400 font-bold">HH</div>
                    <div className="text-sm font-bold text-white mt-0.5">{structure?.hhCount ?? 0}</div>
                  </div>
                  <div className="bg-[#0C1017] border border-cyan-500/20 rounded p-1.5 text-center">
                    <div className="text-[10px] text-cyan-400 font-bold">HL</div>
                    <div className="text-sm font-bold text-white mt-0.5">{structure?.hlCount ?? 0}</div>
                  </div>
                  <div className="bg-[#0C1017] border border-amber-500/20 rounded p-1.5 text-center">
                    <div className="text-[10px] text-amber-400 font-bold">LH</div>
                    <div className="text-sm font-bold text-white mt-0.5">{structure?.lhCount ?? 0}</div>
                  </div>
                  <div className="bg-[#0C1017] border border-rose-500/20 rounded p-1.5 text-center">
                    <div className="text-[10px] text-rose-400 font-bold">LL</div>
                    <div className="text-sm font-bold text-white mt-0.5">{structure?.llCount ?? 0}</div>
                  </div>
                </div>
              </div>

              {/* Active Locked Structure Anchors */}
              <div className="space-y-1.5 pt-2 border-t border-[#1E293B] text-[11px] font-mono">
                <div className="bg-[#0C1017] p-2 rounded border border-[#1E293B]">
                  <div className="text-[#64748B] flex justify-between items-center">
                    <span>Active Locked HL (Invalidation):</span>
                    <span className="text-cyan-400 font-bold">
                      {typeof (structure?.lastHL?.price ?? (structure as any)?.lastConfirmedHL?.price) === 'number'
                        ? (structure?.lastHL?.price ?? (structure as any)?.lastConfirmedHL?.price).toFixed(2)
                        : 'None'}
                    </span>
                  </div>
                </div>

                <div className="bg-[#0C1017] p-2 rounded border border-[#1E293B]">
                  <div className="text-[#64748B] flex justify-between items-center">
                    <span>Active Locked LH (Invalidation):</span>
                    <span className="text-amber-400 font-bold">
                      {typeof (structure?.lastLH?.price ?? (structure as any)?.lastConfirmedLH?.price) === 'number'
                        ? (structure?.lastLH?.price ?? (structure as any)?.lastConfirmedLH?.price).toFixed(2)
                        : 'None'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Selected Point Details Card */}
            {selectedPoint && (
              <div className="bg-[#080B10] border border-blue-500/30 rounded-xl p-3.5 space-y-2 font-mono text-xs shadow-lg">
                <div className="flex items-center justify-between border-b border-[#1E293B] pb-1.5">
                  <span className="text-blue-400 font-bold">Selected Structure Point</span>
                  <button
                    onClick={() => setSelectedPoint(null)}
                    className="text-[#64748B] hover:text-white text-xs cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
                <div className="space-y-1 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Type & Seq:</span>
                    <span className={
                      selectedPoint.type === StructurePointType.HH ? 'text-emerald-400 font-bold' :
                      selectedPoint.type === StructurePointType.HL ? 'text-cyan-400 font-bold' :
                      selectedPoint.type === StructurePointType.LH ? 'text-amber-400 font-bold' :
                      selectedPoint.type === StructurePointType.LL ? 'text-rose-400 font-bold' :
                      'text-slate-300 font-bold'
                    }>
                      {selectedPoint.sequenceLabel || selectedPoint.type}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Price:</span>
                    <span className="text-white font-bold">
                      {typeof selectedPoint.price === 'number' ? selectedPoint.price.toFixed(2) : '-'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Open Time (UTC):</span>
                    <span className="text-slate-300">
                      {new Date(selectedPoint.candleOpenTime).toISOString().replace('T', ' ').slice(0, 19)}
                    </span>
                  </div>
                  {selectedPoint.cycleNumber !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-[#64748B]">Cycle:</span>
                      <span className="text-purple-300">Cycle #{selectedPoint.cycleNumber}</span>
                    </div>
                  )}
                  {selectedPoint.retracementCandles !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-[#64748B]">Retrace Bars:</span>
                      <span className="text-slate-300">{selectedPoint.retracementCandles} bars</span>
                    </div>
                  )}
                  {typeof selectedPoint.retracementFibDepth === 'number' && (
                    <div className="flex justify-between">
                      <span className="text-[#64748B]">Fib Depth:</span>
                      <span className="text-cyan-300">{(selectedPoint.retracementFibDepth * 100).toFixed(1)}%</span>
                    </div>
                  )}
                  {selectedPoint.confirmationReason && (
                    <div className="flex justify-between">
                      <span className="text-[#64748B]">Reason:</span>
                      <span className="text-emerald-300 text-[10px] text-right max-w-[160px] truncate" title={selectedPoint.confirmationReason}>
                        {selectedPoint.confirmationReason}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Active Structural Range Card: Visualizes V5 Range-Locked Top and Bottom Boundaries */}
      {structure?.activeRange && showDebug && !cleanChart && (
        <ActiveRangeCard
          activeRange={structure.activeRange}
          structureState={structure.structureState}
          showDebug={showDebug}
          lastClose={candles.length > 0 ? candles[candles.length - 1].close : undefined}
        />
      )}

      {/* Initial Structure Card: Visualizes warm-up search results and deterministic starting structure */}
      {structure?.initialization && showDebug && !cleanChart && (
        <InitialStructureCard
          initialization={structure.initialization}
          structureState={structure.structureState}
        />
      )}

      {/* Active Retracement Inspector & Real-time State Card */}
      {showDebug && !cleanChart && (
        <ActiveRetracementCard
          activeRetracement={structure?.activeRetracement || null}
          state={structure?.state || StructureState.UNDEFINED}
          minCandles={minRetracementCandles}
          minFib={minRetracementFib}
        />
      )}

      {/* Audit Trail: Chronological Structure Event Logs */}
      {structure && structure.eventLogs && structure.eventLogs.length > 0 && showDebug && !cleanChart && (
        <StructureEventLogCard
          events={structure.eventLogs}
          onFocusCandleTime={handleFocusCandleTime}
        />
      )}

      {/* Detected Structure Points Table */}
      {showDebug && (
        <div className="bg-[#080B10] border border-[#1E293B] rounded-xl overflow-hidden shadow-lg">
          <div className="bg-[#0C1017] border-b border-[#1E293B] px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Detected Retracement-Qualified Points
              </h3>
              <span className="text-xs font-mono text-[#64748B]">
                ({structure?.points.length || 0} confirmed points in current {lookbackCandles}-candle window)
              </span>
            </div>
            <span className="text-[11px] font-mono text-[#475569]">
              Click row to focus chart
            </span>
          </div>

          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-[#0C1017]/80 text-[#64748B] uppercase text-[10px] sticky top-0 border-b border-[#1E293B]">
                <tr>
                  <th className="py-2 px-3">Sequence</th>
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-3">Open Time (UTC)</th>
                  <th className="py-2 px-3">Price</th>
                  <th className="py-2 px-3">Cycle</th>
                  <th className="py-2 px-3">State</th>
                  <th className="py-2 px-3">Retrace Bars</th>
                  <th className="py-2 px-3">Fib Depth</th>
                  <th className="py-2 px-3">Confirmation Reason</th>
                  <th className="py-2 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E293B]/40">
                {structure && structure.points.length > 0 ? (
                  structure.points.map((pt, ptIdx) => {
                    const isSelected = selectedPoint?.id === pt.id;
                    const badgeStyles = {
                      [StructurePointType.HH]: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
                      [StructurePointType.HL]: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
                      [StructurePointType.LH]: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
                      [StructurePointType.LL]: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
                      [StructurePointType.PROVISIONAL_HH]: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
                      [StructurePointType.PROVISIONAL_LL]: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
                      [StructurePointType.SWING_HIGH]: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
                      [StructurePointType.SWING_LOW]: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
                    }[pt.type] || 'bg-slate-500/10 text-slate-400 border-slate-500/30';

                    return (
                      <tr
                        key={`${pt.id}_${ptIdx}`}
                        onClick={() => handleSelectPoint(pt)}
                        className={`hover:bg-[#1E293B]/40 transition-colors cursor-pointer ${
                          isSelected ? 'bg-blue-500/10' : ''
                        }`}
                      >
                        <td className="py-2 px-3 font-bold text-purple-300">
                          {pt.sequenceLabel || (pt.sequenceNumber ? `#${pt.sequenceNumber}` : '-')}
                        </td>
                        <td className="py-2 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badgeStyles}`}
                          >
                            {pt.type}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-300">
                          {new Date(pt.candleOpenTime).toISOString().replace('T', ' ').slice(0, 16)}
                        </td>
                        <td className="py-2 px-3 text-white font-bold">
                          {typeof pt.price === 'number' ? pt.price.toFixed(2) : '-'}
                        </td>
                        <td className="py-2 px-3 text-slate-400 text-[11px]">
                          {pt.cycleNumber ? `Cycle ${pt.cycleNumber}` : '-'}
                        </td>
                        <td className="py-2 px-3 text-[10px]">
                          <span className={
                            pt.trendStateAtConfirmation === StructureState.BULLISH ? 'text-emerald-400' :
                            pt.trendStateAtConfirmation === StructureState.BEARISH ? 'text-amber-400' :
                            'text-slate-500'
                          }>
                            {pt.trendStateAtConfirmation || '-'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-[#94A3B8]">
                          {pt.retracementCandles !== undefined ? `${pt.retracementCandles}b` : '-'}
                        </td>
                        <td className="py-2 px-3 text-cyan-300">
                          {typeof pt.retracementFibDepth === 'number' ? `${(pt.retracementFibDepth * 100).toFixed(1)}%` : '-'}
                        </td>
                        <td className="py-2 px-3 text-slate-300 text-[10px] max-w-[220px] truncate" title={pt.confirmationReason}>
                          {pt.confirmationReason || 'Qualified retracement'}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenAuditModal(pt);
                              }}
                              className="text-[10px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 border border-purple-500/40 cursor-pointer font-bold"
                            >
                              Audit
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectPoint(pt);
                              }}
                              className="text-[10px] text-blue-400 hover:text-blue-300 underline cursor-pointer"
                            >
                              Focus
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={10} className="py-6 text-center text-[#64748B]">
                      No structure points detected in the current window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TradingView Manual Ground Truth Divergence Comparison Panel */}
      {showDebug && (
        <TradingViewDivergencePanel
          points={structure?.points || []}
          labels={auditLabels}
          divergenceAnalysis={divergenceAnalysis}
          onSelectPoint={handleSelectPoint}
          onOpenAuditModal={handleOpenAuditModal}
          onFocusCandleTime={handleFocusCandleTime}
          onDeleteLabel={handleDeleteAuditLabel}
          onAddManualPoint={handleAddManualPoint}
        />
      )}

      {/* Structure Decision Audit Inspector Modal */}
      {auditModalOpen && (
        <StructureAuditInspectorModal
          onClose={() => setAuditModalOpen(false)}
          point={activeAuditPoint}
          audit={activeAuditRecord}
          existingLabel={
            auditLabels.find(
              (l) =>
                activeAuditPoint &&
                (l.candleOpenTimeUnix === activeAuditPoint.candleOpenTimeUnix ||
                  l.algorithmEventId === activeAuditPoint.auditId)
            ) || null
          }
          onSaveLabel={handleSaveAuditLabel}
          onFocusCandleTime={handleFocusCandleTime}
        />
      )}
      {/* Manual Starting Structure Modal (Section 30 Debug Tool) */}
      <ManualStartStructureModal
        isOpen={manualStartModalOpen}
        onClose={() => setManualStartModalOpen(false)}
        candles={candles}
        currentManualStart={manualStartConfig}
        onApplyManualStart={(cfg) => {
          const configToSave = {
            direction: cfg.direction,
            topPrice: String(cfg.topPrice),
            topTime: cfg.topTime,
            bottomPrice: String(cfg.bottomPrice),
            bottomTime: cfg.bottomTime,
          };
          setManualStartConfig(configToSave);
          try {
            localStorage.setItem('setupLab.manualStart', JSON.stringify(configToSave));
          } catch {}
        }}
        onClearManualStart={() => {
          setManualStartConfig(null);
          try {
            localStorage.removeItem('setupLab.manualStart');
          } catch {}
        }}
      />
    </div>
  );
};
