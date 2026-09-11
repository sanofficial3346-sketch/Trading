import { StructurePoint, StructurePointType, StructureState, StructureStrength } from './structureTypes';

export type AuditEventType =
  | 'HH'
  | 'HL'
  | 'LH'
  | 'LL'
  | 'BULLISH_STRUCTURE_BROKEN'
  | 'BEARISH_STRUCTURE_BROKEN'
  | 'REJECTED_BREAK'
  | 'REJECTED_RETRACEMENT'
  | 'REJECTED_INVALIDATION'
  | 'WARMUP_INITIALIZATION';

export interface RetracementBarDetail {
  index: number;
  time: string;
  timeUnix: number;
  open: number;
  high: number;
  low: number;
  close: number;
  countNumber?: number;
  isRetracementExtreme?: boolean;
  reachedRequiredFib?: boolean;
}

export interface BreakCandleDetail {
  index: number;
  time: string;
  timeUnix: number;
  open: number;
  high: number;
  low: number;
  close: number;
  wickExceededLevel: boolean;
  bodyCloseExceededLevel: boolean;
}

export interface StructureDecisionAudit {
  eventId: string;
  regimeId: string;
  cycleId: string;
  sequenceId: string; // e.g. "HH2", "HL2", "LH1", "LL1"
  eventType: AuditEventType;
  status: 'CONFIRMED' | 'REJECTED' | 'BROKEN';
  trendStateBefore: StructureState;
  trendStateAfter: StructureState;
  candleIndex: number;
  timestamp: string;
  timestampUnix: number;
  price: number;

  // Previous Locked Anchor
  previousLockedAnchorType: StructurePointType | null;
  previousLockedAnchorPrice: number | null;
  previousLockedAnchorTime: string | null;
  previousLockedAnchorTimeUnix?: number | null;

  // Previous Structural Extreme
  previousStructuralExtremeType: StructurePointType | null;
  previousStructuralExtremePrice: number | null;
  previousStructuralExtremeTime: string | null;
  previousStructuralExtremeTimeUnix?: number | null;

  // Break Requirements & Verification
  breakRequired: boolean;
  breakLevel: number | null;
  breakCandle?: BreakCandleDetail | null;
  breakCandleOpen?: number | null;
  breakCandleHigh?: number | null;
  breakCandleLow?: number | null;
  breakCandleClose?: number | null;
  breakWasBodyClose: boolean;
  breakWasWickOnly: boolean;

  // Candidate Extreme
  candidateExtremeType: StructurePointType | null;
  candidateExtremePrice: number | null;
  candidateExtremeTime: string | null;
  candidateExtremeTimeUnix?: number | null;
  candidateExtremeIndex?: number | null;

  // Retracement Qualification
  retracementStartTime: string | null;
  retracementExtremePrice: number | null;
  retracementExtremeTime: string | null;
  retracementExtremeTimeUnix?: number | null;
  retracementExtremeIndex?: number | null;
  retracementCandleCount: number;
  requiredRetracementCandles: number;
  candleCountQualified: boolean;
  retracementBars?: RetracementBarDetail[];

  // Fibonacci Range & Qualification
  fibAnchorPrice: number | null;
  fibExtremePrice: number | null;
  fibRequiredRatio: number;
  fibRequiredPrice: number | null;
  actualRetracementRatio: number;
  actualRetracementDepthPrice?: number | null;
  fibQualified: boolean;
  fibQualifyingCandle?: {
    index: number;
    time: string;
    high: number;
    low: number;
    close: number;
  } | null;

  // Decision & Reasoning
  decision: string; // e.g. "HH CONFIRMED", "HL CONFIRMED", "REJECTED - WICK ONLY"
  decisionReason: string;
  algorithmVersion: string;

  // Parent / Child Relationships for Sequential Walking
  parentEventId?: string | null;
  childEventId?: string | null;
  previousEventId?: string | null;
  nextEventId?: string | null;
  relatedCycleId?: string | null;
}

