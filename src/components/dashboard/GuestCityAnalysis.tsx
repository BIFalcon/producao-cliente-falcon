import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FiltersContext';
import { formatRevenueTable, formatNumber, toTitleCase } from '@/lib/formatters';

const GuestCityAnalysis = () => {
  const { filters } = useFilters();

  const { data, isLoading } = useQuery({
    queryKey: ['guest-cities', filters],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_guest_city_analytics', {
        p_property: filters.property,
        p_year: filters.year,
        p_month: filters.month,
        p_channel: filters.channel,
      });
      if (error) throw error;
      return (data || []) as Array<{
        city: string;
        state: string;
        revenue: number;
        reservations: number;
      }>;
    },
  });

  if (isLoading) {
    return <div className="surface-card animate-pulse h-48 p-6" />;
  }

  return (
    <div className="surface-card overflow-hidden">
      <div className="p-4 pb-2">
        <h3 className="text-sm font-semibold text-foreground">Origem dos Hóspedes</h3>
        <p className="text-xs text-muted-foreground mt-1">{data?.length || 0} cidades</p>
      </div>
      <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
        <table className="w-full text-sm table-compact">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Cidade</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">UF</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Reservas</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Receita (R$)</th>
            </tr>
          </thead>
          <tbody>
            {data && data.length > 0 ? (
              data.slice(0, 50).map((row, i) => (
                <tr key={i} className="border-b transition-colors hover:bg-secondary/30" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                  <td className="px-4 py-2 text-foreground font-medium">{toTitleCase(row.city)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{row.state?.toUpperCase() || '—'}</td>
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">{formatNumber(row.reservations)}</td>
                  <td className="px-4 py-2 text-right font-mono text-foreground">{formatRevenueTable(row.revenue)}</td>
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

export default GuestCityAnalysis;
