import { NormalizedMarketCandle } from '../marketData/mexcPublicMarketClient';
import {
  StructureDetectionResult,
  StructurePoint,
  StructureState,
  StructurePointType,
} from './structureTypes';
import {
  StructureDecisionAudit,
  CandleReplayStep,
  RejectedStructureEvent,
} from './structureAuditTypes';

export class StructureReplayService {
  /**
   * Generates candle-by-candle replay snapshots throughout the main analysis window.
   */
  public generateCandleReplaySteps(
    candles: NormalizedMarketCandle[],
    mainStartIndex: number,
    detectionResult: StructureDetectionResult
  ): CandleReplayStep[] {
    const steps: CandleReplayStep[] = [];
    if (!detectionResult.candleReplaySteps || detectionResult.candleReplaySteps.length === 0) {
      return steps;
    }
    return detectionResult.candleReplaySteps;
  }

  /**
   * Helper to jump to a specific event or candle in the replay.
   */
  public findStepForEvent(
    steps: CandleReplayStep[],
    eventId: string
  ): CandleReplayStep | undefined {
    return steps.find((s) => s.eventId === eventId);
  }

  /**
   * Helper to find audit record for a given candle timestamp.
   */
  public findAuditAtCandle(
    audits: StructureDecisionAudit[],
    candleTimeUnix: number
  ): StructureDecisionAudit | undefined {
    return audits.find((a) => a.timestampUnix === candleTimeUnix);
  }
}

export const structureReplayService = new StructureReplayService();
