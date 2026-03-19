import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FiltersContext';
import { formatRevenue, formatNumber } from '@/lib/formatters';
import { TrendingUp, CalendarClock, BedDouble } from 'lucide-react';

const KPICards = () => {
  const { filters } = useFilters();

  const { data, isLoading } = useQuery({
    queryKey: ['kpis', filters],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_dashboard_kpis', {
        p_property: filters.property,
        p_year: filters.year,
        p_channel: filters.channel,
        p_month: filters.month,
      });
      if (error) throw error;
      return data?.[0] || { total_revenue: 0, total_reservations: 0, avg_lead_time: 0, total_roomnights: 0 };
    },
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="col-span-2 surface-card animate-pulse px-4 py-3">
          <div className="h-3 w-20 rounded bg-muted mb-2" />
          <div className="h-8 w-32 rounded bg-muted" />
        </div>
        {[0, 1].map(i => (
          <div key={i} className="surface-card animate-pulse px-4 py-3">
            <div className="h-3 w-16 rounded bg-muted mb-2" />
            <div className="h-6 w-24 rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <div className="col-span-2 surface-card px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Receita Total</span>
        </div>
        <div className="text-3xl md:text-4xl font-bold tracking-tighter font-mono text-primary">
          {formatRevenue(data?.total_revenue || 0)}
        </div>
      </div>

      <div className="surface-card px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          <BedDouble className="h-4 w-4 text-accent" />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Roomnights</span>
        </div>
        <div className="text-xl font-semibold tracking-tight font-mono text-foreground">
          {formatNumber(Math.round(data?.total_roomnights || 0))}
        </div>
      </div>

      <div className="surface-card px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Antecedência Média</span>
        </div>
        <div className="text-xl font-semibold tracking-tight font-mono text-foreground">
          {data?.avg_lead_time ? `${Math.round(data.avg_lead_time)} dias` : '—'}
        </div>
      </div>
    </div>
  );
};

export default KPICards;
