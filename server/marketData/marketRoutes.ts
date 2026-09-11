import { Router, Request, Response } from 'express';
import { mexcPublicMarketClient } from './mexcPublicMarketClient';
import { candleService } from './candleService';
import { candleRepository } from './candleRepository';
import { structureEngine, STRUCTURE_LOOKBACK_CANDLES } from '../setupDetector/structureEngine';
import { structureAuditService } from '../setupDetector/structureAuditService';
import { CURRENT_ALGORITHM_VERSION } from '../setupDetector/structureTypes';

export const marketRouter = Router();

/**
 * GET /api/market/symbols
 * Return complete contract directory with verification metadata.
 * Supports forceRefresh=true and showInactive=true.
 * Does NOT require credentials.
 */
marketRouter.get('/symbols', async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.query.forceRefresh === 'true';
    const showInactive = req.query.showInactive === 'true';
    const directory = await mexcPublicMarketClient.getContractDirectory(forceRefresh);
    const data = showInactive ? directory : directory.filter((d) => d.isTradable);

    res.json({
      success: true,
      data,
      totalCount: directory.length,
      tradableCount: directory.filter((d) => d.isTradable).length,
      cached: !forceRefresh,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: (err as Error).message || 'Failed to retrieve available symbols',
    });
  }
});

/**
 * GET /api/market/candles
 * Retrieve candles for Setup Lab.
 * Query params: symbol (default BTC_USDT), timeframe (default 5M), limit (default 400)
 */
marketRouter.get('/candles', async (req: Request, res: Response) => {
  try {
    const symbol = ((req.query.symbol as string) || 'BTC_USDT').trim().toUpperCase();
    const limit = Math.max(50, Math.min(1500, parseInt((req.query.limit as string) || '400', 10)));

    const candles = await candleService.getDisplayCandles(symbol, limit);
    const lastSync = candleService.getLastSyncTime(symbol);

    res.json({
      success: true,
      data: {
        symbol,
        timeframe: '5M',
        count: candles.length,
        closedCount: candles.filter((c) => c.isClosed).length,
        hasUnclosed: candles.some((c) => !c.isClosed),
        lastSync,
        candles,
      },
    });
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: (err as Error).message || 'Failed to load candles',
    });
  }
});

/**
 * POST /api/market/sync
 * Manually trigger public candle ingestion from MEXC.
 */
marketRouter.post('/sync', async (req: Request, res: Response) => {
  try {
    const symbol = (req.body.symbol || 'BTC_USDT').trim().toUpperCase();
    const limit = Math.max(50, Math.min(1500, parseInt(req.body.limit || '400', 10)));

    const result = await candleService.syncCandles(symbol, limit);
    res.json({
      success: true,
      data: result,
    });
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: (err as Error).message || 'Failed to sync candles from MEXC public API',
    });
  }
});

/**
 * GET /api/market/structure
 * Run deterministic retracement-qualified market structure analysis on user-selected closed candles count.
 */
marketRouter.get('/structure', async (req: Request, res: Response) => {
  try {
    const symbol = ((req.query.symbol as string) || 'BTC_USDT').trim().toUpperCase();
    const minCandles = Math.max(1, Math.min(20, parseInt((req.query.minCandles as string) || (req.query.minimumRetracementCandles as string) || '4', 10)));
    const minFib = Math.max(0.1, Math.min(1.0, parseFloat((req.query.minFib as string) || (req.query.minimumRetracementFib as string) || '0.382')));
    const analysisCandles = Math.max(100, Math.min(1000, parseInt((req.query.analysisCandles as string) || '280', 10)));
    const warmUpCandles = Math.max(0, Math.min(200, parseInt((req.query.warmUpCandles as string) || (req.query.initializationSearchCandles as string) || '70', 10)));
    const lookback = analysisCandles + warmUpCandles;
    const legacyPivotOverlay = req.query.legacyPivotOverlay === 'true';
    const showSequenceNumbers = req.query.showSequenceNumbers !== 'false';
    const pivotLeftBars = Math.max(1, Math.min(10, parseInt((req.query.pivotLeftBars as string) || '2', 10)));
    const pivotRightBars = Math.max(1, Math.min(10, parseInt((req.query.pivotRightBars as string) || '2', 10)));
    const algorithmVersion = (req.query.algorithmVersion as string) || CURRENT_ALGORITHM_VERSION;
    const showInternalPriceActionDebug = req.query.showInternalPriceActionDebug === 'true';

    // Ensure we load enough candles for the requested lookback window + buffer
    const candles = await candleService.getDisplayCandles(symbol, Math.max(lookback + 50, 450));

    const result = structureEngine.detectStructure(candles, {
      minimumRetracementCandles: minCandles,
      minimumRetracementFib: minFib,
      analysisCandles,
      initializationSearchCandles: warmUpCandles,
      lookbackCandles: lookback,
      legacyPivotOverlay,
      showSequenceNumbers,
      pivotLeftBars,
      pivotRightBars,
      equalityMode: 'STRICT',
      algorithmVersion,
      showInternalPriceActionDebug,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: (err as Error).message || 'Failed to detect market structure',
    });
  }
});

