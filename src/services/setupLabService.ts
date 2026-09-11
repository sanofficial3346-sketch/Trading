import { NormalizedMarketCandle, MexcContractDirectoryItem } from '../../server/marketData/mexcPublicMarketClient';
import {
  StructureDetectionResult,
  StructurePoint,
  StructureAuditLabelRecord,
  FirstDivergenceAnalysis,
  CURRENT_ALGORITHM_VERSION,
} from '../../server/setupDetector/structureTypes';

export interface SetupLabCandleData {
  symbol: string;
  timeframe: string;
  count: number;
  closedCount: number;
  hasUnclosed: boolean;
  lastSync: string | null;
  candles: NormalizedMarketCandle[];
}

export interface SetupLabSnapshotData extends SetupLabCandleData {
  structure: StructureDetectionResult;
}

export class SetupLabService {
  /**
   * Fetch verified symbols list from server (supports manual refresh & inactive toggle)
   */
  public async getSymbols(forceRefresh: boolean = false, showInactive: boolean = false): Promise<MexcContractDirectoryItem[]> {
    try {
      const res = await fetch(`/api/market/symbols?forceRefresh=${forceRefresh}&showInactive=${showInactive}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          return json.data;
        }
      }
    } catch (err) {
      console.error('[SetupLabService] Failed to load symbols:', err);
    }
    return [
      { rawSymbol: 'BTC_USDT', displaySymbol: 'BTC/USDT Perp', baseAsset: 'BTC', quoteAsset: 'USDT', contractType: 'PERPETUAL', state: 0, isTradable: true, symbol: 'BTC_USDT', displayName: 'BTC/USDT Perp', isSupported: true },
      { rawSymbol: 'ETH_USDT', displaySymbol: 'ETH/USDT Perp', baseAsset: 'ETH', quoteAsset: 'USDT', contractType: 'PERPETUAL', state: 0, isTradable: true, symbol: 'ETH_USDT', displayName: 'ETH/USDT Perp', isSupported: true },
      { rawSymbol: 'SOL_USDT', displaySymbol: 'SOL/USDT Perp', baseAsset: 'SOL', quoteAsset: 'USDT', contractType: 'PERPETUAL', state: 0, isTradable: true, symbol: 'SOL_USDT', displayName: 'SOL/USDT Perp', isSupported: true },
      { rawSymbol: 'XAU_USDT', displaySymbol: 'GOLD(XAU)/USDT Perp', baseAsset: 'XAU', quoteAsset: 'USDT', contractType: 'PERPETUAL', state: 0, isTradable: true, symbol: 'XAU_USDT', displayName: 'GOLD(XAU)/USDT Perp', isSupported: true },
      { rawSymbol: 'SILVER_USDT', displaySymbol: 'SILVER(XAG)/USDT Perp', baseAsset: 'SILVER', quoteAsset: 'USDT', contractType: 'PERPETUAL', state: 0, isTradable: true, symbol: 'SILVER_USDT', displayName: 'SILVER(XAG)/USDT Perp', isSupported: true },
      { rawSymbol: 'COPPER_USDT', displaySymbol: 'COPPER/USDT Perp', baseAsset: 'COPPER', quoteAsset: 'USDT', contractType: 'PERPETUAL', state: 0, isTradable: true, symbol: 'COPPER_USDT', displayName: 'COPPER/USDT Perp', isSupported: true },
    ];
  }

  /**
   * Fetch recent 5-minute candles for Setup Lab chart
   */
  public async getCandles(symbol: string, limit: number = 400): Promise<SetupLabCandleData> {
    const res = await fetch(`/api/market/candles?symbol=${encodeURIComponent(symbol)}&limit=${limit}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch candles: HTTP ${res.status}`);
    }
    const json = await res.json();
    if (!json.success || !json.data) {
      throw new Error(json.error || 'Invalid candle response');
    }
    return json.data;
  }

  /**
   * Manually trigger public candle sync from MEXC
   */
  public async syncCandles(symbol: string, limit: number = 400): Promise<void> {
    const res = await fetch('/api/market/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, limit }),
    });
    if (!res.ok) {
      throw new Error(`Sync request failed: HTTP ${res.status}`);
    }
  }

  /**
   * Fetch deterministic retracement-qualified market structure points
   */
  public async getStructure(
    symbol: string,
    params: {
      minimumRetracementCandles?: number;
      minimumRetracementFib?: number;
      analysisCandles?: number;
      warmUpCandles?: number;
      lookback?: number;
      legacyPivotOverlay?: boolean;
      showSequenceNumbers?: boolean;
      pivotLeftBars?: number;
      pivotRightBars?: number;
      algorithmVersion?: string;
      manualStart?: {
        direction: 'BULLISH' | 'BEARISH';
        top: { price: number; candleTime: string; candleTimeUnix?: number; candleIndex?: number };
        bottom: { price: number; candleTime: string; candleTimeUnix?: number; candleIndex?: number };
      };
      showInternalPriceActionDebug?: boolean;
    } = {}
  ): Promise<StructureDetectionResult> {
    if (params.manualStart) {
      const res = await fetch('/api/market/structure/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          ...params,
        }),
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch structure: HTTP ${res.status}`);
      }
      const json = await res.json();
      if (!json.success || !json.data) {
        throw new Error(json.error || 'Invalid structure detection response');
      }
      return json.data;
    }

