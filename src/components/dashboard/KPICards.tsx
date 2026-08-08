import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FiltersContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatRevenue, formatNumber } from '@/lib/formatters';
import { TrendingUp, CalendarClock, BedDouble } from 'lucide-react';

const KPICards = () => {
  const { filters } = useFilters();
  const { tenantId } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['kpis', tenantId, filters],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_dashboard_kpis', {
        p_tenant_id: tenantId,
        p_property: filters.property,
        p_year: filters.year,
        p_channel: filters.channel,
        p_month: filters.month,
      });
      console.log('[KPICards] tenantId:', tenantId, 'result:', data, 'error:', error);
      if (error) throw error;
      return data?.[0] || { total_revenue: 0, total_reservations: 0, avg_lead_time: 0, total_roomnights: 0 };
    },
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2 surface-card animate-pulse px-6 py-6">
          <div className="h-3 w-24 rounded bg-muted mb-3" />
          <div className="h-12 w-48 rounded bg-muted" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[0, 1].map(i => (
            <div key={i} className="surface-card animate-pulse px-4 py-3">
              <div className="h-3 w-16 rounded bg-muted mb-2" />
              <div className="h-5 w-20 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <div
        className="lg:col-span-2 surface-card px-6 py-6"
        style={{ background: 'linear-gradient(135deg, hsl(var(--surface)), hsl(var(--primary) / 0.10))' }}
      >
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Receita Total</span>
        </div>
        <div className="text-5xl md:text-6xl font-bold leading-none tracking-tighter font-mono text-primary">
          {formatRevenue(data?.total_revenue || 0)}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Métrica principal do período filtrado</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="surface-card px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <BedDouble className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Roomnights</span>
          </div>
          <div className="text-lg font-medium tracking-tight font-mono text-foreground/90">
            {formatNumber(Math.round(data?.total_roomnights || 0))}
          </div>
        </div>

        <div className="surface-card px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Antecedência</span>
          </div>
          <div className="text-lg font-medium tracking-tight font-mono text-foreground/90">
            {data?.avg_lead_time ? `${Math.round(data.avg_lead_time)} dias` : '—'}
          </div>
        </div>
      </div>
    </div>
  );
};

export default KPICards;
