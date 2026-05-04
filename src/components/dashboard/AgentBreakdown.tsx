import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FiltersContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatRevenueTable, formatNumber } from '@/lib/formatters';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

const AgentBreakdown = () => {
  const { filters } = useFilters();
  const { tenantId } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['agents', tenantId, filters],
    enabled: !!tenantId,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_agent_breakdown', {
        p_tenant_id: tenantId,
        p_property: filters.property,
        p_year: filters.year,
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
        <h3 className="text-sm font-semibold text-foreground">Agências de Viagem</h3>
        <p className="text-xs text-muted-foreground mt-1">{data?.length || 0} agências</p>
      </div>
      <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
        <table className="w-full text-sm table-compact">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Agência</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Receita (R$)</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Reservas</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Empresas</th>
            </tr>
          </thead>
          <tbody>
            {data && data.length > 0 ? (
              data.slice(0, 30).map((row, i) => (
                <tr key={i} className="border-b transition-colors hover:bg-secondary/30" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                  <td className="px-4 py-2 text-foreground font-medium truncate max-w-[200px]">{row.travel_agent_name}</td>
                  <td className="px-4 py-2 text-right font-mono text-foreground">{formatRevenueTable(row.revenue)}</td>
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">{formatNumber(row.reservations)}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground truncate max-w-[200px]">
                    {row.companies?.slice(0, 3).join(', ')}
                    {(row.companies?.length || 0) > 3 && ` +${(row.companies?.length || 0) - 3}`}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">Sem dados</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AgentBreakdown;
