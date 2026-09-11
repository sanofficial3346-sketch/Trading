import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, Star, Clock, RefreshCw, ChevronDown, Check, X, AlertCircle } from 'lucide-react';
import { MexcContractDirectoryItem } from '../../../server/marketData/mexcPublicMarketClient';

interface SymbolSearchSelectorProps {
  symbols: MexcContractDirectoryItem[];
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  onRefreshDirectory: () => Promise<void>;
  refreshingDirectory: boolean;
  favorites: string[];
  onToggleFavorite: (symbol: string) => void;
  recents: string[];
  showInactive: boolean;
  onToggleShowInactive: (show: boolean) => void;
}

export const SymbolSearchSelector: React.FC<SymbolSearchSelectorProps> = ({
  symbols,
  selectedSymbol,
  onSelectSymbol,
  onRefreshDirectory,
  refreshingDirectory,
  favorites,
  onToggleFavorite,
  recents,
  showInactive,
  onToggleShowInactive,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      // Auto-focus search input
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const currentItem = useMemo(() => {
    return symbols.find((s) => s.rawSymbol === selectedSymbol) || {
      rawSymbol: selectedSymbol,
      displaySymbol: selectedSymbol,
      baseAsset: selectedSymbol.split('_')[0] || selectedSymbol,
      quoteAsset: selectedSymbol.split('_')[1] || 'USDT',
      contractType: 'PERPETUAL',
      state: 0,
      isTradable: true,
      symbol: selectedSymbol,
      displayName: selectedSymbol,
      isSupported: true,
    };
  }, [symbols, selectedSymbol]);

  // Filter symbols based on search and active status
  const filteredSymbols = useMemo(() => {
    const query = searchQuery.trim().toUpperCase();
    return symbols.filter((s) => {
      // Inactive filter
      if (!showInactive && !s.isTradable) return false;

      if (!query) return true;

      const raw = (s.rawSymbol || '').toUpperCase();
      const base = (s.baseAsset || '').toUpperCase();
      const quote = (s.quoteAsset || '').toUpperCase();
      const display = (s.displaySymbol || '').toUpperCase();
      const en = (s.displayNameEn || '').toUpperCase();

      return (
        raw.includes(query) ||
        base.includes(query) ||
        quote.includes(query) ||
        display.includes(query) ||
        en.includes(query)
      );
    });
  }, [symbols, searchQuery, showInactive]);

  // Recent items that exist in current directory
  const recentItems = useMemo(() => {
    return recents
      .map((sym) => symbols.find((s) => s.rawSymbol === sym))
      .filter((s): s is MexcContractDirectoryItem => Boolean(s))
      .slice(0, 6);
  }, [recents, symbols]);

  // Favorite items
  const favoriteItems = useMemo(() => {
    return favorites
      .map((sym) => symbols.find((s) => s.rawSymbol === sym))
      .filter((s): s is MexcContractDirectoryItem => Boolean(s));
  }, [favorites, symbols]);

  const handleSelect = (sym: string) => {
    onSelectSymbol(sym);
    setIsOpen(false);
  };

  const isCurrentFavorite = favorites.includes(selectedSymbol);

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      {/* Trigger Button */}
      <div className="flex items-center bg-[#0C1017] border border-[#1E293B] hover:border-[#334155] rounded-lg p-0.5 transition-colors">
        <button
          type="button"
          onClick={() => onToggleFavorite(selectedSymbol)}
          title={isCurrentFavorite ? 'Remove from favorites' : 'Add to favorites'}
          className="p-1.5 text-slate-400 hover:text-amber-400 transition-colors cursor-pointer"
        >
          <Star
            className={`w-3.5 h-3.5 ${
              isCurrentFavorite ? 'fill-amber-400 text-amber-400' : 'text-slate-500 hover:text-amber-300'
            }`}
          />
        </button>

        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-2 py-1 text-left cursor-pointer focus:outline-none"
        >
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-mono font-bold text-white tracking-wider">
                {currentItem.rawSymbol}
              </span>
              <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {currentItem.quoteAsset || 'USDT'}
              </span>
            </div>
          </div>
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Searchable Dropdown Popover */}
      {isOpen && (
        <div className="absolute left-0 mt-1.5 w-80 sm:w-96 bg-[#0B0F17] border border-[#1E293B] rounded-xl shadow-2xl z-50 overflow-hidden font-mono">
          {/* Search Header */}
          <div className="p-2.5 border-b border-[#1E293B] bg-[#0E1420]/70 space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search raw symbol, BTC, ETH, GOLD, XAU..."
                className="w-full bg-[#080B10] border border-[#1E293B] rounded-lg pl-8 pr-7 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-2 text-slate-500 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filter & Refresh Sub-Row */}
            <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
              <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-300 select-none">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => onToggleShowInactive(e.target.checked)}
                  className="rounded border-[#1E293B] bg-[#080B10] text-emerald-500 focus:ring-0 cursor-pointer w-3 h-3"
                />
                <span>Show inactive contracts</span>
              </label>

              <button
                type="button"
                onClick={onRefreshDirectory}
                disabled={refreshingDirectory}
                title="Refresh public contract directory from MEXC"
                className="flex items-center gap-1 text-slate-400 hover:text-emerald-400 transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${refreshingDirectory ? 'animate-spin text-emerald-400' : ''}`} />
                <span>Refresh list</span>
              </button>
            </div>
          </div>

          {/* Body Sections */}
          <div className="max-h-72 overflow-y-auto divide-y divide-[#1E293B]/60 text-xs">
            {/* Favorites Section (if any & no search filter active) */}
            {!searchQuery && favoriteItems.length > 0 && (
              <div className="p-2 bg-[#0C111A]">
                <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-400 uppercase tracking-wider mb-1.5 px-1">
                  <Star className="w-3 h-3 fill-amber-400" />
                  Favorites
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {favoriteItems.map((item) => (
                    <button
                      key={item.rawSymbol}
                      type="button"
                      onClick={() => handleSelect(item.rawSymbol)}
                      className={`flex items-center justify-between px-2 py-1 rounded text-left transition-colors cursor-pointer border ${
                        item.rawSymbol === selectedSymbol
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                          : 'bg-[#080B10] border-[#1E293B] hover:border-slate-600 text-slate-300'
                      }`}
                    >
                      <span className="font-bold truncate text-[11px]">{item.rawSymbol}</span>
                      {item.rawSymbol === selectedSymbol && <Check className="w-3 h-3 text-emerald-400 shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Recents Section (if any & no search filter active) */}
            {!searchQuery && recentItems.length > 0 && (
              <div className="p-2 bg-[#0B0F17]">
                <div className="flex items-center gap-1 text-[10px] font-semibold text-blue-400 uppercase tracking-wider mb-1.5 px-1">
                  <Clock className="w-3 h-3" />
                  Recent
                </div>
                <div className="flex flex-wrap gap-1">
                  {recentItems.map((item) => (
                    <button
                      key={item.rawSymbol}
                      type="button"
                      onClick={() => handleSelect(item.rawSymbol)}
                      className={`px-2 py-0.5 rounded text-[11px] border transition-colors cursor-pointer ${
                        item.rawSymbol === selectedSymbol
                          ? 'bg-blue-500/20 border-blue-500/40 text-blue-300 font-bold'
                          : 'bg-[#121824] border-[#1E293B] hover:border-slate-600 text-slate-300'
                      }`}
                    >
                      {item.rawSymbol}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Contracts List */}
            <div className="p-1 space-y-0.5">
              <div className="px-2 py-1 text-[10px] text-slate-500 flex justify-between">
                <span>CONTRACT DIRECTORY ({filteredSymbols.length} available)</span>
                {showInactive && <span className="text-amber-400">All states</span>}
              </div>

              {filteredSymbols.length > 0 ? (
                filteredSymbols.slice(0, 100).map((item) => {
                  const isSelected = item.rawSymbol === selectedSymbol;
                  const isFav = favorites.includes(item.rawSymbol);

                  return (
                    <div
                      key={item.rawSymbol}
                      className={`group flex items-center justify-between px-2 py-1.5 rounded-lg transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-emerald-500/15 border border-emerald-500/30 text-white'
                          : 'hover:bg-[#151D2C] text-slate-300'
                      }`}
                      onClick={() => handleSelect(item.rawSymbol)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite(item.rawSymbol);
                          }}
                          className="text-slate-500 hover:text-amber-400 p-0.5 cursor-pointer"
                        >
                          <Star
                            className={`w-3.5 h-3.5 ${
                              isFav ? 'fill-amber-400 text-amber-400' : 'text-slate-600 hover:text-amber-300'
                            }`}
                          />
                        </button>
                        <div className="truncate">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-[11px] text-white group-hover:text-emerald-300">
                              {item.rawSymbol}
                            </span>
                            {!item.isTradable && (
                              <span className="text-[9px] px-1 py-0.2 rounded bg-red-500/20 text-red-300 border border-red-500/30">
                                Inactive
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate">
                            {item.displaySymbol}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 text-right shrink-0">
                        {item.maxLeverage && (
                          <span className="text-[9px] text-slate-500 font-mono">
                            {item.maxLeverage}x
                          </span>
                        )}
                        {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-4 text-center text-slate-500 text-xs">
                  <AlertCircle className="w-4 h-4 mx-auto mb-1 text-slate-600" />
                  No contracts matching &ldquo;{searchQuery}&rdquo;
                </div>
              )}

              {filteredSymbols.length > 100 && (
                <div className="p-2 text-center text-[10px] text-slate-500 border-t border-[#1E293B]">
                  Showing first 100 of {filteredSymbols.length} contracts. Type to refine search.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
