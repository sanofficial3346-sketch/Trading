import { Router, Request, Response } from 'express';
import { checkDatabaseHealth } from './prisma';
import { getTradingRepository } from './repository';
import { SyncStatus, SyncType } from '../../src/db/types';

export const databaseRouter = Router();

/**
 * GET /api/database/status
 * Server-side health check for persistent database (Supabase / PostgreSQL).
 * Strictly NEVER exposes DATABASE_URL, passwords, or connection parameters.
 */
databaseRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const health = await checkDatabaseHealth();
    res.json({
      success: true,
      data: health,
    });
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: 'Failed to inspect database health',
      message: (err as Error).message,
    });
  }
});

/**
 * POST /api/database/test-persistence
 * Performs an automated, non-destructive test using synthetic TEST data only.
 * Creates a test sync_job, verifies read-back, and deletes the test record.
 */
databaseRouter.post('/test-persistence', async (req: Request, res: Response) => {
  try {
    const repository = getTradingRepository();
    const health = await repository.getHealth();

    if (!repository.isPersistent || health.status !== 'CONNECTED') {
      return res.status(400).json({
        success: false,
        error: 'Persistent database is not connected.',
        details: health,
      });
    }

    const testId = `test_persist_${Date.now()}`;
    const timestamp = new Date().toISOString();

    // 1. Create test sync job
    await repository.createSyncJob({
      id: testId,
      tradingAccountId: 'acc_mexc_futures_01',
      syncType: SyncType.FILLS,
      status: SyncStatus.COMPLETED,
      startedAt: timestamp,
      completedAt: timestamp,
      recordsReceived: 1,
      recordsInserted: 1,
      recordsSkipped: 0,
      errorMessage: null,
      metadata: { test: true, purpose: 'persistence_verification' },
      createdAt: timestamp,
    });

    // 2. Read back
    const retrieved = await repository.getSyncJob(testId);
    if (!retrieved || retrieved.id !== testId) {
      throw new Error('Test sync job record could not be retrieved from PostgreSQL');
    }

    // 3. Clean up test record
    if (repository.deleteSyncJob) {
      await repository.deleteSyncJob(testId);
    }

    res.json({
      success: true,
      message: 'PostgreSQL persistence round-trip verified successfully.',
      testedId: testId,
      databaseStatus: health.status,
    });
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: 'Persistence verification test failed',
      message: (err as Error).message,
    });
  }
});
