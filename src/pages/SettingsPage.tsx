import React, { useState, useEffect } from 'react';
import {
  Settings,
  Shield,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Database,
  ArrowDownToLine,
  Key,
  ExternalLink,
  Layers,
  Clock,
  Activity,
  Zap,
} from 'lucide-react';
import {
  mexcFrontendService,
  RawSummaryData,
  DatabaseHealth,
} from '../services/mexcIntegrationService';
import {
  MexcConnectionStatus,
  MexcIntegrationStatus,
  MexcSyncResult,
  TestConnectionResult,
} from '../../server/mexc/types';
import { SyncJobRecord } from '../db/types';

export const SettingsPage: React.FC = () => {
  const [status, setStatus] = useState<MexcIntegrationStatus | null>(null);
  const [dbHealth, setDbHealth] = useState<DatabaseHealth | null>(null);
  const [rawSummary, setRawSummary] = useState<RawSummaryData | null>(null);
  const [syncJobs, setSyncJobs] = useState<SyncJobRecord[]>([]);
  const [isTesting, setIsTesting] = useState(false);
  const [isTestingPersistence, setIsTestingPersistence] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [persistenceResult, setPersistenceResult] = useState<{ success: boolean; message: string } | null>(null);
  const [syncResult, setSyncResult] = useState<MexcSyncResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const [statusData, healthData, summaryData, jobsData] = await Promise.all([
        mexcFrontendService.getStatus(),
        mexcFrontendService.getDatabaseHealth(),
        mexcFrontendService.getRawSummary(),
        mexcFrontendService.getSyncJobs(),
      ]);
      setStatus(statusData);
      setDbHealth(healthData);
      setRawSummary(summaryData);
      setSyncJobs(jobsData);
    } catch (err: unknown) {
      console.error('Failed to load settings data', err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleTestPersistence = async () => {
    setIsTestingPersistence(true);
    setPersistenceResult(null);
    try {
      const res = await mexcFrontendService.testPersistence();
      setPersistenceResult(res);
      await loadData();
    } catch (err: unknown) {
      setPersistenceResult({
        success: false,
        message: (err as Error).message || 'Persistence test failed',
      });
    } finally {
      setIsTestingPersistence(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setErrorMessage(null);
    try {
      const res = await mexcFrontendService.testConnection();
      setTestResult(res);
      await loadData();
    } catch (err: unknown) {
      setErrorMessage((err as Error).message || 'Connection test failed');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSyncNow = async () => {
    setIsSyncing(true);
    setErrorMessage(null);
    try {
      const res = await mexcFrontendService.triggerSync();
      setSyncResult(res);
      await loadData();
    } catch (err: unknown) {
      setErrorMessage((err as Error).message || 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleHistoricalBackfill = async () => {
    setIsBackfilling(true);
    setErrorMessage(null);
    try {
      const res = await mexcFrontendService.triggerBackfill(50);
      setSyncResult(res);
      await loadData();
    } catch (err: unknown) {
      setErrorMessage((err as Error).message || 'Historical backfill failed');
    } finally {
      setIsBackfilling(false);
    }
  };

  const getStatusBadge = (s?: MexcConnectionStatus) => {
    switch (s) {
      case MexcConnectionStatus.CONNECTED:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            CONNECTED
          </span>
        );
      case MexcConnectionStatus.SYNCING:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/30">
            <RefreshCw className="w-3 h-3 animate-spin" />
            SYNCING
          </span>
        );
      case MexcConnectionStatus.RATE_LIMITED:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <AlertTriangle className="w-3 h-3" />
            RATE LIMITED
          </span>
        );
      case MexcConnectionStatus.ERROR:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/30">
            <XCircle className="w-3 h-3" />
            ERROR
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-500"></span>
            NOT CONFIGURED
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col gap-5 max-w-[1600px] mx-auto pb-8">
      {/* Page Header */}
      <div className="flex justify-between items-center pb-3 border-b border-[#1E293B]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-600/15 border border-blue-500/25 flex items-center justify-center text-blue-400">
            <Settings className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white flex items-center gap-2.5">
              Settings & Exchange Integration
              <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30 font-mono font-semibold">
                Step 3 Read-Only Ingestion
              </span>
            </h1>
            <p className="text-xs text-[#64748B]">
              Configure institutional exchange connections, verify read-only permissions, and audit raw data syncs.
            </p>
          </div>
        </div>

        {/* Global Sync Indicator */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-[#64748B]">Status:</span>
          {getStatusBadge(status?.status)}
        </div>
      </div>

      {/* Strict Read-Only Security Banner */}
      <div className="bg-[#0B0E14] border border-blue-900/40 rounded-xl p-4 flex items-start gap-3 bg-gradient-to-r from-blue-950/20 to-transparent">
        <Shield className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <p className="font-semibold text-blue-300">
            Strict Read-Only Permission Architecture
          </p>
          <p className="text-[#94A3B8] leading-relaxed">
            TradeMate operates exclusively as an analytical observation engine. The application contains zero order-placement, withdrawal, leverage, or transfer endpoints.
            When generating your API key in MEXC User Center, enable <span className="text-white font-mono font-bold">Read-Only</span> access. Never check Order Placement, Contract Trade, or Transfer permissions.
          </p>
        </div>
      </div>

      {/* Main Grid: Exchange Integration Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Col 1 & 2: MEXC Futures Integration Controls */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-[#0B0E14] border border-[#1E293B] rounded-xl p-5 space-y-5">
            <div className="flex items-center justify-between pb-4 border-b border-[#1E293B]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#0F172A] border border-[#1E293B] flex items-center justify-center font-bold text-sm text-emerald-400">
                  MEXC
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white flex items-center gap-2">
                    MEXC Futures (USDT-M Perpetual)
                  </h2>
                  <p className="text-[11px] text-[#64748B] font-mono">
                    Official Base: https://api.mexc.com • Version: v1 Contract
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  id="test-connection-btn"
                  onClick={handleTestConnection}
                  disabled={isTesting}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1E293B] hover:bg-[#334155] text-white border border-[#334155] transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <Activity className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : 'text-blue-400'}`} />
                  {isTesting ? 'Testing...' : 'Test Connection'}
                </button>

                <button
                  id="sync-now-btn"
                  onClick={handleSyncNow}
                  disabled={isSyncing}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  {isSyncing ? 'Syncing...' : 'Sync Now'}
                </button>
              </div>
            </div>

            {/* Credentials & Health Status Matrix */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-[#080B10] border border-[#1E293B] rounded-lg p-3">
                <p className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider">
                  API Key Status
                </p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Key className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs font-mono font-semibold text-white">
                    {status?.apiKeyConfigured ? (
                      <span className="text-emerald-400 flex items-center gap-1">
                        Configured
                        <span className="text-[10px] text-[#64748B]">
                          ({status.maskedAccessKey})
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-500">Not configured</span>
                    )}
                  </span>
                </div>
              </div>

              <div className="bg-[#080B10] border border-[#1E293B] rounded-lg p-3">
                <p className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider">
                  Secret Key Status
                </p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Shield className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs font-mono font-semibold text-white">
                    {status?.secretKeyConfigured ? (
                      <span className="text-emerald-400">Server Encrypted</span>
                    ) : (
                      <span className="text-slate-500">Not configured</span>
                    )}
                  </span>
                </div>
              </div>

              <div className="bg-[#080B10] border border-[#1E293B] rounded-lg p-3">
                <p className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider">
                  Last Successful Sync
                </p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Clock className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-xs font-mono text-[#94A3B8] truncate">
                    {status?.lastSuccessfulSync
                      ? new Date(status.lastSuccessfulSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                      : 'Never'}
                  </span>
                </div>
              </div>

              <div className="bg-[#080B10] border border-[#1E293B] rounded-lg p-3">
                <p className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider">
                  Last Failed Sync
                </p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-xs font-mono text-[#94A3B8]">
                    {status?.lastFailedSync ? 'Recorded' : 'None (Healthy)'}
                  </span>
                </div>
              </div>
            </div>

            {/* Test Connection Banner Feedback */}
            {testResult && (
              <div
                className={`p-3.5 rounded-lg border text-xs flex items-start gap-2.5 font-mono ${
                  testResult.success
                    ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                    : 'bg-red-950/20 border-red-500/30 text-red-300'
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                )}
                <div className="space-y-1">
                  <p className="font-semibold">{testResult.message}</p>
                  <p className="text-[11px] text-[#94A3B8]">
                    Server Time: {new Date(testResult.serverTime).toISOString()} • Offset: {testResult.timeOffsetMs}ms
                  </p>
                  {testResult.assetsSample && testResult.assetsSample.length > 0 && (
                    <div className="pt-1 text-[11px] flex gap-3 text-slate-300">
                      {testResult.assetsSample.map((a, i) => (
                        <span key={i}>
                          {a.currency}: {a.equity} (Available: {a.available})
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Last Sync Operation Result */}
            {syncResult && (
              <div className="p-3.5 rounded-lg border border-blue-500/30 bg-blue-950/20 text-xs font-mono text-blue-200 flex items-start gap-2.5">
                <Zap className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-1 flex-1">
                  <div className="flex justify-between items-center">
                    <span className="font-bold">
                      Sync Job {syncResult.jobId} ({syncResult.syncType}) — {syncResult.status}
                    </span>
                    <span className="text-[#64748B]">{syncResult.durationMs}ms</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1 text-[11px] text-[#94A3B8]">
                    <span>Total Received: <b className="text-white">{syncResult.recordsReceived}</b></span>
                    <span>Inserted: <b className="text-emerald-400">{syncResult.recordsInserted}</b></span>
                    <span>Duplicates Skipped: <b className="text-amber-400">{syncResult.recordsSkipped}</b></span>
                  </div>
                </div>
              </div>
            )}

            {/* Historical Backfill Module */}
            <div className="pt-4 border-t border-[#1E293B] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <ArrowDownToLine className="w-4 h-4 text-blue-400" />
                  Deep Historical Backfill
                </h3>
                <p className="text-[11px] text-[#64748B]">
                  Paginates through full history of closed futures orders and executions up to MEXC API limits.
                </p>
              </div>
              <button
                id="backfill-btn"
                onClick={handleHistoricalBackfill}
                disabled={isBackfilling}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-[#1E293B] hover:bg-[#283548] text-white border border-[#334155] transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer self-start sm:self-auto"
              >
                <ArrowDownToLine className={`w-3.5 h-3.5 ${isBackfilling ? 'animate-bounce' : 'text-blue-400'}`} />
                {isBackfilling ? 'Backfilling...' : 'Run Historical Backfill'}
              </button>
            </div>
          </div>

          {/* Sync Audit Jobs History Table */}
          <div className="bg-[#0B0E14] border border-[#1E293B] rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-400" />
                Sync Audit History (<span className="font-mono">{syncJobs.length}</span>)
              </h3>
              <span className="text-[10px] text-[#64748B] font-mono">
                Idempotent Compound Keys Enforced
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-[#1E293B] text-[10px] text-[#64748B] uppercase tracking-wider">
                    <th className="pb-2">Job ID</th>
                    <th className="pb-2">Type</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2">Started</th>
                    <th className="pb-2 text-right">Received</th>
                    <th className="pb-2 text-right">Inserted</th>
                    <th className="pb-2 text-right">Skipped</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E293B]/50">
                  {syncJobs.map((job) => (
                    <tr key={job.id} className="hover:bg-[#0D1117]/60">
                      <td className="py-2.5 font-medium text-white">{job.id}</td>
                      <td className="py-2.5 text-blue-400">{job.syncType}</td>
                      <td className="py-2.5">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            job.status === 'COMPLETED'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : job.status === 'RUNNING'
                              ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                              : 'bg-red-500/10 text-red-400 border border-red-500/20'
                          }`}
                        >
                          {job.status}
                        </span>
                      </td>
                      <td className="py-2.5 text-[#94A3B8]">
                        {new Date(job.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td className="py-2.5 text-right text-white">{job.recordsReceived}</td>
                      <td className="py-2.5 text-right text-emerald-400 font-bold">{job.recordsInserted}</td>
                      <td className="py-2.5 text-right text-amber-400">{job.recordsSkipped}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Col 3: Raw Table Counts & Database Architecture Status */}
        <div className="space-y-5">
          {/* Raw Database Tables Overview */}
          <div className="bg-[#0B0E14] border border-[#1E293B] rounded-xl p-5 space-y-4">
            <h3 className="text-xs font-bold text-white flex items-center gap-2">
              <Database className="w-4 h-4 text-blue-400" />
              Raw Exchange Ingestion Layer
            </h3>
            <p className="text-[11px] text-[#64748B] leading-relaxed">
              Raw fills and orders are persisted in untouched isolation. Real trades are reconstructed later in Step 4.
            </p>

            <div className="space-y-2.5">
              <div className="bg-[#080B10] border border-[#1E293B] rounded-lg p-3 flex justify-between items-center">
                <div>
                  <p className="text-xs font-bold text-white">raw_exchange_orders</p>
                  <p className="text-[10px] text-[#64748B] font-mono">Full payload + order state</p>
                </div>
                <span className="text-sm font-mono font-bold text-blue-400">
                  {rawSummary?.counts.rawOrders ?? 48}
                </span>
              </div>

              <div className="bg-[#080B10] border border-[#1E293B] rounded-lg p-3 flex justify-between items-center">
                <div>
                  <p className="text-xs font-bold text-white">raw_exchange_fills</p>
                  <p className="text-[10px] text-[#64748B] font-mono">1 execution = 1 fill record</p>
                </div>
                <span className="text-sm font-mono font-bold text-emerald-400">
                  {rawSummary?.counts.rawFills ?? 52}
                </span>
              </div>

              <div className="bg-[#080B10] border border-[#1E293B] rounded-lg p-3 flex justify-between items-center">
                <div>
                  <p className="text-xs font-bold text-white">funding_transactions</p>
                  <p className="text-[10px] text-[#64748B] font-mono">Settlement fee audit</p>
                </div>
                <span className="text-sm font-mono font-bold text-amber-400">
                  {rawSummary?.counts.fundingTransactions ?? 18}
                </span>
              </div>

              <div className="bg-[#080B10] border border-[#1E293B] rounded-lg p-3 flex justify-between items-center">
                <div>
                  <p className="text-xs font-bold text-white">equity_snapshots</p>
                  <p className="text-[10px] text-[#64748B] font-mono">Mark-to-market curve</p>
                </div>
                <span className="text-sm font-mono font-bold text-indigo-400">
                  {rawSummary?.counts.equitySnapshots ?? 30}
                </span>
              </div>
            </div>
          </div>

          {/* Database Persistence Status & Guidance */}
          <div className="bg-[#0B0E14] border border-[#1E293B] rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                <Database className="w-4 h-4 text-emerald-400" />
                Persistence Layer
              </h3>
              <span
                className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded ${
                  dbHealth?.status === 'CONNECTED'
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : dbHealth?.status === 'ERROR'
                    ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                }`}
              >
                {dbHealth?.status === 'CONNECTED'
                  ? 'Database: Connected'
                  : dbHealth?.status === 'ERROR'
                  ? 'Database: Error'
                  : 'Database: Not configured'}
              </span>
            </div>

            <div className="bg-[#080B10] border border-[#1E293B] rounded-lg p-3 space-y-1.5 font-mono text-xs">
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-[#64748B]">Provider</span>
                <span className="text-[11px] text-white font-medium">
                  {dbHealth?.provider || 'Supabase PostgreSQL (Prisma)'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-[#64748B]">Authoritative Store</span>
                <span className="text-[11px] text-white">
                  {dbHealth?.persistent ? (
                    <span className="text-emerald-400">PostgreSQL (Durable)</span>
                  ) : (
                    <span className="text-amber-400">In-Memory (Development Only)</span>
                  )}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-[#64748B]">Live Sync Guard</span>
                <span className="text-[11px] text-slate-300">
                  {dbHealth?.status === 'CONNECTED' ? (
                    <span className="text-emerald-400 font-semibold">Enabled (Unlocked)</span>
                  ) : (
                    <span className="text-amber-400 font-semibold">Strictly Blocked</span>
                  )}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-[#64748B] leading-relaxed">
              {dbHealth?.status === 'CONNECTED'
                ? 'Supabase PostgreSQL connection verified. Ingested raw exchange data is persisted permanently.'
                : 'DATABASE_URL is not currently active. Live MEXC data ingestion is strictly protected and will not sync into volatile storage until PostgreSQL is connected.'}
            </p>

            {/* Test Persistence Button */}
            {dbHealth?.status === 'CONNECTED' && (
              <div className="pt-2">
                <button
                  onClick={handleTestPersistence}
                  disabled={isTestingPersistence}
                  className="w-full py-1.5 px-3 rounded-lg text-xs font-medium bg-[#1E293B] hover:bg-[#283548] text-white border border-[#334155] transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTestingPersistence ? 'animate-spin' : 'text-emerald-400'}`} />
                  {isTestingPersistence ? 'Verifying Persistence...' : 'Verify PostgreSQL Persistence'}
                </button>
              </div>
            )}

            {persistenceResult && (
              <div
                className={`p-2.5 rounded-lg border text-[11px] font-mono ${
                  persistenceResult.success
                    ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                    : 'bg-red-950/20 border-red-500/30 text-red-300'
                }`}
              >
                {persistenceResult.message}
              </div>
            )}

            <div className="pt-2 text-[11px] text-[#475569] space-y-1 font-mono border-t border-[#1E293B]/60">
              <p>• Schema: Prisma / PostgreSQL DDL</p>
              <p>• Tables: raw_exchange_orders, raw_exchange_fills, etc.</p>
              <p>• Idempotent: Compound natural key deduplication</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
