/**
 * Public MEXC Futures/Contract Market Data Client
 * 
 * STRICT ARCHITECTURAL ISOLATION:
 * This client interacts ONLY with public, unauthenticated MEXC Contract endpoints.
 * It strictly DOES NOT require MEXC_ACCESS_KEY or MEXC_SECRET_KEY.
 * It is completely decoupled from private account execution or balance queries.
 */

export interface NormalizedMarketCandle {
  id?: string;
  symbol: string;
  timeframe: string; // e.g. '5M'
  openTime: string; // ISO 8601 UTC string
  openTimeUnix: number; // Unix timestamp in milliseconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  isClosed: boolean;
  source: 'MEXC_PUBLIC';
}

export interface MexcContractKlineResponse {
  success: boolean;
  code: number;
  message?: string;
  data?: {
    time?: number[];
    open?: (number | string)[];
    close?: (number | string)[];
    high?: (number | string)[];
    low?: (number | string)[];
    vol?: (number | string)[];
    amount?: (number | string)[];
    realOpen?: (number | string)[];
    realClose?: (number | string)[];
    realHigh?: (number | string)[];
    realLow?: (number | string)[];
  };
}

export interface MexcContractDirectoryItem {
  rawSymbol: string;
  displaySymbol: string;
  baseAsset: string;
  quoteAsset: string;
  contractType: string;
  state: number | string;
  isTradable: boolean;
  displayNameEn?: string;
  conceptPlate?: string[];
  maxLeverage?: number;
  // Aliases for compatibility
  symbol: string;
  displayName: string;
  isSupported: boolean;
}

export interface SupportedSymbolInfo {
  symbol: string;
  displayName: string;
  baseCoin: string;
  quoteCoin: string;
  isSupported: boolean;
  contractStatus?: string;
  note?: string;
  rawSymbol?: string;
  displaySymbol?: string;
  baseAsset?: string;
  quoteAsset?: string;
  contractType?: string;
  state?: number | string;
  isTradable?: boolean;
}

export class MexcPublicMarketClient {
  private readonly baseUrl: string;
  private cachedDirectory: MexcContractDirectoryItem[] | null = null;
  private lastDirectoryFetchTime: number = 0;
  private readonly DIRECTORY_CACHE_TTL_MS = 45 * 60 * 1000; // 45 minutes cache (per spec 30-60m)

  constructor(baseUrl: string = 'https://contract.mexc.com') {
    this.baseUrl = baseUrl;
  }

  /**
   * Fetch historical 5-minute candles from MEXC public contract endpoint.
   * Endpoint: GET /api/v1/contract/kline/{symbol}?interval=Min5
   * 
   * @param symbol Raw MEXC contract symbol, e.g. 'BTC_USDT'
   * @param interval Contract interval, defaults to 'Min5'
   * @param limit Maximum number of recent candles to retrieve (default ~400)
   */
  public async fetchKlines(
    symbol: string,
    interval: string = 'Min5',
    limit: number = 400
  ): Promise<NormalizedMarketCandle[]> {
    const cleanSymbol = symbol.trim().toUpperCase();
    const url = `${this.baseUrl}/api/v1/contract/kline/${encodeURIComponent(cleanSymbol)}?interval=${encodeURIComponent(interval)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'TradeMate-Public-MarketData/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`MEXC public K-line request failed: HTTP ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as MexcContractKlineResponse;

    if (!payload.success || !payload.data || !Array.isArray(payload.data.time)) {
      // If symbol is not supported or returned no data
      if (payload.code !== 0 && payload.message) {
        throw new Error(`MEXC public K-line error (${payload.code}): ${payload.message}`);
      }
      return [];
    }

    const raw = payload.data;
    const count = raw.time.length;
    const candlesMap = new Map<number, NormalizedMarketCandle>();
    const nowMs = Date.now();
    const candleDurationMs = 5 * 60 * 1000; // 5 minutes in milliseconds

    for (let i = 0; i < count; i++) {
      const rawTime = raw.time[i];
      if (typeof rawTime !== 'number' || isNaN(rawTime)) continue;

      const candle = this.normalizeCandleData(
        rawTime,
        raw.open?.[i] ?? 0,
        raw.high?.[i] ?? 0,
        raw.low?.[i] ?? 0,
        raw.close?.[i] ?? 0,
        raw.vol?.[i] ?? 0,
        raw.amount?.[i] ?? 0,
        cleanSymbol,
        '5M',
        nowMs
      );

      // Idempotent deduplication by openTimeUnix
      candlesMap.set(candle.openTimeUnix, candle);
    }

    // Sort chronologically ascending
    const sortedCandles = Array.from(candlesMap.values()).sort(
      (a, b) => a.openTimeUnix - b.openTimeUnix
    );

    // If more candles than requested limit, retain the most recent ones
    if (limit > 0 && sortedCandles.length > limit) {
      return sortedCandles.slice(sortedCandles.length - limit);
    }

    return sortedCandles;
  }

