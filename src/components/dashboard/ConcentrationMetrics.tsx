import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FiltersContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatRevenueTable, formatNumber } from '@/lib/formatters';

const ConcentrationMetrics = () => {
  const { filters } = useFilters();
  const { tenantId } = useAuth();

  const { data } = useQuery({
    queryKey: ['concentration', tenantId, filters],
    enabled: !!tenantId,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_concentration_metrics', {
        p_tenant_id: tenantId,
        p_property: filters.property,
        p_year: filters.year,
        p_channel: filters.channel,
      });
      if (error) throw error;
      return data?.[0] || null;
    },
  });

  if (!data) return null;

  const items = [
    { label: 'Top 1', value: data.top1_share },
    { label: 'Top 3', value: data.top3_share },
    { label: 'Top 5', value: data.top5_share },
  ];

  return (
    <div className="surface-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Concentração Corporativa</h3>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.label}>
            <div className="flex justify-between mb-1">
              <span className="text-xs text-muted-foreground">{item.label}</span>
              <span className="text-xs font-mono text-foreground">{item.value?.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${Math.min(item.value || 0, 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ConcentrationMetrics;
