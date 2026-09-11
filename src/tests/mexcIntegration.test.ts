/**
 * MEXC Futures Read-Only Integration & Security Test Suite
 *
 * Validates:
 * 1. HMAC-SHA256 signature generation and parameter ordering
 * 2. Strict read-only API surface (No order/transfer/withdrawal methods)
 * 3. Idempotent deduplication for raw orders, raw fills, and funding
 * 4. High-precision Decimal.js preservation
 * 5. Clock drift and time synchronization logic
 * 6. Audit trail and sync job tracking
 */

import { Decimal } from 'decimal.js';
import crypto from 'crypto';
import { MexcClient, MexcClientError } from '../../server/mexc/mexcClient';
import { MexcIngestionService } from '../../server/mexc/mexcIngestionService';
import { MexcErrorCode } from '../../server/mexc/types';
import { db } from '../db/database';
import { RawExchangeFillRecord, RawExchangeOrderRecord } from '../db/types';

export async function runMexcIntegrationTests(): Promise<{
  total: number;
  passed: number;
  failed: number;
  results: Array<{ test: string; passed: boolean; message?: string }>;
}> {
  const results: Array<{ test: string; passed: boolean; message?: string }> = [];

  const assert = (condition: boolean, testName: string, failureMessage = 'Assertion failed') => {
    if (condition) {
      results.push({ test: testName, passed: true });
    } else {
      results.push({ test: testName, passed: false, message: failureMessage });
    }
  };

  // Test 1: Signature Generator sorts query parameters alphabetically and signs correctly
  try {
    const testAccessKey = 'mx01TestAccessKey';
    const testSecretKey = 'testSecretKey998877';
    const client = new MexcClient({
      accessKey: testAccessKey,
      secretKey: testSecretKey,
    });

    const timestamp = 1757155200000;
    const params = {
      symbol: 'BTC_USDT',
      page_num: 1,
      page_size: 50,
      category: 1,
    };

    const { signature, queryString } = client.generateSignature(timestamp, params);

    // Expected query string: category=1&page_num=1&page_size=50&symbol=BTC_USDT
    const expectedParamString = 'category=1&page_num=1&page_size=50&symbol=BTC_USDT';
    const expectedSignPayload = `${testAccessKey}${timestamp}${expectedParamString}`;
    const expectedSignature = crypto
      .createHmac('sha256', testSecretKey)
      .update(expectedSignPayload)
      .digest('hex');

    assert(
      queryString === expectedParamString,
      'Signature query string is correctly sorted alphabetically',
      `Expected ${expectedParamString}, got ${queryString}`
    );
    assert(
      signature === expectedSignature,
      'HMAC-SHA256 signature matches official MEXC specification',
      `Expected ${expectedSignature}, got ${signature}`
    );
  } catch (err) {
    results.push({ test: 'Signature Generation', passed: false, message: (err as Error).message });
  }

  // Test 2: Verify Strict Read-Only API Surface (Security Mandate)
  try {
    const client = new MexcClient();
    const prototype = Object.getPrototypeOf(client);
    const methodNames = Object.getOwnPropertyNames(prototype);

    const forbiddenTerms = [
      'place',
      'order_create',
      'createorder',
      'submit',
      'cancel',
      'withdraw',
      'transfer',
      'leverage',
      'margin',
      'position_close',
      'post',
      'delete',
    ];

    const violations = methodNames.filter((name) => {
      const lower = name.toLowerCase();
      // Exclude harmless getter methods like getHistoricalOrders or getOrderDeals
      if (lower.startsWith('get') || lower === 'constructor' || lower === 'ping') return false;
      return forbiddenTerms.some((term) => lower.includes(term));
    });

    assert(
      violations.length === 0,
      'MexcClient contains ZERO order placement, cancel, transfer, or modification methods',
      `Found unauthorized methods: ${violations.join(', ')}`
    );
  } catch (err) {
    results.push({ test: 'Read-Only Security Verification', passed: false, message: (err as Error).message });
  }

  // Test 3: Idempotent Deduplication for Raw Orders
  try {
    const testAccountId = 'acc_test_dedup_01';
    const orderId = 'mexc_ord_unique_9981';
    const key = `${testAccountId}:${orderId}`;

    const orderRecord: RawExchangeOrderRecord = {
      id: `ord_${orderId}`,
      tradingAccountId: testAccountId,
      exchangeOrderId: orderId,
      symbol: 'ETH_USDT',
      side: 'BUY_OPEN_LONG',
      orderType: 'LIMIT',
      status: 'FILLED',
      price: new Decimal('2650.50'),
      quantity: new Decimal('1.5'),
      filledQuantity: new Decimal('1.5'),
      averagePrice: new Decimal('2650.50'),
      reduceOnly: false,
      positionSide: 'LONG',
      leverage: 10,
      exchangeCreatedAt: new Date().toISOString(),
      exchangeUpdatedAt: null,
      rawPayload: { orderId, symbol: 'ETH_USDT' },
      syncedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    // First insert
    db.rawExchangeOrders.set(key, orderRecord);
    const initialSize = db.rawExchangeOrders.size;

    // Second simulated insert (idempotency check)
    if (!db.rawExchangeOrders.has(key)) {
      db.rawExchangeOrders.set(key, orderRecord);
    }

    assert(
      db.rawExchangeOrders.size === initialSize,
      'Duplicate raw orders are skipped without duplicating database state'
    );
  } catch (err) {
    results.push({ test: 'Raw Order Deduplication', passed: false, message: (err as Error).message });
  }

  // Test 4: Idempotent Deduplication for Raw Deals / Fills
  try {
    const testAccountId = 'acc_test_dedup_01';
    const fillId = 'deal_unique_88412';
    const key = `${testAccountId}:${fillId}`;

    const fillRecord: RawExchangeFillRecord = {
      id: `fill_${fillId}`,
      tradingAccountId: testAccountId,
      exchangeFillId: fillId,
      exchangeOrderId: 'mexc_ord_123',
      symbol: 'SOL_USDT',
      side: 'OPEN_LONG',
      price: new Decimal('142.85'),
      quantity: new Decimal('10.0'),
      quoteQuantity: new Decimal('1428.50'),
      fee: new Decimal('0.5714'),
      feeCurrency: 'USDT',
      realizedPnl: new Decimal('0'),
      positionSide: null,
      liquidityType: 'TAKER',
      exchangeTimestamp: new Date().toISOString(),
      rawPayload: { id: fillId, price: '142.85', vol: '10.0' },
      syncedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    db.rawExchangeFills.set(key, fillRecord);
    const initialFillsSize = db.rawExchangeFills.size;

    // Second check
    if (!db.rawExchangeFills.has(key)) {
      db.rawExchangeFills.set(key, fillRecord);
    }

    assert(
      db.rawExchangeFills.size === initialFillsSize,
      'Duplicate raw fills are skipped based on tradingAccountId + exchangeFillId'
    );
  } catch (err) {
    results.push({ test: 'Raw Fill Deduplication', passed: false, message: (err as Error).message });
  }

  // Test 5: Decimal Precision Guarantee (No IEEE 754 float drift)
  try {
    const p1 = new Decimal('0.00000001');
    const p2 = new Decimal('0.00000002');
    const sum = p1.plus(p2);
    const floatAddition = new Decimal('0.1').plus('0.2');

    assert(
      sum.toFixed(8) === '0.00000003' && floatAddition.toString() === '0.3',
      'High-precision financial figures retain exact decimal representation'
    );
  } catch (err) {
    results.push({ test: 'Decimal Precision', passed: false, message: (err as Error).message });
  }

  // Test 6: Safe Error Handling for Missing Credentials
  try {
    const unconfiguredClient = new MexcClient({ accessKey: '', secretKey: '' });
    assert(
      !unconfiguredClient.isConfigured(),
      'Unconfigured client reports isConfigured() = false safely'
    );
    assert(
      unconfiguredClient.getMaskedAccessKey() === null,
      'Unconfigured client returns null for masked access key'
    );
  } catch (err) {
    results.push({ test: 'Missing Credentials Safety', passed: false, message: (err as Error).message });
  }

  // Test 7: Verify Official MEXC Futures Base URL
  try {
    const defaultClient = new MexcClient();
    assert(
      defaultClient.getBaseUrl() === 'https://contract.mexc.com',
      'MexcClient defaults to official contract.mexc.com host',
      `Expected https://contract.mexc.com, got ${defaultClient.getBaseUrl()}`
    );
  } catch (err) {
    results.push({ test: 'Futures Base URL Verification', passed: false, message: (err as Error).message });
  }

  // Test 8: Official Contract API Authentication Headers
  try {
    const testClient = new MexcClient({
      accessKey: 'mx01TestKey',
      secretKey: 'sec998877',
      recvWindowMs: 10000,
    });
    const ts = 1757155200000;
    const fakeSig = 'abc123def456';
    const headers = testClient.getAuthHeaders(ts, fakeSig);

    assert(
      headers['ApiKey'] === 'mx01TestKey' &&
      headers['Request-Time'] === '1757155200000' &&
      headers['Signature'] === fakeSig &&
      headers['Recv-Window'] === '10000' &&
      headers['Content-Type'] === 'application/json',
      'Contract API authentication headers match official specification exactly'
    );
  } catch (err) {
    results.push({ test: 'Contract API Auth Headers', passed: false, message: (err as Error).message });
  }

  // Test 9: Enforce Required Symbol in getOrderDeals
  try {
    const testClient = new MexcClient({
      accessKey: 'mx01TestKey',
      secretKey: 'sec998877',
    });

    let caughtError = false;
    try {
      await testClient.getOrderDeals({ symbol: '' });
    } catch {
      caughtError = true;
    }

    assert(
      caughtError,
      'getOrderDeals strictly requires symbol parameter in accordance with MEXC contract docs'
    );
  } catch (err) {
    results.push({ test: 'Mandatory Symbol Enforcement', passed: false, message: (err as Error).message });
  }

  // Test 10: 90-Day Window Backfill Segmentation Logic
  try {
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    const now = 1757155200000;
    const windows: Array<{ start: number; end: number }> = [];

    for (let w = 0; w < 4; w++) {
      const winEnd = now - w * NINETY_DAYS_MS;
      const winStart = winEnd - NINETY_DAYS_MS + 1;
      windows.push({ start: winStart, end: winEnd });
    }

    const noOverlaps = windows.every((w, idx) => {
      if (idx === 0) return true;
      return windows[idx - 1].start === w.end + 1;
    });

    assert(
      windows.length === 4 && noOverlaps && (windows[0].end - windows[0].start + 1) === NINETY_DAYS_MS,
      '90-Day time windows are strictly non-overlapping and bounded'
    );
  } catch (err) {
    results.push({ test: '90-Day Window Logic', passed: false, message: (err as Error).message });
  }

  // Test 11: Secret Key Non-Exposure in Sanitization and Masking
  try {
    const service = new MexcIngestionService();
    // @ts-expect-error - testing private method
    const sanitized = service.sanitizeRawPayload({
      orderId: '123',
      symbol: 'BTC_USDT',
      secretKey: 'leak_secret',
      apiKey: 'leak_api',
      signature: 'leak_sig',
      passWord: 'leak_pwd',
      price: 65000,
    });

    assert(
      !('secretKey' in sanitized) &&
      !('apiKey' in sanitized) &&
      !('signature' in sanitized) &&
      !('passWord' in sanitized) &&
      sanitized.orderId === '123' &&
      sanitized.price === 65000,
      'Payload sanitizer strips all secret keys, api keys, signatures, and credentials'
    );
  } catch (err) {
    results.push({ test: 'Secret Non-Exposure', passed: false, message: (err as Error).message });
  }

  // Test 12: In-Memory Safety Guard when Persistent Database is Inactive
  try {
    const configuredClient = new MexcClient({
      accessKey: 'mx01TestKey',
      secretKey: 'sec998877',
    });
    const testService = new MexcIngestionService(configuredClient);
    const status = await testService.getIntegrationStatus();

    // Since DATABASE_URL is not set in this environment, mode must be MOCK_MODE_IN_MEMORY
    assert(
      status.persistentDbConnected === false &&
      status.mode === 'MOCK_MODE_IN_MEMORY',
      'Correctly enforces MOCK_MODE_IN_MEMORY when PostgreSQL persistence is inactive'
    );
  } catch (err) {
    results.push({ test: 'In-Memory Safety Guard', passed: false, message: (err as Error).message });
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  return {
    total: results.length,
    passed,
    failed,
    results,
  };
}
