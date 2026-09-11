import {
  StructureDecisionAudit,
  RejectedStructureEvent,
  CandleReplayStep,
  EngineStateSnapshot,
} from './structureAuditTypes';

export enum StructurePointType {
  HH = 'HH', // Higher High
  HL = 'HL', // Higher Low
  LL = 'LL', // Lower Low
  LH = 'LH', // Lower High
  PROVISIONAL_HH = 'PROVISIONAL_HH', // pHH (unconfirmed expansion/retracement)
  PROVISIONAL_LL = 'PROVISIONAL_LL', // pLL (unconfirmed expansion/retracement)
  // Legacy types for optional comparison overlay
  SWING_HIGH = 'SWING_HIGH',
  SWING_LOW = 'SWING_LOW',
}

export enum StructureState {
  UNDEFINED = 'UNDEFINED',
  BULLISH = 'BULLISH',
  BULLISH_STRUCTURE_BROKEN = 'BULLISH_STRUCTURE_BROKEN', // TRANSITION_TO_BEARISH
  BEARISH = 'BEARISH',
  BEARISH_STRUCTURE_BROKEN = 'BEARISH_STRUCTURE_BROKEN', // TRANSITION_TO_BULLISH
}

export enum StructureStrength {
  MINOR = 'MINOR',
  INTERMEDIATE = 'INTERMEDIATE',
  MAJOR = 'MAJOR',
}

export const CURRENT_ALGORITHM_VERSION = 'STRUCTURE_V6_FIB_QUALIFIED_RANGE_REV3';
export const ALGORITHM_VERSION_V2 = 'STRUCTURE_V2_RETRACEMENT';
export const ALGORITHM_VERSION_V3 = 'STRUCTURE_V3_LOCKED_CYCLES';
export const ALGORITHM_VERSION_V4 = 'STRUCTURE_V4_WARMUP_LOCKED';
export const ALGORITHM_VERSION_V5 = 'STRUCTURE_V5_RANGE_LOCKED';
export const ALGORITHM_VERSION_V5_REV2 = 'STRUCTURE_V5_RANGE_LOCKED_REV2';
export const ALGORITHM_VERSION_V5_REV3 = 'STRUCTURE_V5_RANGE_LOCKED_REV3';
export const ALGORITHM_VERSION_V5_REV4 = 'STRUCTURE_V5_RANGE_LOCKED_REV4';
export const ALGORITHM_VERSION_V6 = 'STRUCTURE_V6_FIB_QUALIFIED_RANGE';
export const ALGORITHM_VERSION_V6_REV2 = 'STRUCTURE_V6_FIB_QUALIFIED_RANGE_REV2';
export const ALGORITHM_VERSION_V6_REV3 = 'STRUCTURE_V6_FIB_QUALIFIED_RANGE_REV3';

export interface StructuralRangeBoundary {
  type: StructurePointType;
  price: number;
  candleTime: string;
  candleTimeUnix: number;
  candleIndex?: number;
  label: string; // "LH1", "LL1", "HH1", "HL1"
  eventId?: string;
  rangeId?: string;
  regimeId?: string;
}

export type TypedStructuralAnchor<T extends StructurePointType> = {
  type: T;
  price: number;
  candleTime: string;
  candleTimeUnix: number;
  candleIndex?: number;
  label: string;
  eventId?: string;
  rangeId?: string;
  regimeId?: string;
};

export interface StructuralRange {
  rangeId: string; // e.g. "BEARISH_RANGE_1", "BEARISH_RANGE_2", "BULLISH_RANGE_1"
  direction: 'BULLISH' | 'BEARISH';
  sequenceIndex: number;
  status: 'ACTIVE' | 'BROKEN_CONTINUATION' | 'BROKEN_REVERSAL';
  top: StructuralRangeBoundary;
  bottom: StructuralRangeBoundary;
  lh?: TypedStructuralAnchor<StructurePointType.LH>;
  ll?: TypedStructuralAnchor<StructurePointType.LL>;
  hh?: TypedStructuralAnchor<StructurePointType.HH>;
  hl?: TypedStructuralAnchor<StructurePointType.HL>;
  startedAt: string;
  startedAtUnix: number;
  endedAt?: string;
  endedAtUnix?: number;
  breakEventId?: string;
  breakCandleTime?: string;
  breakCandleClose?: number;
}