export interface RejectedStructureEvent {
  id: string;
  regimeId?: string;
  cycleId?: string;
  rangeId?: string;
  candleIndex: number;
  candleTime?: string;
  candleTimeUnix?: number;
  timestamp?: string;
  timestampUnix?: number;
  price?: number;
  attemptedLevel?: number;
  actualValue?: number;
  requiredValue?: number;
  rejectionType: 'REJECTED_HIGH' | 'REJECTED_LOW' | 'REJECTED_RETRACEMENT' | 'REJECTED_INVALIDATION';
  label?: string;
  shortLabel?: string; // "X HIGH", "X LOW", "X RETRACE"
  reason: string;
  audit?: StructureDecisionAudit;
}

export interface CandleReplayStep {
  candleIndex: number;
  time?: string;
  timeUnix?: number;
  openTime?: string;
  openTimeUnix?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  state?: StructureState;
  trendState?: StructureState;
  regimeId?: string;
  cycleId?: string;
  rangeId?: string;
  activeRange?: {
    rangeId: string;
    direction: 'BULLISH' | 'BEARISH';
    topPrice: number;
    bottomPrice: number;
    topLabel: string;
    bottomLabel: string;
  } | null;
  cycleStatus?: 'WAITING_FOR_BREAK' | 'EXPANDING' | 'RETRACING' | 'CONFIRMED' | 'TRANSITION' | 'UNDEFINED';
  lockedAnchor?: {
    type: StructurePointType | string;
    price: number;
    time: string;
    label?: string;
  } | null;
  activeLockedAnchor?: {
    type: StructurePointType | string;
    price: number;
    time?: string;
    label?: string;
  } | null;
  previousExtreme?: {
    type: StructurePointType | string;
    price: number;
    time: string;
    label?: string;
  } | null;
  activeExtreme?: {
    type: StructurePointType | string;
    price: number;
    time?: string;
    label?: string;
  } | null;
  provisionalExtreme?: {
    type: StructurePointType | string;
    price: number;
    time: string;
  } | null;
  candidate?: {
    type: StructurePointType | string;
    price: number;
    retracementBars: number;
    currentFibDepth: number;
  } | null;
  retracementCandles?: number;
  currentFibDepth?: number;
  decisionTrace?: string[];
  eventId?: string | null;
  confirmedPointCreatedThisCandle?: string | null | boolean;
  structureBreakThisCandle?: string | null | boolean;
  engineState?: EngineStateSnapshot;
}

export interface EngineStateAnchorSnapshot {
  type: StructurePointType | string;
  price: number;
  label: string;
  eventId?: string;
  candleTime?: string;
  candleIndex?: number;
}

export interface EngineStateSnapshot {
  state: StructureState;
  phase: 'RANGE_LOCKED' | 'EXPANSION' | 'TRANSITION';
  activeTopAnchor: EngineStateAnchorSnapshot | null;
  activeBottomAnchor: EngineStateAnchorSnapshot | null;
  lastBreakEvent: string | null;
  candleIndex: number;
  rangeId?: string;
  direction?: 'BULLISH' | 'BEARISH';
}

export type ManualPointType = 'M_HH' | 'M_HL' | 'M_LH' | 'M_LL';
export type AuditUserLabel = 'CORRECT' | 'WRONG' | 'MISSING' | 'IGNORE';

export interface StructureAuditLabelRecord {
  id: string;
  symbol: string;
  timeframe: string;
  candleOpenTime: string;
  candleOpenTimeUnix: number;
  algorithmVersion: string;
  algorithmEventId?: string | null;
  manualType?: ManualPointType | null;
  manualPrice?: number | null;
  label: AuditUserLabel;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FirstDivergenceAnalysis {
  hasDivergence: boolean;
  earliestTime?: string | null;
  earliestTimeUnix?: number | null;
  algorithmPoint?: StructurePoint | null;
  manualAnnotation?: StructureAuditLabelRecord | null;
  divergenceType?: 'EXTRA_ALGORITHM_POINT' | 'MISSING_IN_ALGORITHM' | 'TYPE_MISMATCH' | 'PRICE_DISCREPANCY' | 'MANUAL_FLAGGED_WRONG';
  explanation?: string;
}
