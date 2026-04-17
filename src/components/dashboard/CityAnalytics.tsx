import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FiltersContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatRevenueTable, formatNumber } from '@/lib/formatters';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const CityAnalytics = () => {
  const { filters } = useFilters();
  const { tenantId } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['cities', tenantId, filters],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_city_analytics', {
        p_tenant_id: tenantId,
        p_property: filters.property,
        p_year: filters.year,
        p_channel: filters.channel,
      });
      if (error) throw error;
      return data || [];
    },
  });

  if (isLoading) {
    return <div className="surface-card animate-pulse h-48 p-6" />;
  }

  return (
    <div className="surface-card overflow-hidden">
      <div className="p-4 pb-2">
        <h3 className="text-sm font-semibold text-foreground">Cidades</h3>
        <p className="text-xs text-muted-foreground mt-1">{data?.length || 0} cidades</p>
      </div>
      <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
        <table className="w-full text-sm table-compact">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Cidade</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">UF</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Empresas</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Receita (R$)</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Reservas</th>
            </tr>
          </thead>
          <tbody>
            {data && data.length > 0 ? (
              data.slice(0, 50).map((row, i) => (
                <Tooltip key={i}>
                  <TooltipTrigger asChild>
                    <tr className="border-b cursor-default transition-colors hover:bg-secondary/30" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                      <td className="px-4 py-2 text-foreground font-medium">{row.city || '—'}</td>
                      <td className="px-4 py-2 text-muted-foreground">{row.state || '—'}</td>
                      <td className="px-4 py-2 text-right font-mono text-muted-foreground">{formatNumber(row.company_count)}</td>
                      <td className="px-4 py-2 text-right font-mono text-foreground">{formatRevenueTable(row.revenue)}</td>
                      <td className="px-4 py-2 text-right font-mono text-muted-foreground">{formatNumber(row.reservations)}</td>
                    </tr>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs">
                    <p className="font-semibold mb-1">{row.city}, {row.state}</p>
                    <p className="text-xs text-muted-foreground">{row.company_count} empresas</p>
                    {row.top_companies && row.top_companies.length > 0 && (
                      <p className="text-xs mt-1">Principais: {row.top_companies.join(', ')}</p>
                    )}
                  </TooltipContent>
                </Tooltip>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Sem dados</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CityAnalytics;
