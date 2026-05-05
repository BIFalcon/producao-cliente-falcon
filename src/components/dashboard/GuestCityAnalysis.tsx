import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FiltersContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatRevenueTable, formatNumber, toTitleCase } from '@/lib/formatters';
import { ChevronDown, ChevronRight } from 'lucide-react';

const GuestCityAnalysis = () => {
  const { filters } = useFilters();
  const [expandedCity, setExpandedCity] = useState<{ city: string; state: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['guest-cities', filters],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_guest_city_analytics', {
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
        roomnights: number;
      }>;
    },
  });

  const { data: drilldownData, isLoading: drilldownLoading } = useQuery({
    queryKey: ['guest-city-drilldown', expandedCity, filters],
    queryFn: async () => {
      if (!expandedCity) return [];
      const { data, error } = await (supabase.rpc as any)('get_guest_city_drilldown', {
        p_city: expandedCity.city,
        p_state: expandedCity.state,
        p_property: filters.property,
        p_year: filters.year,
        p_month: filters.month,
        p_channel: filters.channel,
      });
      if (error) throw error;
      return (data || []) as Array<{
        entity_name: string;
        entity_type: string;
        revenue: number;
        roomnights: number;
      }>;
    },
    enabled: !!expandedCity,
  });

  const toggleCity = (city: string, state: string) => {
    setExpandedCity(prev =>
      prev?.city === city && prev?.state === state ? null : { city, state }
    );
  };

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
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground w-8"></th>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Cidade</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">UF</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Roomnights</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Receita (R$)</th>
            </tr>
          </thead>
          <tbody>
            {data && data.length > 0 ? (
              data.slice(0, 50).map((row, i) => {
                const isExpanded = expandedCity?.city === row.city && expandedCity?.state === row.state;
                return (
                  <React.Fragment key={i}>
                    <tr
                      className={`border-b cursor-pointer transition-colors hover:bg-secondary/30 ${isExpanded ? 'bg-secondary/20' : ''}`}
                      style={{ borderColor: 'rgba(255,255,255,0.04)' }}
                      onClick={() => toggleCity(row.city, row.state)}
                    >
                      <td className="px-4 py-2 text-muted-foreground">
                        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      </td>
                      <td className="px-4 py-2 text-foreground font-medium">{toTitleCase(row.city)}</td>
                      <td className="px-4 py-2 text-muted-foreground">{row.state?.toUpperCase() || '—'}</td>
                      <td className="px-4 py-2 text-right font-mono text-muted-foreground">{formatNumber(Math.round(row.roomnights || 0))}</td>
                      <td className="px-4 py-2 text-right font-mono text-foreground">{formatRevenueTable(row.revenue)}</td>
                    </tr>
                    {isExpanded && (
                      drilldownLoading ? (
                        <tr><td colSpan={5} className="px-8 py-4 text-center text-xs text-muted-foreground">Carregando...</td></tr>
                      ) : drilldownData && drilldownData.length > 0 ? (
                        drilldownData.map((sub, j) => (
                          <tr key={j} className="border-b bg-secondary/10" style={{ borderColor: 'rgba(255,255,255,0.02)' }}>
                            <td className="px-4 py-1.5"></td>
                            <td className="px-4 py-1.5 pl-8 text-xs text-foreground/80" colSpan={1}>{toTitleCase(sub.entity_name)}</td>
                            <td className="px-4 py-1.5 text-xs text-muted-foreground">{sub.entity_type}</td>
                            <td className="px-4 py-1.5 text-right font-mono text-xs text-muted-foreground">{formatNumber(Math.round(sub.roomnights || 0))}</td>
                            <td className="px-4 py-1.5 text-right font-mono text-xs text-foreground/80">{formatRevenueTable(sub.revenue)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr><td colSpan={5} className="px-8 py-4 text-center text-xs text-muted-foreground">Sem detalhes</td></tr>
                      )
                    )}
                  </React.Fragment>
                );
              })
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

export default GuestCityAnalysis;
