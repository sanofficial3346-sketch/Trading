/**
 * Frontend MEXC Integration Service
 *
 * Communicates exclusively with the server-side proxy `/api/mexc/*`.
 * Strictly ZERO API secrets or direct calls from browser to MEXC.
 */

import {
  MexcConnectionStatus,
  MexcIntegrationStatus,
  MexcSyncResult,
  TestConnectionResult,
} from '../../server/mexc/types';
import { SyncJobRecord } from '../db/types';

export interface DatabaseHealth {
  status: 'CONNECTED' | 'NOT_CONFIGURED' | 'ERROR';
  provider: string;
  persistent: boolean;
  tablesCount?: number;
  message?: string;
  timestamp: string;
}

export interface RawSummaryData {
  counts: {
    rawOrders: number;
    rawFills: number;
    fundingTransactions: number;
    equitySnapshots: number;
  };
  sampleFills: Array<{
    id: string;
    exchangeFillId: string;
    exchangeOrderId?: string | null;
    symbol: string;
    side: string;
    price: string;
    quantity: string;
    fee: string;
    exchangeTimestamp: string;
  }>;
}

class MexcFrontendService {
  private baseApiUrl = '/api/mexc';

  /**
   * Fetch current connection and configuration status
   */
  public async getStatus(): Promise<MexcIntegrationStatus> {
    try {
      const res = await fetch(`${this.baseApiUrl}/status`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          return json.data;
        }
      }
    } catch {
      // Fallback
    }

    return {
      status: MexcConnectionStatus.NOT_CONFIGURED,
      apiKeyConfigured: false,
      secretKeyConfigured: false,
      maskedAccessKey: null,
      lastSuccessfulSync: null,
      lastFailedSync: null,
      lastError: null,
      persistentDbConnected: false,
      activeAccountName: 'MEXC Futures Main',
      exchange: 'MEXC Global (Contract API)',
      mode: 'NOT_CONFIGURED',
      rawSummary: {
        ordersCount: 0,
        fillsCount: 0,
        fundingCount: 0,
        snapshotsCount: 0,
      },
    };
  }

  /**
   * Execute read-only test connection via server proxy
   */
  public async testConnection(credentials?: {
    accessKey?: string;
    secretKey?: string;
  }): Promise<TestConnectionResult> {
    try {
      const res = await fetch(`${this.baseApiUrl}/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials || {}),
      });

      if (res.ok) {
        const json = await res.json();
        return json.data;
      }
    } catch {
      // Fallback
    }

    return {
      success: false,
      status: MexcConnectionStatus.NOT_CONFIGURED,
      accountDetected: false,
      timestamp: new Date().toISOString(),
      serverTime: Date.now(),
      timeOffsetMs: 0,
      message: 'MEXC API credentials are not configured.',
      readOnlyPermissionsVerified: false,
    };
  }

  /**
   * Trigger safe read-only incremental sync
   */
  public async triggerSync(symbol?: string): Promise<MexcSyncResult> {
    try {
      const res = await fetch(`${this.baseApiUrl}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });

      if (res.ok) {
        const json = await res.json();
        return json.data;
      }
    } catch {
      // Fallback
    }

    return {
      jobId: `sync_err_${Date.now()}`,
      syncType: 'FILLS',
      status: 'FAILED',
      recordsReceived: 0,
      recordsInserted: 0,
      recordsSkipped: 0,
      durationMs: 0,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      errorMessage: 'MEXC API credentials or persistent database not connected.',
    };
  }

  /**
   * Trigger paginated historical backfill
   */
  public async triggerBackfill(maxPages = 50, symbol?: string): Promise<MexcSyncResult> {
    try {
      const res = await fetch(`${this.baseApiUrl}/backfill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxPages, symbol }),
      });

      if (res.ok) {
        const json = await res.json();
        return json.data;
      }
    } catch {
      // Fallback
    }

    return {
      jobId: `backfill_err_${Date.now()}`,
      syncType: 'FULL_HISTORY',
      status: 'FAILED',
      recordsReceived: 0,
      recordsInserted: 0,
      recordsSkipped: 0,
      durationMs: 0,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      errorMessage: 'MEXC API credentials or persistent database not connected.',
    };
  }

  /**
   * Fetch recent sync jobs
   */
  public async getSyncJobs(): Promise<SyncJobRecord[]> {
    try {
      const res = await fetch(`${this.baseApiUrl}/sync-jobs`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          return json.data;
        }
      }
    } catch {
      // Fallback
    }

    return [];
  }

  /**
   * Fetch raw data summary counts
   */
  public async getRawSummary(): Promise<RawSummaryData> {
    try {
      const res = await fetch(`${this.baseApiUrl}/raw-summary`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          return json.data;
        }
      }
    } catch {
      // Fallback
    }

    return {
      counts: {
        rawOrders: 0,
        rawFills: 0,
        fundingTransactions: 0,
        equitySnapshots: 0,
      },
      sampleFills: [],
    };
  }

  /**
   * Fetch server-side persistent database health check.
   * Strictly never exposes credentials or DATABASE_URL.
   */
  public async getDatabaseHealth(): Promise<DatabaseHealth> {
    try {
      const res = await fetch('/api/database/status');
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          return json.data;
        }
      }
    } catch {
      // Fallback
    }

    return {
      status: 'NOT_CONFIGURED',
      provider: 'Supabase PostgreSQL (Prisma)',
      persistent: false,
      message: 'DATABASE_URL not configured in server environment.',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Run automated server-side persistence verification test.
   */
  public async testPersistence(): Promise<{ success: boolean; message: string; testedId?: string; details?: unknown }> {
    try {
      const res = await fetch('/api/database/test-persistence', { method: 'POST' });
      const json = await res.json();
      return json;
    } catch (err: unknown) {
      return {
        success: false,
        message: (err as Error).message || 'Persistence test failed',
      };
    }
  }
}

export const mexcFrontendService = new MexcFrontendService();
