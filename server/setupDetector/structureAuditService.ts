import { db } from '../../src/db/database';
import { StructurePoint, StructureState } from './structureTypes';
import {
  StructureDecisionAudit,
  RejectedStructureEvent,
  StructureAuditLabelRecord,
  FirstDivergenceAnalysis,
} from './structureAuditTypes';

export class StructureAuditService {
  /**
   * Idempotently saves or updates a manual audit label / correction marker.
   */
  public async saveAuditLabel(record: Omit<StructureAuditLabelRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<StructureAuditLabelRecord> {
    const now = new Date().toISOString();
    const id = record.id || `lbl_${record.symbol}_${record.candleOpenTimeUnix}_${Date.now()}`;
    const fullRecord: StructureAuditLabelRecord = {
      ...record,
      id,
      notes: record.notes || null,
      algorithmEventId: record.algorithmEventId || null,
      manualType: record.manualType || null,
      manualPrice: record.manualPrice || null,
      createdAt: now,
      updatedAt: now,
    };

    db.structureAuditLabels.set(id, fullRecord);
    return fullRecord;
  }

  /**
   * Retrieves all manual audit labels for a given symbol & timeframe.
   */
  public async getAuditLabels(
    symbol: string,
    timeframe?: string,
    algorithmVersion?: string
  ): Promise<StructureAuditLabelRecord[]> {
    const results: StructureAuditLabelRecord[] = [];
    db.structureAuditLabels.forEach((item: StructureAuditLabelRecord) => {
      if (item.symbol === symbol) {
        if (timeframe && item.timeframe !== timeframe) return;
        if (algorithmVersion && item.algorithmVersion !== algorithmVersion) return;
        results.push(item);
      }
    });

    // Return sorted chronologically
    return results.sort((a, b) => a.candleOpenTimeUnix - b.candleOpenTimeUnix);
  }

  /**
   * Deletes a manual audit label by ID.
   */
  public async deleteAuditLabel(id: string): Promise<boolean> {
    return db.structureAuditLabels.delete(id);
  }

  /**
   * Identifies the FIRST chronological divergence between the algorithm's detected structure
   * and the user's manual annotations or correction flags.
   */
  public calculateFirstDivergence(
    points: StructurePoint[],
    labels: StructureAuditLabelRecord[]
  ): FirstDivergenceAnalysis {
    if (!labels || labels.length === 0) {
      return { hasDivergence: false };
    }

    // Sort both sets chronologically
    const sortedPoints = [...points].sort((a, b) => a.candleOpenTimeUnix - b.candleOpenTimeUnix);
    const sortedLabels = [...labels].sort((a, b) => a.candleOpenTimeUnix - b.candleOpenTimeUnix);

    // 1. Check if any algorithm point was explicitly marked as 'WRONG'
    for (const label of sortedLabels) {
      if (label.label === 'WRONG') {
        const matchingPoint = sortedPoints.find(
          (p) => Math.abs(p.candleOpenTimeUnix - label.candleOpenTimeUnix) <= 600 // within 10 mins
        );
        return {
          hasDivergence: true,
          earliestTime: label.candleOpenTime,
          earliestTimeUnix: label.candleOpenTimeUnix,
          algorithmPoint: matchingPoint || null,
          manualAnnotation: label,
          divergenceType: 'MANUAL_FLAGGED_WRONG',
          explanation: `Point at ${label.candleOpenTime} was marked as WRONG by manual audit${label.notes ? `: "${label.notes}"` : ''}.`,
        };
      }
    }

    // 2. Check if a manual point was marked as 'MISSING' (detector failed to identify a swing)
    for (const label of sortedLabels) {
      if (label.label === 'MISSING' || (label.manualType && !sortedPoints.some((p) => Math.abs(p.candleOpenTimeUnix - label.candleOpenTimeUnix) <= 600))) {
        return {
          hasDivergence: true,
          earliestTime: label.candleOpenTime,
          earliestTimeUnix: label.candleOpenTimeUnix,
          algorithmPoint: null,
          manualAnnotation: label,
          divergenceType: 'MISSING_IN_ALGORITHM',
          explanation: `Manual structure marked ${label.manualType || 'swing'} at ${label.candleOpenTime} (${label.manualPrice?.toFixed(2) ?? 'N/A'}), which was not detected by the algorithm.`,
        };
      }
    }

    // 3. Check for type mismatch or price discrepancy where both exist
    for (const label of sortedLabels) {
      if (label.manualType) {
        const expectedType = label.manualType.replace('M_', '');
        const matchingPoint = sortedPoints.find(
          (p) => Math.abs(p.candleOpenTimeUnix - label.candleOpenTimeUnix) <= 600
        );

        if (matchingPoint) {
          if (matchingPoint.type !== expectedType) {
            return {
              hasDivergence: true,
              earliestTime: label.candleOpenTime,
              earliestTimeUnix: label.candleOpenTimeUnix,
              algorithmPoint: matchingPoint,
              manualAnnotation: label,
              divergenceType: 'TYPE_MISMATCH',
              explanation: `Type mismatch at ${label.candleOpenTime}: Algorithm classified as ${matchingPoint.type}, but manual markup is ${expectedType}.`,
            };
          }

          if (label.manualPrice !== undefined && label.manualPrice !== null) {
            const priceDiff = Math.abs(matchingPoint.price - label.manualPrice);
            if (priceDiff > 0.0001 && priceDiff / matchingPoint.price > 0.0005) {
              return {
                hasDivergence: true,
                earliestTime: label.candleOpenTime,
                earliestTimeUnix: label.candleOpenTimeUnix,
                algorithmPoint: matchingPoint,
                manualAnnotation: label,
                divergenceType: 'PRICE_DISCREPANCY',
                explanation: `Price discrepancy at ${label.candleOpenTime}: Algorithm price ${matchingPoint.price.toFixed(2)} vs manual price ${label.manualPrice.toFixed(2)}.`,
              };
            }
          }
        }
      }
    }

    return { hasDivergence: false };
  }

  /**
   * Links parent/child and previous/next relationships between deterministic audits.
   */
  public linkAuditChain(audits: StructureDecisionAudit[]): StructureDecisionAudit[] {
    const sorted = [...audits].sort((a, b) => a.candleIndex - b.candleIndex);

    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i];
      if (i > 0) {
        current.previousEventId = sorted[i - 1].eventId;
      }
      if (i < sorted.length - 1) {
        current.nextEventId = sorted[i + 1].eventId;
      }

      // Link parent / child within the same cycle or sequence
      if (current.eventType === 'HH') {
        // Parent is previous HL
        const parentHL = sorted
          .slice(0, i)
          .reverse()
          .find((a) => a.eventType === 'HL' && a.regimeId === current.regimeId);
        if (parentHL) {
          current.parentEventId = parentHL.eventId;
          parentHL.childEventId = current.eventId;
        }
      } else if (current.eventType === 'HL') {
        // Parent is previous HH
        const parentHH = sorted
          .slice(0, i)
          .reverse()
          .find((a) => a.eventType === 'HH' && a.regimeId === current.regimeId);
        if (parentHH) {
          current.parentEventId = parentHH.eventId;
          parentHH.childEventId = current.eventId;
        }
      } else if (current.eventType === 'LL') {
        // Parent is previous LH
        const parentLH = sorted
          .slice(0, i)
          .reverse()
          .find((a) => a.eventType === 'LH' && a.regimeId === current.regimeId);
        if (parentLH) {
          current.parentEventId = parentLH.eventId;
          parentLH.childEventId = current.eventId;
        }
      } else if (current.eventType === 'LH') {
        // Parent is previous LL
        const parentLL = sorted
          .slice(0, i)
          .reverse()
          .find((a) => a.eventType === 'LL' && a.regimeId === current.regimeId);
        if (parentLL) {
          current.parentEventId = parentLL.eventId;
          parentLL.childEventId = current.eventId;
        }
      }
    }

    return sorted;
  }
}

export const structureAuditService = new StructureAuditService();