export interface BearishRange extends StructuralRange {
  direction: 'BEARISH';
  top: TypedStructuralAnchor<StructurePointType.LH>;
  bottom: TypedStructuralAnchor<StructurePointType.LL>;
  lh: TypedStructuralAnchor<StructurePointType.LH>;
  ll: TypedStructuralAnchor<StructurePointType.LL>;
}

export interface BullishRange extends StructuralRange {
  direction: 'BULLISH';
  top: TypedStructuralAnchor<StructurePointType.HH>;
  bottom: TypedStructuralAnchor<StructurePointType.HL>;
  hh: TypedStructuralAnchor<StructurePointType.HH>;
  hl: TypedStructuralAnchor<StructurePointType.HL>;
}

export function createBearishRange(
  lh: TypedStructuralAnchor<StructurePointType.LH>,
  ll: TypedStructuralAnchor<StructurePointType.LL>,
  rangeId: string,
  sequenceIndex: number,
  status: 'ACTIVE' | 'BROKEN_CONTINUATION' | 'BROKEN_REVERSAL' = 'ACTIVE',
  startedAt?: string,
  startedAtUnix?: number
): BearishRange {
  if (lh.type !== StructurePointType.LH) {
    throw new Error(`STRUCTURE INVARIANT FAILURE: BearishRange top must be LH, got ${lh.type}`);
  }
  if (ll.type !== StructurePointType.LL) {
    throw new Error(`STRUCTURE INVARIANT FAILURE: BearishRange bottom must be LL, got ${ll.type}`);
  }
  if (lh.price <= ll.price) {
    throw new Error(
      `STRUCTURE INVARIANT FAILURE: BearishRange LH price (${lh.price}) must be strictly greater than LL price (${ll.price})`
    );
  }
  return {
    rangeId,
    direction: 'BEARISH',
    sequenceIndex,
    status,
    top: lh,
    bottom: ll,
    lh,
    ll,
    startedAt: startedAt ?? lh.candleTime,
    startedAtUnix: startedAtUnix ?? lh.candleTimeUnix,
  };
}

export function createBullishRange(
  hh: TypedStructuralAnchor<StructurePointType.HH>,
  hl: TypedStructuralAnchor<StructurePointType.HL>,
  rangeId: string,
  sequenceIndex: number,
  status: 'ACTIVE' | 'BROKEN_CONTINUATION' | 'BROKEN_REVERSAL' = 'ACTIVE',
  startedAt?: string,
  startedAtUnix?: number
): BullishRange {
  if (hh.type !== StructurePointType.HH) {
    throw new Error(`STRUCTURE INVARIANT FAILURE: BullishRange top must be HH, got ${hh.type}`);
  }
  if (hl.type !== StructurePointType.HL) {
    throw new Error(`STRUCTURE INVARIANT FAILURE: BullishRange bottom must be HL, got ${hl.type}`);
  }
  if (hh.price <= hl.price) {
    throw new Error(
      `STRUCTURE INVARIANT FAILURE: BullishRange HH price (${hh.price}) must be strictly greater than HL price (${hl.price})`
    );
  }
  return {
    rangeId,
    direction: 'BULLISH',
    sequenceIndex,
    status,
    top: hh,
    bottom: hl,
    hh,
    hl,
    startedAt: startedAt ?? hl.candleTime,
    startedAtUnix: startedAtUnix ?? hl.candleTimeUnix,
  };
}

export function assertBearishRange(range: StructuralRange): asserts range is BearishRange {
  if (range.direction !== 'BEARISH') {
    throw new Error(`STRUCTURE INVARIANT FAILURE: Expected BEARISH range, got ${range.direction}`);
  }
  if (range.top.type !== StructurePointType.LH) {
    throw new Error(`STRUCTURE INVARIANT FAILURE: Bearish range top must be LH, got ${range.top.type}`);
  }
  if (range.bottom.type !== StructurePointType.LL) {
    throw new Error(`STRUCTURE INVARIANT FAILURE: Bearish range bottom must be LL, got ${range.bottom.type}`);
  }
  if (range.top.price <= range.bottom.price) {
    throw new Error(
      `STRUCTURE INVARIANT FAILURE: Bearish range LH (${range.top.price}) must be > LL (${range.bottom.price})`
    );
  }
}

