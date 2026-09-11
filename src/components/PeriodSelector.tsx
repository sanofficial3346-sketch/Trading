import React from 'react';
import { PeriodFilter } from '../types';

interface PeriodSelectorProps {
  selected: PeriodFilter;
  onChange: (period: PeriodFilter) => void;
}

const periods: PeriodFilter[] = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', 'ALL'];

export const PeriodSelector: React.FC<PeriodSelectorProps> = ({ selected, onChange }) => {
  return (
    <div
      id="period-filter-group"
      className="flex gap-1 bg-[#1E293B]/40 p-1 rounded-lg border border-[#1E293B]"
    >
      {periods.map((period) => {
        const isActive = selected === period;
        return (
          <button
            key={period}
            id={`period-btn-${period}`}
            onClick={() => onChange(period)}
            className={`px-3 py-1 text-[10px] font-bold transition-colors cursor-pointer ${
              isActive
                ? 'bg-blue-600 text-white rounded-md shadow-sm shadow-blue-500/20'
                : 'text-[#94A3B8] hover:text-white'
            }`}
          >
            {period}
          </button>
        );
      })}
    </div>
  );
};