  /**
   * Deterministically normalizes raw candle fields into NormalizedMarketCandle.
   */
  public normalizeCandleData(
    rawTime: number,
    rawOpen: number | string,
    rawHigh: number | string,
    rawLow: number | string,
    rawClose: number | string,
    rawVol: number | string,
    rawAmount: number | string,
    symbol: string,
    timeframe: string = '5M',
    nowMs: number = Date.now()
  ): NormalizedMarketCandle {
    const openTimeUnix = rawTime > 1e11 ? rawTime : rawTime * 1000;
    const openTime = new Date(openTimeUnix).toISOString();
    const candleDurationMs = 5 * 60 * 1000;
    const isClosed = nowMs >= openTimeUnix + candleDurationMs;

    return {
      id: `candle_${symbol.trim().toUpperCase()}_${openTimeUnix}`,
      symbol: symbol.trim().toUpperCase(),
      timeframe: '5M',
      openTime,
      openTimeUnix,
      open: Number(rawOpen),
      high: Number(rawHigh),
      low: Number(rawLow),
      close: Number(rawClose),
      volume: Number(rawVol),
      amount: Number(rawAmount),
      isClosed,
      source: 'MEXC_PUBLIC',
    };
  }

  /**
   * Loads the complete currently available MEXC Futures/Contract symbol list
   * from MEXC's public contract metadata API.
   * Caches metadata for 45 minutes to prevent redundant requests.
   * Can be force-refreshed on demand.
   */
  public async getContractDirectory(forceRefresh: boolean = false): Promise<MexcContractDirectoryItem[]> {
    const now = Date.now();
    if (!forceRefresh && this.cachedDirectory && (now - this.lastDirectoryFetchTime < this.DIRECTORY_CACHE_TTL_MS)) {
      return this.cachedDirectory;
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/v1/contract/detail`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'TradeMate-Public-MarketData/1.0',
        },
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data) && json.data.length > 0) {
          const directory: MexcContractDirectoryItem[] = json.data.map((item: any) => {
            const rawSymbol = String(item.symbol || '').trim();
            const baseAsset = String(item.baseCoin || rawSymbol.split('_')[0] || '').trim().toUpperCase();
            const quoteAsset = String(item.quoteCoin || rawSymbol.split('_')[1] || 'USDT').trim().toUpperCase();

            let displaySymbol = item.displayNameEn || item.displayName || `${baseAsset}/${quoteAsset} Perp`;
            if (displaySymbol.endsWith('永续')) {
              displaySymbol = displaySymbol.replace(/永续$/, ' Perp');
            } else if (displaySymbol.endsWith('PERPETUAL')) {
              displaySymbol = displaySymbol.replace(/\s*PERPETUAL/i, ' Perp');
            }

            const state = item.state ?? 0;
            // state === 0 is active, isHidden === false, apiAllowed !== false
            const isTradable = state === 0 && !item.isHidden && item.apiAllowed !== false;

            return {
              rawSymbol,
              displaySymbol,
              baseAsset,
              quoteAsset,
              contractType: item.futureType === 1 ? 'PERPETUAL' : 'FUTURES',
              state,
              isTradable,
              displayNameEn: item.displayNameEn,
              conceptPlate: Array.isArray(item.conceptPlate) ? item.conceptPlate : [],
              maxLeverage: typeof item.maxLeverage === 'number' ? item.maxLeverage : undefined,
              symbol: rawSymbol,
              displayName: displaySymbol,
              isSupported: isTradable,
            };
          });

          this.cachedDirectory = directory;
          this.lastDirectoryFetchTime = now;
          return directory;
        }
      }
    } catch (err) {
      console.warn('[MexcPublicMarketClient] Failed to fetch contract directory from MEXC:', (err as Error).message);
    }

    if (this.cachedDirectory) {
      return this.cachedDirectory;
    }

    return this.getFallbackDirectory();
  }

  /**
   * Fallback contract list if public MEXC contract metadata API is unreachable.
   */
  public getFallbackDirectory(): MexcContractDirectoryItem[] {
    const list = [
      { rawSymbol: 'BTC_USDT', displaySymbol: 'BTC/USDT Perp', baseAsset: 'BTC', quoteAsset: 'USDT', contractType: 'PERPETUAL', state: 0, isTradable: true, displayNameEn: 'BTC_USDT PERPETUAL' },
      { rawSymbol: 'ETH_USDT', displaySymbol: 'ETH/USDT Perp', baseAsset: 'ETH', quoteAsset: 'USDT', contractType: 'PERPETUAL', state: 0, isTradable: true, displayNameEn: 'ETH_USDT PERPETUAL' },
      { rawSymbol: 'SOL_USDT', displaySymbol: 'SOL/USDT Perp', baseAsset: 'SOL', quoteAsset: 'USDT', contractType: 'PERPETUAL', state: 0, isTradable: true, displayNameEn: 'SOL_USDT PERPETUAL' },
      { rawSymbol: 'XAU_USDT', displaySymbol: 'GOLD(XAU)/USDT Perp', baseAsset: 'XAU', quoteAsset: 'USDT', contractType: 'PERPETUAL', state: 0, isTradable: true, displayNameEn: 'GOLD(XAU)_USDT PERPETUAL' },
      { rawSymbol: 'SILVER_USDT', displaySymbol: 'SILVER(XAG)/USDT Perp', baseAsset: 'SILVER', quoteAsset: 'USDT', contractType: 'PERPETUAL', state: 0, isTradable: true, displayNameEn: 'SILVER(XAG)_USDT PERPETUAL' },
      { rawSymbol: 'COPPER_USDT', displaySymbol: 'COPPER/USDT Perp', baseAsset: 'COPPER', quoteAsset: 'USDT', contractType: 'PERPETUAL', state: 0, isTradable: true, displayNameEn: 'COPPER_USDT PERPETUAL' },
      { rawSymbol: 'BNB_USDT', displaySymbol: 'BNB/USDT Perp', baseAsset: 'BNB', quoteAsset: 'USDT', contractType: 'PERPETUAL', state: 0, isTradable: true, displayNameEn: 'BNB_USDT PERPETUAL' },
      { rawSymbol: 'XRP_USDT', displaySymbol: 'XRP/USDT Perp', baseAsset: 'XRP', quoteAsset: 'USDT', contractType: 'PERPETUAL', state: 0, isTradable: true, displayNameEn: 'XRP_USDT PERPETUAL' },
      { rawSymbol: 'DOGE_USDT', displaySymbol: 'DOGE/USDT Perp', baseAsset: 'DOGE', quoteAsset: 'USDT', contractType: 'PERPETUAL', state: 0, isTradable: true, displayNameEn: 'DOGE_USDT PERPETUAL' },
      { rawSymbol: 'XAG_USDT', displaySymbol: 'XAG/USDT (Unavailable)', baseAsset: 'XAG', quoteAsset: 'USDT', contractType: 'PERPETUAL', state: 1, isTradable: false, displayNameEn: 'XAG_USDT PERPETUAL' },
    ];

    return list.map((item) => ({
      ...item,
      symbol: item.rawSymbol,
      displayName: item.displaySymbol,
      isSupported: item.isTradable,
    }));
  }

  /**
   * Get metadata verification for Setup Lab symbols.
   * Returns complete contract directory.
   */
  public async getAvailableSymbols(forceRefresh: boolean = false): Promise<SupportedSymbolInfo[]> {
    const dir = await this.getContractDirectory(forceRefresh);
    return dir.map((d) => ({
      symbol: d.rawSymbol,
      displayName: d.displaySymbol,
      baseCoin: d.baseAsset,
      quoteCoin: d.quoteAsset,
      isSupported: d.isTradable,
      rawSymbol: d.rawSymbol,
      displaySymbol: d.displaySymbol,
      baseAsset: d.baseAsset,
      quoteAsset: d.quoteAsset,
      contractType: d.contractType,
      state: d.state,
      isTradable: d.isTradable,
      note: d.rawSymbol === 'XAG_USDT' ? 'MEXC contract uses SILVER_USDT instead of XAG_USDT' : undefined,
    }));
  }
}

export const mexcPublicMarketClient = new MexcPublicMarketClient();