export function assertBullishRange(range: StructuralRange): asserts range is BullishRange {
  if (range.direction !== 'BULLISH') {
    throw new Error(`STRUCTURE INVARIANT FAILURE: Expected BULLISH range, got ${range.direction}`);
  }
  if (range.top.type !== StructurePointType.HH) {
    throw new Error(`STRUCTURE INVARIANT FAILURE: Bullish range top must be HH, got ${range.top.type}`);
  }
  if (range.bottom.type !== StructurePointType.HL) {
    throw new Error(`STRUCTURE INVARIANT FAILURE: Bullish range bottom must be HL, got ${range.bottom.type}`);
  }
  if (range.top.price <= range.bottom.price) {
    throw new Error(
      `STRUCTURE INVARIANT FAILURE: Bullish range HH (${range.top.price}) must be > HL (${range.bottom.price})`
    );
  }
}

export interface InitializationStructureResult {
  initialState: StructureState;
  initialSequence: 'LH → LL' | 'HL → HH' | 'NONE';
  warmUpCandlesUsed: number;
  warmUpCandlesMax: number;
  initialFoundAt: string | null;
  initialFoundTimeUnix?: number | null;
  initialLH?: number | null;
  initialLL?: number | null;
  initialHH?: number | null;
  initialHL?: number | null;
  warmUpStartIndex?: number | null;
  mainAnalysisStartIndex: number;
  mainAnalysisStartTime: string | null;
  initializationLogs: string[];
  usedWarmUp?: boolean;
  initialTrend?: StructureState;
  candlesEvaluated?: number;
  warmUpCandlesCount?: number;
}

export interface StructureBreakEvent {
  id?: string;
  candleTime: string;
  candleTimeUnix: number;
  candleIndex?: number;
  price: number;
  brokenLevel: number;
  breakType:
    | 'BULLISH_STRUCTURE_BROKEN'
    | 'BEARISH_STRUCTURE_BROKEN'
    | 'BEARISH_CONTINUATION'
    | 'BULLISH_CONTINUATION'
    | 'LL_BROKEN_CONTINUATION'
    | 'HH_BROKEN_CONTINUATION'
    | string;
  label: string;
  regimeId?: string;
  auditId?: string;
}

export interface StructureCycle {
  cycleId: string;
  direction: 'BULLISH' | 'BEARISH';
  status: 'WAITING_FOR_BREAK' | 'EXPANDING' | 'RETRACING' | 'CONFIRMED' | 'INVALIDATED';
  anchorPoint: {
    id: string;
    type: StructurePointType;
    price: number;
    candleTime: string;
    candleTimeUnix?: number;
    candleIndex?: number;
  } | null;
  breakPoint?: {
    price: number;
    candleIndex: number;
    candleTime: string;
    candleTimeUnix: number;
  } | null;
  expansionExtreme: {
    type: StructurePointType;
    price: number;
    candleIndex: number;
    candleTime: string;
    candleTimeUnix: number;
  } | null;
  retracementExtreme?: {
    type: StructurePointType;
    price: number;
    candleIndex: number;
    candleTime: string;
    candleTimeUnix: number;
  } | null;
  fibLevel?: number;
  retracementCandles?: number;
  requiredCandles?: number;
  fibDepth?: number;
  requiredFib?: number;
  startedAt: string;
  confirmedAt?: string;
}

