import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FiltersContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatRevenue, formatNumber } from '@/lib/formatters';
import { TrendingUp, TrendingDown } from 'lucide-react';

const CompanyHighlights = () => {
  const { filters } = useFilters();
  const { tenantId } = useAuth();
  const currentYear = filters.year || new Date().getFullYear();
  const previousYear = currentYear - 1;

  const { data } = useQuery({
    queryKey: ['company-highlights', tenantId, filters, currentYear],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_company_table', {
        p_tenant_id: tenantId!,
        p_property: filters.property,
        p_current_year: currentYear,
        p_previous_year: previousYear,
        p_channel: filters.channel,
      });
      if (error) throw error;
      if (!data || data.length === 0) return null;

      // Min revenue threshold
      const threshold = 5000;
      const filtered = data.filter(
        (d) => (d.revenue_current || 0) > threshold || (d.revenue_previous || 0) > threshold
      );

      const topAbsGrowth = [...filtered].sort((a, b) => (b.absolute_change || 0) - (a.absolute_change || 0))[0];
      const topAbsDrop = [...filtered].sort((a, b) => (a.absolute_change || 0) - (b.absolute_change || 0))[0];
      const withPct = filtered.filter(d => d.pct_change !== null);
      const topPctGrowth = [...withPct].sort((a, b) => (b.pct_change || 0) - (a.pct_change || 0))[0];
      const topPctDrop = [...withPct].sort((a, b) => (a.pct_change || 0) - (b.pct_change || 0))[0];

      return { topAbsGrowth, topAbsDrop, topPctGrowth, topPctDrop };
    },
  });

  if (!data) return null;

  const cards = [
    { label: 'Maior Crescimento Absoluto', company: data.topAbsGrowth?.company_name, value: formatRevenue(data.topAbsGrowth?.absolute_change || 0), positive: true },
    { label: 'Maior Queda Absoluta', company: data.topAbsDrop?.company_name, value: formatRevenue(data.topAbsDrop?.absolute_change || 0), positive: false },
    { label: 'Maior Crescimento %', company: data.topPctGrowth?.company_name, value: `${(data.topPctGrowth?.pct_change || 0).toFixed(1)}%`, positive: true },
    { label: 'Maior Queda %', company: data.topPctDrop?.company_name, value: `${(data.topPctDrop?.pct_change || 0).toFixed(1)}%`, positive: false },
  ];

  return (
    <div className="surface-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Destaques de Performance</h3>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((card, i) => (
          <div key={i} className="rounded-md border p-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-1 mb-1">
              {card.positive ? (
                <TrendingUp className="h-3 w-3 text-success" />
              ) : (
                <TrendingDown className="h-3 w-3 text-destructive" />
              )}
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{card.label}</span>
            </div>
            <div className="text-sm font-semibold text-foreground truncate">{card.company || '—'}</div>
            <div className={`text-xs font-mono ${card.positive ? 'var-positive' : 'var-negative'}`}>
              {card.positive ? '+' : ''}{card.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CompanyHighlights;
