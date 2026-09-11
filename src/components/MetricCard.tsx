import React from 'react';
import { MetricCardData } from '../types';

interface MetricCardProps {
  data: MetricCardData;
}

export const MetricCard: React.FC<MetricCardProps> = ({ data }) => {
  const isPnLMetric = data.id !== 'account-balance';

  return (
    <div
      id={`metric-card-${data.id}`}
      className="bg-[#0B0E14] border border-[#1E293B] rounded-xl p-3 hover:border-blue-500/50 transition-all flex flex-col justify-between"
    >
      <p className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider">
        {data.title}
      </p>
      
      <p
        className={`text-lg font-bold mt-1 font-mono-nums ${
          isPnLMetric
            ? data.isPositive
              ? 'text-emerald-500'
              : 'text-red-500'
            : 'text-white'
        }`}
      >
        {data.value}
      </p>

      <p
        className={`text-[10px] mt-0.5 font-bold font-mono-nums ${
          data.isPositive ? 'text-emerald-500' : 'text-red-500'
        }`}
      >
        {data.change} {data.subValue ? `(${data.subValue})` : ''}
      </p>
    </div>
  );
};