/**
 * POST /api/market/structure/detect
 * Dynamic parameter recalculation.
 */
marketRouter.post('/structure/detect', async (req: Request, res: Response) => {
  try {
    const symbol = (req.body.symbol || 'BTC_USDT').trim().toUpperCase();
    const minCandles = Math.max(1, Math.min(20, parseInt(req.body.minCandles || req.body.minimumRetracementCandles || '4', 10)));
    const minFib = Math.max(0.1, Math.min(1.0, parseFloat(req.body.minFib || req.body.minimumRetracementFib || '0.382')));
    const analysisCandles = Math.max(100, Math.min(1000, parseInt(req.body.analysisCandles || '280', 10)));
    const warmUpCandles = Math.max(0, Math.min(200, parseInt(req.body.warmUpCandles || req.body.initializationSearchCandles || '70', 10)));
    const lookback = analysisCandles + warmUpCandles;
    const legacyPivotOverlay = req.body.legacyPivotOverlay === true;
    const showSequenceNumbers = req.body.showSequenceNumbers !== false;
    const pivotLeftBars = Math.max(1, Math.min(10, parseInt(req.body.pivotLeftBars || '2', 10)));
    const pivotRightBars = Math.max(1, Math.min(10, parseInt(req.body.pivotRightBars || '2', 10)));
    const algorithmVersion = req.body.algorithmVersion || CURRENT_ALGORITHM_VERSION;
    const manualStart = req.body.manualStart || undefined;
    const showInternalPriceActionDebug = req.body.showInternalPriceActionDebug === true;

    const candles = await candleService.getDisplayCandles(symbol, Math.max(lookback + 50, 450));
    const result = structureEngine.detectStructure(candles, {
      minimumRetracementCandles: minCandles,
      minimumRetracementFib: minFib,
      analysisCandles,
      initializationSearchCandles: warmUpCandles,
      lookbackCandles: lookback,
      legacyPivotOverlay,
      showSequenceNumbers,
      pivotLeftBars,
      pivotRightBars,
      equalityMode: 'STRICT',
      algorithmVersion,
      manualStart,
      showInternalPriceActionDebug,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: (err as Error).message || 'Failed to recalculate structure',
    });
  }
});