export interface StructureParameters {
  analysisCandles?: number; // default: 280 (range: 100-1000)
  initializationSearchCandles?: number; // default: 70 (range: 0-200)
  warmUpCandles?: number; // optional alias for initializationSearchCandles
  initializationMode?: 'NEAREST_VALID_PRIOR_STRUCTURE';
  minimumRetracementCandles: number; // default: 4 (range: 1-20)
  minimumRetracementFib: number; // default: 0.382 (e.g. 0.236, 0.382, 0.5, 0.618)
  breakConfirmation: 'CLOSE'; // Strict body close rule
  fibTouchMode: 'WICK'; // Wick touch is sufficient for Fib depth
  lookbackCandles: number; // e.g. 350
  algorithmVersion?: string; // default: 'STRUCTURE_V4_WARMUP_LOCKED'
  cycleLocking?: boolean; // default: true
  showProvisionalStructure?: boolean; // default: false
  showSequenceNumbers?: boolean; // default: true
  legacyPivotOverlay?: boolean; // default: false
  // Legacy pivot parameters for optional comparison
  pivotLeftBars?: number;
  pivotRightBars?: number;
  equalityMode?: 'STRICT';
  initialSeed?: {
    state: StructureState;
    confirmedHL?: { price: number; candleIndex?: number; time?: string };
    confirmedHH?: { price: number; candleIndex?: number; time?: string };
    confirmedLH?: { price: number; candleIndex?: number; time?: string };
    confirmedLL?: { price: number; candleIndex?: number; time?: string };
  };
  manualStart?: {
    direction: 'BULLISH' | 'BEARISH';
    top: { price: number; candleTime: string; candleTimeUnix?: number; candleIndex?: number };
    bottom: { price: number; candleTime: string; candleTimeUnix?: number; candleIndex?: number };
  };
  showInternalPriceActionDebug?: boolean;
}

export interface StructurePoint {
  id: string;
  symbol: string;
  timeframe: string; // '5M'
  candleOpenTime: string; // ISO 8601 UTC
  candleOpenTimeUnix: number; // Unix timestamp in ms
  type: StructurePointType;
  price: number;
  strength: StructureStrength;
  algorithmVersion: string; // 'STRUCTURE_V5_RANGE_LOCKED', 'STRUCTURE_V4_WARMUP_LOCKED', 'STRUCTURE_V3_LOCKED_CYCLES' or 'STRUCTURE_V2_RETRACEMENT'
  candleIndex?: number;
  isProvisional?: boolean;
  leftBars?: number;
  rightBars?: number;
  retracementCandles?: number;
  retracementFibDepth?: number;
  fibPriceLevel?: number;
  // Regime & Cycle & Range tracking relationships
  rangeId?: string; // e.g. "BEARISH_RANGE_1", "BEARISH_RANGE_2", "BULLISH_RANGE_1"
  isRangeTop?: boolean;
  isRangeBottom?: boolean;
  regimeId?: string; // e.g. "REGIME_BULL_1", "REGIME_BEAR_2"
  cycleId?: string;
  auditId?: string; // Links directly to StructureDecisionAudit
  previousStructurePointId?: string | null;
  trendState?: StructureState;
  confirmationReason?: string;
  sequenceIndex?: number; // 1, 2, 3...
  sequenceLabel?: string; // e.g. "HH1", "HL1", "LH1", "LL1"
  cycleNumber?: number; // 1, 2, 3...
  isWarmUpAnchor?: boolean; // Was established during warm-up initialization
  confirmed?: boolean;
  structureScope?: 'EXTERNAL' | 'INTERNAL';
  eventId?: string;
  parameters?: Record<string, unknown> | StructureParameters | any;
  detectedAt: string;
  createdAt: string;
}

export function assertSingleStructureType(event: { type?: string; types?: string[]; [key: string]: any }): boolean {
  if (Array.isArray(event.types) && event.types.length > 1) {
    console.error(`[Invariant Violation] Structural event has multiple types: ${JSON.stringify(event.types)}`, event);
    return false;
  }
  const validTypes = [
    StructurePointType.HH,
    StructurePointType.HL,
    StructurePointType.LH,
    StructurePointType.LL,
  ];
  if (!event.type || !validTypes.includes(event.type as StructurePointType)) {
    return false;
  }
  return true;
}

