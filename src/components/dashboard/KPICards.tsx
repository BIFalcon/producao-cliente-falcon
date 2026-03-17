import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FiltersContext';
import { formatRevenue, formatNumber } from '@/lib/formatters';
import { TrendingUp, CalendarClock, Hash } from 'lucide-react';

const KPICards = () => {
  const { filters } = useFilters();

  const { data, isLoading } = useQuery({
    queryKey: ['kpis', filters],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_dashboard_kpis', {
        p_property: filters.property,
        p_year: filters.year,
        p_channel: filters.channel,
      });
      if (error) throw error;
      return data?.[0] || { total_revenue: 0, total_reservations: 0, avg_lead_time: 0 };
    },
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[0, 1, 2].map(i => (
          <div key={i} className="surface-card animate-pulse p-6" style={{ gridColumn: i === 0 ? 'span 2 / span 2' : undefined }}>
            <div className="h-4 w-20 rounded bg-muted mb-3" />
            <div className="h-10 w-32 rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
      <div className="surface-card p-6 md:col-span-2">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Receita Total</span>
        </div>
        <div className="kpi-hero">{formatRevenue(data?.total_revenue || 0)}</div>
      </div>

      <div className="surface-card p-6">
        <div className="flex items-center gap-2 mb-2">
          <Hash className="h-4 w-4 text-accent" />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Reservas</span>
        </div>
        <div className="kpi-secondary">{formatNumber(data?.total_reservations || 0)}</div>
      </div>

      <div className="surface-card p-6">
        <div className="flex items-center gap-2 mb-2">
          <CalendarClock className="h-4 w-4 text-chart-emerald" />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Antecedência Média</span>
        </div>
        <div className="kpi-secondary">
          {data?.avg_lead_time ? `${Math.round(data.avg_lead_time)} dias` : '—'}
        </div>
      </div>
    </div>
  );
};

export default KPICards;
