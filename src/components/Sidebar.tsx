import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  LineChart,
  ArrowLeftRight,
  BarChart3,
  Lightbulb,
  Compass,
  FlaskConical,
  Calendar,
  ShieldAlert,
  Settings,
  RefreshCw,
} from 'lucide-react';
import { PageId } from '../types';
import { mexcFrontendService } from '../services/mexcIntegrationService';
import { MexcConnectionStatus } from '../../server/mexc/types';

interface SidebarProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
}

interface NavItem {
  id: PageId;
  label: string;
  icon: React.ElementType;
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'equity', label: 'Equity', icon: LineChart },
  { id: 'trades', label: 'Trades', icon: ArrowLeftRight },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'insights', label: 'Insights', icon: Lightbulb },
  { id: 'strategies', label: 'Strategies', icon: Compass },
  { id: 'setup-lab', label: 'Setup Lab', icon: FlaskConical },
  { id: 'economic-calendar', label: 'Economic Calendar', icon: Calendar },
  { id: 'risk-management', label: 'Risk Management', icon: ShieldAlert },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const Sidebar: React.FC<SidebarProps> = ({ currentPage, onNavigate }) => {
  const [connectionStatus, setConnectionStatus] = useState<MexcConnectionStatus>(
    MexcConnectionStatus.NOT_CONFIGURED
  );
  const [lastSyncText, setLastSyncText] = useState('Not synced');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);

  const fetchStatus = async () => {
    try {
      const statusData = await mexcFrontendService.getStatus();
      setConnectionStatus(statusData.status);
      if (statusData.lastSuccessfulSync) {
        const diffMs = Date.now() - new Date(statusData.lastSuccessfulSync).getTime();
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins <= 1) {
          setLastSyncText('Just now');
        } else if (diffMins < 60) {
          setLastSyncText(`${diffMins} mins ago`);
        } else {
          setLastSyncText(
            new Date(statusData.lastSuccessfulSync).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })
          );
        }
      }
    } catch {
      // Keep stable UI state
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleManualSync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncFailed(false);
    try {
      const result = await mexcFrontendService.triggerSync();
      if (result.status === 'COMPLETED') {
        setConnectionStatus(MexcConnectionStatus.CONNECTED);
        setLastSyncText('Just now');
      } else {
        setSyncFailed(true);
      }
    } catch {
      setSyncFailed(true);
    } finally {
      setIsSyncing(false);
    }
  };

  const renderStatusBadge = () => {
    if (isSyncing) {
      return (
        <span className="text-[10px] text-blue-400 font-bold px-1.5 py-0.5 bg-blue-500/10 rounded border border-blue-500/20 flex items-center gap-1">
          <RefreshCw className="w-2.5 h-2.5 animate-spin" />
          Syncing...
        </span>
      );
    }
    if (syncFailed || connectionStatus === MexcConnectionStatus.ERROR) {
      return (
        <span className="text-[10px] text-red-400 font-bold px-1.5 py-0.5 bg-red-500/10 rounded border border-red-500/20">
          Sync failed
        </span>
      );
    }
    if (connectionStatus === MexcConnectionStatus.RATE_LIMITED) {
      return (
        <span className="text-[10px] text-amber-400 font-bold px-1.5 py-0.5 bg-amber-500/10 rounded border border-amber-500/20">
          Rate Limited
        </span>
      );
    }
    if (connectionStatus === MexcConnectionStatus.NOT_CONFIGURED) {
      return (
        <span className="text-[10px] text-slate-400 font-bold px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700">
          Not Setup
        </span>
      );
    }
    return (
      <span className="text-[10px] text-emerald-500 font-bold px-1.5 py-0.5 bg-emerald-500/10 rounded border border-emerald-500/20">
        Connected
      </span>
    );
  };

  return (
    <aside
      id="sidebar-container"
      className="w-56 h-screen fixed left-0 top-0 bg-[#0B0E14] border-r border-[#1E293B] flex flex-col z-30 select-none"
    >
      {/* Brand Header */}
      <div id="sidebar-branding" className="p-5 border-b border-[#1E293B]">
        <h1 className="text-xl font-bold tracking-tight text-blue-500 flex items-center gap-1.5">
          TradeMate
        </h1>
        <p className="text-[9px] text-[#475569] uppercase tracking-widest mt-1 font-semibold">
          Discipline Creates Freedom
        </p>
      </div>

      {/* Navigation List */}
      <nav id="sidebar-nav" className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;
          return (
            <button
              key={item.id}
              id={`nav-item-${item.id}`}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left cursor-pointer ${
                isActive
                  ? 'bg-blue-600/20 text-blue-400 font-medium border-l-2 border-blue-500'
                  : 'text-[#94A3B8] hover:bg-[#1E293B] font-normal'
              }`}
            >
              <Icon
                className={`w-4 h-4 flex-shrink-0 ${
                  isActive ? 'text-blue-400' : 'text-[#64748B]'
                }`}
              />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* MEXC Live Status & Profile Footer */}
      <div id="sidebar-footer" className="p-4 border-t border-[#1E293B] bg-[#080B10]">
        <div className="flex items-center justify-between mb-1.5">
          <div>
            <p className="text-[10px] text-[#64748B] font-bold uppercase">EXCHANGE</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  connectionStatus === MexcConnectionStatus.CONNECTED && !syncFailed
                    ? 'bg-emerald-500'
                    : isSyncing
                    ? 'bg-blue-400 animate-pulse'
                    : 'bg-amber-500'
                }`}
              ></span>
              <span className="text-xs font-semibold text-white">MEXC</span>
            </div>
          </div>
          {renderStatusBadge()}
        </div>

        <div className="flex items-center justify-between mb-3 text-[10px]">
          <span className="text-[#64748B] font-mono">
            {isSyncing ? 'Syncing...' : `Last sync: ${lastSyncText}`}
          </span>
          <button
            id="sidebar-sync-now-btn"
            onClick={handleManualSync}
            disabled={isSyncing}
            className="text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1 font-semibold disabled:opacity-50 cursor-pointer"
            title="Trigger read-only sync"
          >
            <RefreshCw className={`w-2.5 h-2.5 ${isSyncing ? 'animate-spin' : ''}`} />
            Sync
          </button>
        </div>

        {/* User Profile */}
        <div className="flex items-center gap-2.5 pt-2 border-t border-[#1E293B]/60">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center font-bold text-xs text-white flex-shrink-0">
            JD
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-white truncate">John Doe</p>
            <p className="text-[10px] text-[#64748B] truncate">Pro Trader</p>
          </div>
        </div>
      </div>
    </aside>
  );
};