export interface ActiveRetracementInfo {
  state: StructureState;
  candidateType: StructurePointType | null; // PROVISIONAL_HH or PROVISIONAL_LL
  candidatePrice: number | null;
  candidateTime: string | null;
  candidateTimeUnix: number | null;
  candidateCandleIndex: number | null;
  referencePrice: number | null; // Previous HL for bullish, previous LH for bearish
  referenceTime: string | null;
  fibLevelPrice: number | null; // 0.382 retracement price line
  fibRatio: number; // e.g. 0.382
  currentRetracementCandles: number;
  requiredRetracementCandles?: number;
  isCandleCountQualified?: boolean;
  currentRetracementPrice?: number | null; // lowest low reached (bullish) or highest high reached (bearish)
  currentFibDepth: number; // e.g. 0.271 or 0.431
  isFibDepthQualified?: boolean;
  isFullyQualified?: boolean;
  bestRetracementCandleTime?: string | null;
  requiredCandles?: number;
  requiredFib?: number;
  currentRetracementExtremePrice?: number | null;
  currentRetracementExtremeTime?: string | null;
  currentRetracementExtremeIndex?: number | null;
  retracementQualified?: boolean;
}

export interface StructureEventLogItem {
  id: string;
  candleTime: string;
  candleTimeUnix: number;
  eventType:
    | 'CANDIDATE_CREATED'
    | 'LEG_EXTENDED'
    | 'RETRACEMENT_PROGRESS'
    | 'STRUCTURE_CONFIRMED'
    | 'STRUCTURE_BROKEN'
    | 'TREND_CONFIRMED'
    | 'INFO';
  title: string;
  message: string;
  details?: {
    retracementCandles?: number;
    requiredCandles?: number;
    fibDepth?: number;
    requiredFib?: number;
    price?: number;
    referencePrice?: number;
  };
}

export interface StructureDetectionResult {
  symbol: string;
  timeframe: string;
  algorithmVersion: string;
  parameters: StructureParameters;
  structureState: StructureState;
  stateLabel: string;
  totalCandlesAvailable: number;
  closedCandlesEvaluated: number;
  unclosedCandleExcluded: boolean;
  workingWindowStart: string | null;
  workingWindowEnd: string | null;

  // Counts
  hhCount: number;
  hlCount: number;
  llCount: number;
  lhCount: number;
  provisionalCount: number;
  totalPointsCount: number;

  // Active / Last Points
  lastHH: StructurePoint | null;
  lastHL: StructurePoint | null;
  lastLL: StructurePoint | null;
  lastLH: StructurePoint | null;
  lastConfirmedHH?: StructurePoint | null;
  lastConfirmedHL?: StructurePoint | null;
  lastConfirmedLL?: StructurePoint | null;
  lastConfirmedLH?: StructurePoint | null;
  activeProvisionalPoint: StructurePoint | null;

  // Structure cycles (V3 Locked Cycles)
  cycles?: StructureCycle[];
  activeCycle?: StructureCycle | null;
  showProvisionalStructure?: boolean;

  // Real-time retracement inspection
  activeRetracement: ActiveRetracementInfo | null;

  // Warm-Up / Initialization Search Result (V4 Warm-Up Locked)
  initialization?: InitializationStructureResult;
  analysisCandles?: number;
  initializationSearchCandles?: number;

  // Range-Locked Market Structure (V5 Range Locked)
  ranges?: StructuralRange[];
  activeRange?: StructuralRange | null;
  internalStructureIgnored?: boolean;

  // Candle close structure break events
  structureBreakEvents?: StructureBreakEvent[];

  // Confirmed and provisional points list
  points: StructurePoint[];

  // Optional legacy pivot comparison points
  legacyPoints?: StructurePoint[];

  // Chronological Audit Event Log
  eventLogs: StructureEventLogItem[];

  // Deterministic Decision Audits (V4 Audit Mode)
  audits?: StructureDecisionAudit[];
  rejectedEvents?: RejectedStructureEvent[];
  candleReplaySteps?: CandleReplayStep[];
  engineState?: EngineStateSnapshot;
  currentRegimeId?: string;
  regimes?: Array<{
    regimeId: string;
    direction: 'BULLISH' | 'BEARISH';
    startedAt: string;
    startedAtUnix?: number;
    endedAt?: string;
    endedAtUnix?: number;
    startReason?: string;
  }>;

  executionTimeMs: number;
  detectedAt: string;
}

export * from './structureAuditTypes';