/** Return candles and V6 structure from the same closed-candle snapshot. */
marketRouter.post('/setup-lab/snapshot', async (req: Request, res: Response) => {
  try {
    const symbol = (req.body.symbol || 'BTC_USDT').trim().toUpperCase();
    const analysisCandles = Math.max(50, Math.min(1000, Number(req.body.analysisCandles ?? 280)));
    const warmUpCandles = Math.max(0, Math.min(200, Number(req.body.warmUpCandles ?? 70)));
    const limit = Math.max(analysisCandles + warmUpCandles + 50, 450);
    if (req.body.sync !== false) await candleService.refreshIfStale(symbol, limit);
    const storedCandles = await candleRepository.getCandles(symbol, '5M', limit);
    const candles = storedCandles.filter((c) => c.isClosed);
    const structure = structureEngine.detectStructure(candles, {
      algorithmVersion: CURRENT_ALGORITHM_VERSION,
      analysisCandles,
      initializationSearchCandles: warmUpCandles,
      lookbackCandles: analysisCandles + warmUpCandles,
      minimumRetracementCandles: Math.max(1, Math.min(20, Number(req.body.minimumRetracementCandles ?? 4))),
      minimumRetracementFib: Math.max(0.1, Math.min(1, Number(req.body.minimumRetracementFib ?? 0.382))),
      breakConfirmation: 'CLOSE',
      fibTouchMode: 'WICK',
      showSequenceNumbers: req.body.showSequenceNumbers !== false,
      manualStart: req.body.manualStart || undefined,
    });
    res.json({
      success: true,
      data: {
        symbol,
        timeframe: '5M',
        count: candles.length,
        closedCount: candles.filter((c) => c.isClosed).length,
        hasUnclosed: storedCandles.some((c) => !c.isClosed),
        lastSync: candleService.getLastSyncTime(symbol),
        candles,
        structure,
      },
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: (err as Error).message || 'Failed to build Setup Lab snapshot' });
  }
});

/**
 * GET /api/market/structure/audit-labels
 * Retrieve user manual structure markings and audit flags.
 */
marketRouter.get('/structure/audit-labels', async (req: Request, res: Response) => {
  try {
    const symbol = ((req.query.symbol as string) || 'BTC_USDT').trim().toUpperCase();
    const timeframe = (req.query.timeframe as string) || undefined;
    const algorithmVersion = (req.query.algorithmVersion as string) || CURRENT_ALGORITHM_VERSION;

    const labels = await structureAuditService.getAuditLabels(symbol, timeframe, algorithmVersion);
    res.json({
      success: true,
      data: labels,
    });
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: (err as Error).message || 'Failed to retrieve structure audit labels',
    });
  }
});

/**
 * POST /api/market/structure/audit-labels
 * Save or update manual structure label / audit flag.
 */
marketRouter.post('/structure/audit-labels', async (req: Request, res: Response) => {
  try {
    const {
      symbol,
      timeframe = '5M',
      candleOpenTime,
      candleOpenTimeUnix,
      algorithmVersion = CURRENT_ALGORITHM_VERSION,
      algorithmEventId,
      manualType,
      manualPrice,
      label = 'CORRECT',
      notes,
    } = req.body;

    if (!symbol || !candleOpenTime || candleOpenTimeUnix === undefined) {
      return res.status(400).json({
        success: false,
        error: 'symbol, candleOpenTime, and candleOpenTimeUnix are required',
      });
    }

    const saved = await structureAuditService.saveAuditLabel({
      symbol: symbol.trim().toUpperCase(),
      timeframe,
      candleOpenTime,
      candleOpenTimeUnix: Number(candleOpenTimeUnix),
      algorithmVersion,
      algorithmEventId,
      manualType,
      manualPrice: manualPrice !== undefined && manualPrice !== null ? Number(manualPrice) : null,
      label,
      notes,
    });

    res.json({
      success: true,
      data: saved,
    });
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: (err as Error).message || 'Failed to save structure audit label',
    });
  }
});

/**
 * DELETE /api/market/structure/audit-labels/:id
 * Remove a manual structure label.
 */
marketRouter.delete('/structure/audit-labels/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await structureAuditService.deleteAuditLabel(id);
    res.json({
      success: true,
      deleted,
    });
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: (err as Error).message || 'Failed to delete structure audit label',
    });
  }
});

/**
 * POST /api/market/structure/divergence
 * Calculate first divergence between detected structure and manual markup.
 */
marketRouter.post('/structure/divergence', async (req: Request, res: Response) => {
  try {
    const { points = [], labels = [] } = req.body;
    const analysis = structureAuditService.calculateFirstDivergence(points, labels);
    res.json({
      success: true,
      data: analysis,
    });
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: (err as Error).message || 'Failed to analyze divergence',
    });
  }
});
