/**
 * Server-Side MEXC Futures Client (STRICT READ-ONLY)
 *
 * Implements official MEXC Futures API v1 authentication, HMAC-SHA256 signing,
 * clock-drift synchronization, exponential backoff retries, and strict read-only access.
 *
 * SECURITY DIRECTIVE:
 * - NO ORDER PLACEMENT
 * - NO ORDER CANCELLATIONS
 * - NO WITHDRAWALS / TRANSFERS
 * - NO MARGIN / LEVERAGE MODIFICATIONS
 * - SECRET KEYS NEVER EXPOSED OR LOGGED
 */

import crypto from 'crypto';
import {
  MexcApiResponse,
  MexcAssetRaw,
  MexcErrorCode,
  MexcFundingRecordRaw,
  MexcHistoryOrderRaw,
  MexcOrderDealRaw,
  MexcPositionRaw,
} from './types';

export class MexcClientError extends Error {
  public code: MexcErrorCode;
  public status?: number;
  public rawMessage?: string;

  constructor(code: MexcErrorCode, message: string, status?: number, rawMessage?: string) {
    super(`[MEXC_CLIENT_${code}]: ${message}`);
    this.name = 'MexcClientError';
    this.code = code;
    this.status = status;
    this.rawMessage = rawMessage;
  }
}

export interface MexcClientConfig {
  accessKey?: string;
  secretKey?: string;
  baseUrl?: string;
  recvWindowMs?: number;
  maxRetries?: number;
  enableTimeSync?: boolean;
}

export class MexcClient {
  private accessKey: string;
  private secretKey: string;
  private baseUrl: string;
  private recvWindowMs: number;
  private maxRetries: number;
  private serverTimeOffsetMs: number = 0;
  private lastTimeSyncAt: number = 0;

  constructor(config?: MexcClientConfig) {
    this.accessKey = config?.accessKey || process.env.MEXC_ACCESS_KEY || '';
    this.secretKey = config?.secretKey || process.env.MEXC_SECRET_KEY || '';
    this.baseUrl = (config?.baseUrl || process.env.MEXC_BASE_URL || 'https://contract.mexc.com').replace(/\/$/, '');
    this.recvWindowMs = config?.recvWindowMs || 10000;
    this.maxRetries = config?.maxRetries ?? 3;
  }

  /**
   * Return current base URL
   */
  public getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Return standardized Contract API authenticated headers
   */
  public getAuthHeaders(timestamp: number, signature: string): Record<string, string> {
    return {
      'ApiKey': this.accessKey,
      'Request-Time': String(timestamp),
      'Signature': signature,
      'Recv-Window': String(this.recvWindowMs),
      'Content-Type': 'application/json',
      'User-Agent': 'TradeMate-Analytics/1.0',
    };
  }

  /**
   * Check if credentials are present without exposing them
   */
  public isConfigured(): boolean {
    return Boolean(this.accessKey.trim() && this.secretKey.trim());
  }

  /**
   * Return safely masked access key for verification (e.g. "mx01...8f2a")
   */
  public getMaskedAccessKey(): string | null {
    if (!this.accessKey.trim()) return null;
    const clean = this.accessKey.trim();
    if (clean.length <= 8) return '****';
    return `${clean.slice(0, 4)}...${clean.slice(-4)}`;
  }

  /**
   * Centralized HMAC-SHA256 Signature Generator for MEXC Futures API
   *
   * Official Specification for GET requests:
   * 1. Sort business parameters in ascending dictionary order (key1=val1&key2=val2).
   * 2. signString = accessKey + timestamp + parameterString
   * 3. signature = HMAC_SHA256_HEX(signString, secretKey)
   */
  public generateSignature(timestamp: number, params: Record<string, string | number | boolean | undefined> = {}): {
    signature: string;
    queryString: string;
  } {
    if (!this.secretKey) {
      throw new MexcClientError(
        MexcErrorCode.NOT_CONFIGURED,
        'MEXC_SECRET_KEY is not configured on the server.'
      );
    }

    // Filter out null / undefined values
    const entries = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [k, String(v)] as [string, string]);

    // Sort parameters in dictionary (alphabetical) order
    entries.sort(([a], [b]) => a.localeCompare(b));

