import React, { useState, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { mockTickers } from '../mockData';

export const TopHeader: React.FC = () => {
  const [timeStr, setTimeStr] = useState('10:15:48 EDT');
  const [dateStr, setDateStr] = useState('Sep 6, 2026');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }) + ' UTC'
      );
      setDateStr(
        now.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header
      id="top-header"
      className="fixed top-0 left-56 right-0 h-12 bg-[#0B0E14] border-b border-[#1E293B] flex items-center px-4 justify-between z-20 select-none"
    >
      {/* Market Tickers Bar */}
      <div id="market-tickers-container" className="flex items-center gap-6 overflow-x-auto py-1 scrollbar-none">
        {mockTickers.map((ticker) => (
          <div
            key={ticker.symbol}
            id={`ticker-${ticker.symbol}`}
            className="flex items-center gap-2 border-r border-[#1E293B] pr-6 last:border-r-0 flex-shrink-0"
          >
            <span className="text-xs font-bold text-[#94A3B8]">
              {ticker.symbol}
            </span>
            <span
              className={`text-xs font-mono font-medium ${
                ticker.isPositive ? 'text-emerald-500' : 'text-red-500'
              }`}
            >
              {ticker.change}
            </span>
          </div>
        ))}
      </div>

      {/* Right controls: Date/Time, Alerts */}
      <div id="top-header-actions" className="flex items-center gap-4 pl-4 flex-shrink-0">
        {/* Current Date & Time */}
        <span
          id="system-clock"
          className="text-[11px] text-[#64748B] font-mono tracking-tighter uppercase"
        >
          {dateStr} {timeStr}
        </span>

        {/* Notification Bell */}
        <div
          id="notification-bell-btn"
          className="w-8 h-8 flex items-center justify-center text-[#94A3B8] hover:text-white cursor-pointer transition-colors"
          title="Notifications"
        >
          <Bell className="w-4 h-4" />
        </div>
      </div>
    </header>
  );
};
