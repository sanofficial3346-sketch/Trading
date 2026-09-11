/**
 * MEXC Futures Express API Router
 *
 * Exposes server-side endpoints for:
 * - GET  /api/mexc/status           (Safe status & configuration check)
 * - POST /api/mexc/test-connection  (Harmless read-only connection test)
 * - POST /api/mexc/sync             (Triggers read-only incremental sync)
 * - POST /api/mexc/backfill         (Triggers paginated historical backfill)
 * - GET  /api/mexc/sync-jobs        (Lists sync audit history)
 * - GET  /api/mexc/raw-summary      (Returns counts and inspection stats)
 */

import { Router, Request, Response } from 'express';
import { db } from '../../src/db/database';
import { SyncType } from '../../src/db/types';
import { MexcClient } from './mexcClient';
import { mexcIngestionService, MexcIngestionService } from './mexcIngestionService';
import { MexcConnectionStatus } from './types';
import { getTradingRepository } from '../db/repository';

export const mexcRouter = Router();

/**
 * GET /api/mexc/status
 * Safe status inspection. Secrets are strictly stripped.
 */
mexcRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const status = await mexcIngestionService.getIntegrationStatus();
    res.json({ success: true, data: status });
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve MEXC integration status',
      message: (err as Error).message,
    });
  }
});

/**
 * POST /api/mexc/test-connection
 * Executes read-only ping and asset balance check
 */
mexcRouter.post('/test-connection', async (req: Request, res: Response) => {
  try {
    // Optional ephemeral credentials for testing server connection in environments without persistent env files
    const { accessKey, secretKey } = req.body || {};
    let service = mexcIngestionService;

    if (accessKey && secretKey) {
      const ephemeralClient = new MexcClient({
        accessKey: String(accessKey).trim(),
        secretKey: String(secretKey).trim(),
      });
      service = new MexcIngestionService(ephemeralClient);
    }

    const result = await service.testConnection();
    res.json({ success: result.success, data: result });
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: 'Test connection failed unexpectedly',
      message: (err as Error).message,
    });
  }
});

/**
 * POST /api/mexc/sync
 * Triggers safe read-only incremental sync
 */
mexcRouter.post('/sync', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.body || {};
    const result = await mexcIngestionService.runFullSync({
      syncType: SyncType.FILLS,
      isBackfill: false,
      maxPages: 5,
      symbol: symbol ? String(symbol) : undefined,
    });

    res.json({
      success: result.status === 'COMPLETED',
      data: result,
    });
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: 'Sync operation failed',
      message: (err as Error).message,
    });
  }
});

/**
 * POST /api/mexc/backfill
 * Triggers paginated historical backfill across available orders and deals
 */
mexcRouter.post('/backfill', async (req: Request, res: Response) => {
  try {
    const { symbol, maxPages } = req.body || {};
    const result = await mexcIngestionService.runFullSync({
      syncType: SyncType.FULL_HISTORY,
      isBackfill: true,
      maxPages: maxPages ? Number(maxPages) : 50,
      symbol: symbol ? String(symbol) : undefined,
    });

    res.json({
      success: result.status === 'COMPLETED',
      data: result,
    });
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: 'Historical backfill operation failed',
      message: (err as Error).message,
    });
  }
});

/**
 * GET /api/mexc/sync-jobs
 * Retrieves chronological audit history of sync operations from authoritative repository
 */
mexcRouter.get('/sync-jobs', async (req: Request, res: Response) => {
  try {
    const repository = getTradingRepository();
    const jobs = await repository.getSyncJobs(undefined, 30);

    res.json({ success: true, data: jobs });
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve sync jobs',
      message: (err as Error).message,
    });
  }
});

/**
 * GET /api/mexc/raw-summary
 * Summary counts and latest ingested records from authoritative repository
 */
mexcRouter.get('/raw-summary', async (req: Request, res: Response) => {
  try {
    const repository = getTradingRepository();
    const counts = await repository.getCounts();
    const latestFills = await repository.getRawFills(undefined, undefined, 5);

    // Latest 5 raw fills sample
    const sampleFills = latestFills.map((f) => ({
      id: f.id,
      exchangeFillId: f.exchangeFillId,
      exchangeOrderId: f.exchangeOrderId,
      symbol: f.symbol,
      side: f.side,
      price: f.price.toString(),
      quantity: f.quantity.toString(),
      fee: f.fee.toString(),
      exchangeTimestamp: f.exchangeTimestamp,
    }));

    res.json({
      success: true,
      data: {
        counts,
        sampleFills,
      },
    });
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve raw summary',
      message: (err as Error).message,
    });
  }
});