    const minCandles = params.minimumRetracementCandles ?? 4;
    const minFib = params.minimumRetracementFib ?? 0.382;
    const analysisCandles = params.analysisCandles ?? 280;
    const warmUpCandles = params.warmUpCandles ?? 70;
    const legacyOverlay = params.legacyPivotOverlay ?? false;
    const showSequenceNumbers = params.showSequenceNumbers ?? true;
    const left = params.pivotLeftBars ?? 2;
    const right = params.pivotRightBars ?? 2;
    const versionParam = `&algorithmVersion=${encodeURIComponent(params.algorithmVersion ?? CURRENT_ALGORITHM_VERSION)}`;

    const res = await fetch(
      `/api/market/structure?symbol=${encodeURIComponent(
        symbol
      )}&minCandles=${minCandles}&minFib=${minFib}&analysisCandles=${analysisCandles}&warmUpCandles=${warmUpCandles}&legacyPivotOverlay=${legacyOverlay}&showSequenceNumbers=${showSequenceNumbers}&pivotLeftBars=${left}&pivotRightBars=${right}${versionParam}`
    );
    if (!res.ok) {
      throw new Error(`Failed to fetch structure: HTTP ${res.status}`);
    }
    const json = await res.json();
    if (!json.success || !json.data) {
      throw new Error(json.error || 'Invalid structure detection response');
    }
    return json.data;
  }

  public async getSnapshot(
    symbol: string,
    params: Parameters<SetupLabService['getStructure']>[1],
    sync: boolean = true
  ): Promise<SetupLabSnapshotData> {
    const res = await fetch('/api/market/setup-lab/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, ...params, algorithmVersion: CURRENT_ALGORITHM_VERSION, sync }),
    });
    if (!res.ok) throw new Error(`Failed to fetch Setup Lab snapshot: HTTP ${res.status}`);
    const json = await res.json();
    if (!json.success || !json.data) throw new Error(json.error || 'Invalid Setup Lab snapshot');
    return json.data;
  }

  /**
   * Fetch user manual structure labels / audit flags
   */
  public async getAuditLabels(symbol: string, timeframe: string = '5M', algorithmVersion: string = CURRENT_ALGORITHM_VERSION): Promise<StructureAuditLabelRecord[]> {
    try {
      const res = await fetch(`/api/market/structure/audit-labels?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&algorithmVersion=${encodeURIComponent(algorithmVersion)}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          return json.data;
        }
      }
    } catch (err) {
      console.error('[SetupLabService] Failed to load audit labels:', err);
    }
    return [];
  }

  /**
   * Save or update manual structure label
   */
  public async saveAuditLabel(record: Partial<StructureAuditLabelRecord>): Promise<StructureAuditLabelRecord> {
    const res = await fetch('/api/market/structure/audit-labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    if (!res.ok) {
      throw new Error(`Failed to save audit label: HTTP ${res.status}`);
    }
    const json = await res.json();
    if (!json.success || !json.data) {
      throw new Error(json.error || 'Failed to save audit label');
    }
    return json.data;
  }

  /**
   * Delete manual structure label
   */
  public async deleteAuditLabel(id: string): Promise<boolean> {
    const res = await fetch(`/api/market/structure/audit-labels/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) return false;
    const json = await res.json();
    return !!json.deleted;
  }

  /**
   * Calculate first divergence point against manual markup
   */
  public async calculateDivergence(
    points: StructurePoint[],
    labels: StructureAuditLabelRecord[]
  ): Promise<FirstDivergenceAnalysis> {
    const res = await fetch('/api/market/structure/divergence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points, labels }),
    });
    if (!res.ok) {
      throw new Error(`Divergence check failed: HTTP ${res.status}`);
    }
    const json = await res.json();
    return json.data;
  }
}

export const setupLabService = new SetupLabService();