    // Construct URL parameter string
    const parameterString = entries
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    // Sign payload: accessKey + timestamp + parameterString
    const signPayload = `${this.accessKey}${timestamp}${parameterString}`;

    const signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(signPayload)
      .digest('hex');

    return { signature, queryString: parameterString };
  }

  /**
   * Synchronize local clock with MEXC server time to avoid clock drift
   * Uses official MEXC Contract ping endpoint: GET /api/v1/contract/ping
   */
  public async syncServerTime(): Promise<number> {
    const url = `${this.baseUrl}/api/v1/contract/ping`;
    try {
      const startTime = Date.now();
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const body = (await response.json()) as Record<string, unknown>;
      const serverTime =
        (typeof body.data === 'number'
          ? body.data
          : typeof body.serverTime === 'number'
          ? body.serverTime
          : Date.now());
      const endTime = Date.now();
      const roundTrip = (endTime - startTime) / 2;

      // Adjust offset taking half of network round-trip into account
      this.serverTimeOffsetMs = serverTime - (startTime + roundTrip);
      this.lastTimeSyncAt = Date.now();

      return serverTime;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      // Contract ping failed - log safely without secrets
      console.warn(`[MEXC] Server time contract ping warning: ${errorMsg}. Using local time with zero offset.`);
      return Date.now();
    }
  }

  /**
   * Get adjusted UTC timestamp
   */
  public getSynchronizedTimestamp(): number {
    return Date.now() + this.serverTimeOffsetMs;
  }

  /**
   * Internal Authenticated GET Request Engine with Exponential Backoff Retries
   */
  private async executeAuthenticatedGet<T>(
    endpoint: string,
    params: Record<string, string | number | boolean | undefined> = {}
  ): Promise<T> {
    if (!this.isConfigured()) {
      throw new MexcClientError(
        MexcErrorCode.NOT_CONFIGURED,
        'MEXC API credentials are not configured. Set MEXC_ACCESS_KEY and MEXC_SECRET_KEY in server environment.'
      );
    }

    // Periodically re-sync server clock every 30 minutes
    if (Date.now() - this.lastTimeSyncAt > 30 * 60 * 1000) {
      await this.syncServerTime();
    }

    let attempt = 0;
    let delayMs = 500;

    while (attempt <= this.maxRetries) {
      attempt++;
      const timestamp = this.getSynchronizedTimestamp();
      const { signature, queryString } = this.generateSignature(timestamp, params);

      const fullUrl = queryString
        ? `${this.baseUrl}${endpoint}?${queryString}`
        : `${this.baseUrl}${endpoint}`;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s request timeout

        const response = await fetch(fullUrl, {
          method: 'GET',
          headers: this.getAuthHeaders(timestamp, signature),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Handle HTTP Rate Limit
        if (response.status === 429) {
          if (attempt <= this.maxRetries) {
            console.warn(`[MEXC] Rate limit 429 hit. Backing off ${delayMs}ms (attempt ${attempt}/${this.maxRetries})`);
            await new Promise((r) => setTimeout(r, delayMs));
            delayMs *= 2;
            continue;
          }
          throw new MexcClientError(
            MexcErrorCode.RATE_LIMITED,
            'MEXC Futures API rate limit reached. Backing off before next request.',
            429
          );
        }

        // Handle HTTP 401 / 403 Authentication Failures - DO NOT RETRY
        if (response.status === 401 || response.status === 403) {
          const errText = await response.text();
          throw new MexcClientError(
            MexcErrorCode.AUTHENTICATION_FAILED,
            `MEXC authentication rejected: ${response.statusText}`,
            response.status,
            errText
          );
        }

        // Handle 5xx Server Errors with backoff
        if (response.status >= 500) {
          if (attempt <= this.maxRetries) {
            console.warn(`[MEXC] Server 5xx (${response.status}). Retrying in ${delayMs}ms...`);
            await new Promise((r) => setTimeout(r, delayMs));
            delayMs *= 2;
            continue;
          }
          throw new MexcClientError(
            MexcErrorCode.MEXC_UNAVAILABLE,
            `MEXC Futures service returned HTTP ${response.status}.`,
            response.status
          );
        }

        if (!response.ok) {
          const errBody = await response.text();
          throw new MexcClientError(
            MexcErrorCode.INVALID_RESPONSE,
            `MEXC API returned HTTP ${response.status}: ${response.statusText}`,
            response.status,
            errBody
          );
        }

        const json = (await response.json()) as MexcApiResponse<T>;

        // Check internal MEXC response codes
        // Successful responses typically have code: 0 or code: 200, or success: true
        if (json.code !== undefined && json.code !== 0 && json.code !== 200) {
          const message = json.message || 'Unknown MEXC API error';

          // Detect signature / timestamp specific codes
          if (message.includes('timestamp') || message.includes('Request-Time') || json.code === 700003) {
            // Re-sync clock skew and retry once if not already retried
            if (attempt === 1) {
              await this.syncServerTime();
              continue;
            }
            throw new MexcClientError(
              MexcErrorCode.CLOCK_SKEW,
              `MEXC timestamp synchronization error: ${message}`,
              response.status,
              message
            );
          }

          if (message.includes('signature') || json.code === 700004) {
            throw new MexcClientError(
              MexcErrorCode.INVALID_SIGNATURE,
              `Invalid signature calculation: ${message}`,
              response.status,
              message
            );
          }

          if (message.includes('api key') || message.includes('apikey') || json.code === 700001 || json.code === 700002) {
            throw new MexcClientError(
              MexcErrorCode.INVALID_API_KEY,
              `Invalid MEXC API key or permissions: ${message}`,
              response.status,
              message
            );
          }

          throw new MexcClientError(
            MexcErrorCode.INVALID_RESPONSE,
            `MEXC business code ${json.code}: ${message}`,
            response.status,
            message
          );
        }

        return json.data !== undefined ? json.data : (json as unknown as T);
      } catch (err: unknown) {
        if (err instanceof MexcClientError) {
          throw err;
        }

        const error = err as Error;
        const isAbortOrTimeout = error.name === 'AbortError' || error.message.includes('timeout');
        const isNetworkErr = error.message.includes('fetch failed') || error.message.includes('ECONNRESET');

        if ((isAbortOrTimeout || isNetworkErr) && attempt <= this.maxRetries) {
          console.warn(`[MEXC] Network ${error.message}. Retrying in ${delayMs}ms (attempt ${attempt}/${this.maxRetries})`);
          await new Promise((r) => setTimeout(r, delayMs));
          delayMs *= 2;
          continue;
        }

        throw new MexcClientError(
          MexcErrorCode.NETWORK_ERROR,
          `Network communication failed: ${error.message}`
        );
      }
    }

    throw new MexcClientError(
      MexcErrorCode.NETWORK_ERROR,
      'Max retry attempts reached without response from MEXC.'
    );
  }

  // =========================================================================
  // STRICT READ-ONLY PUBLIC METHODS (NO WRITE/ORDER PLACEMENT METHODS EXIST)
  // =========================================================================

  /**
   * Ping MEXC server time (Public, harmless)
   */
  public async ping(): Promise<{ serverTime: number }> {
    const serverTime = await this.syncServerTime();
    return { serverTime };
  }

  /**
   * Fetch Futures Account Balances / Assets
   * Endpoint: GET /api/v1/private/account/assets
   */
  public async getAccountAssets(): Promise<MexcAssetRaw[]> {
    const result = await this.executeAuthenticatedGet<MexcAssetRaw[] | { result: MexcAssetRaw[] }>(
      '/api/v1/private/account/assets'
    );
    if (Array.isArray(result)) return result;
    if (result && Array.isArray((result as { result: MexcAssetRaw[] }).result)) {
      return (result as { result: MexcAssetRaw[] }).result;
    }
    return [];
  }

  /**
   * Fetch Futures Order History with pagination
   * Endpoint: GET /api/v1/private/order/list/history_orders
   */
  public async getHistoricalOrders(options: {
    pageNum?: number;
    pageSize?: number;
    symbol?: string;
    startTime?: number;
    endTime?: number;
    category?: number;
  } = {}): Promise<MexcHistoryOrderRaw[]> {
    const params: Record<string, string | number | undefined> = {
      page_num: options.pageNum || 1,
      page_size: Math.min(options.pageSize || 50, 100),
      symbol: options.symbol,
      start_time: options.startTime,
      end_time: options.endTime,
      category: options.category,
    };

    const result = await this.executeAuthenticatedGet<
      MexcHistoryOrderRaw[] | { resultList?: MexcHistoryOrderRaw[]; list?: MexcHistoryOrderRaw[] }
    >('/api/v1/private/order/list/history_orders', params);

    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.resultList)) return result.resultList;
    if (result && Array.isArray(result.list)) return result.list;
    return [];
  }

  /**
   * Fetch Futures Execution / Deals / Fills History
   * Endpoint: GET /api/v1/private/order/list/order_deals
   *
   * Note: According to MEXC Contract API specification, the `symbol` parameter is MANDATORY.
   */
  public async getOrderDeals(options: {
    symbol: string;
    pageNum?: number;
    pageSize?: number;
    startTime?: number;
    endTime?: number;
  }): Promise<MexcOrderDealRaw[]> {
    if (!options.symbol || !options.symbol.trim()) {
      throw new MexcClientError(
        MexcErrorCode.INVALID_RESPONSE,
        'MEXC Futures API endpoint /api/v1/private/order/list/order_deals requires a valid contract symbol (e.g. BTC_USDT).'
      );
    }

    const params: Record<string, string | number | undefined> = {
      symbol: options.symbol.trim(),
      page_num: options.pageNum || 1,
      page_size: Math.min(options.pageSize || 50, 100),
      start_time: options.startTime,
      end_time: options.endTime,
    };

    const result = await this.executeAuthenticatedGet<
      MexcOrderDealRaw[] | { resultList?: MexcOrderDealRaw[]; list?: MexcOrderDealRaw[] }
    >('/api/v1/private/order/list/order_deals', params);

    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.resultList)) return result.resultList;
    if (result && Array.isArray(result.list)) return result.list;
    return [];
  }

  /**
   * Fetch Deals for a specific Order ID
   * Endpoint: GET /api/v1/private/order/deal_details/{order_id}
   */
  public async getOrderDealDetails(orderId: string): Promise<MexcOrderDealRaw[]> {
    const result = await this.executeAuthenticatedGet<MexcOrderDealRaw[]>(
      `/api/v1/private/order/deal_details/${encodeURIComponent(orderId)}`
    );
    return Array.isArray(result) ? result : [];
  }

  /**
   * Fetch Funding Settlement History
   * Endpoint: GET /api/v1/private/position/funding_records
   */
  public async getFundingRecords(options: {
    pageNum?: number;
    pageSize?: number;
    symbol?: string;
    positionType?: number;
  } = {}): Promise<MexcFundingRecordRaw[]> {
    const params: Record<string, string | number | undefined> = {
      page_num: options.pageNum || 1,
      page_size: Math.min(options.pageSize || 50, 100),
      symbol: options.symbol,
      position_type: options.positionType,
    };

    try {
      const result = await this.executeAuthenticatedGet<
        MexcFundingRecordRaw[] | { resultList?: MexcFundingRecordRaw[]; list?: MexcFundingRecordRaw[] }
      >('/api/v1/private/position/funding_records', params);

      if (Array.isArray(result)) return result;
      if (result && Array.isArray(result.resultList)) return result.resultList;
      if (result && Array.isArray(result.list)) return result.list;
      return [];
    } catch (err: unknown) {
      // Documented limitation: if funding records endpoint is unavailable or returns 404 on current API version
      console.warn('[MEXC] Funding records query notice:', (err as Error).message);
      return [];
    }
  }

  /**
   * Fetch Open Positions (Harmless query for validation / margin tracking)
   * Endpoint: GET /api/v1/private/position/open_positions
   */
  public async getOpenPositions(symbol?: string): Promise<MexcPositionRaw[]> {
    const params = symbol ? { symbol } : {};
    const result = await this.executeAuthenticatedGet<MexcPositionRaw[] | { list?: MexcPositionRaw[] }>(
      '/api/v1/private/position/open_positions',
      params
    );
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.list)) return result.list;
    return [];
  }
}
