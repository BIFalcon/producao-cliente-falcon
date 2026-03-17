import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FiltersContext';
import { formatRevenueTable, formatPercent, toTitleCase, MONTH_NAMES } from '@/lib/formatters';
import { ChevronDown, ChevronRight } from 'lucide-react';

const AgentAnalysis = () => {
  const { filters, currentYear, previousYear } = useFilters();
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['agent-comparison', filters.property, currentYear, previousYear, filters.month],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_agent_comparison', {
        p_property: filters.property,
        p_current_year: currentYear,
        p_previous_year: previousYear,
        p_month: filters.month,
      });
      if (error) throw error;
      return (data || []) as Array<{
        travel_agent_name: string;
        revenue_current: number;
        revenue_previous: number;
        absolute_change: number;
        pct_change: number | null;
      }>;
    },
  });

  const { data: companiesData, isLoading: companiesLoading } = useQuery({
    queryKey: ['agent-companies', expandedAgent, filters.property, currentYear, previousYear, filters.month],
    queryFn: async () => {
      if (!expandedAgent) return [];
      const { data, error } = await supabase.rpc('get_agent_companies', {
        p_agent: expandedAgent,
        p_property: filters.property,
        p_current_year: currentYear,
        p_previous_year: previousYear,
        p_month: filters.month,
      });
      if (error) throw error;
      return (data || []) as Array<{
        company_name: string;
        revenue_current: number;
        revenue_previous: number;
        absolute_change: number;
        pct_change: number | null;
      }>;
    },
    enabled: !!expandedAgent,
  });

  const periodLabel = filters.month
    ? `${MONTH_NAMES[(filters.month || 1) - 1]} ${currentYear} vs ${MONTH_NAMES[(filters.month || 1) - 1]} ${previousYear}`
    : `${currentYear} vs ${previousYear}`;

  if (isLoading) {
    return <div className="surface-card animate-pulse h-48 p-6" />;
  }

  return (
    <div className="surface-card overflow-hidden">
      <div className="p-4 pb-2">
        <h3 className="text-sm font-semibold text-foreground">Agências de Viagem</h3>
        <p className="text-xs text-muted-foreground mt-1">{data?.length || 0} agências · {periodLabel}</p>
      </div>
      <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
        <table className="w-full text-sm table-compact">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground w-8"></th>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Agência</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Receita {currentYear}</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Receita {previousYear}</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Var. Absoluta</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Var. %</th>
            </tr>
          </thead>
          <tbody>
            {data && data.length > 0 ? (
              data.slice(0, 50).map((row) => {
                const isExpanded = expandedAgent === row.travel_agent_name;
                return (
                  <React.Fragment key={row.travel_agent_name}>
                    <tr
                      className={`border-b cursor-pointer transition-colors hover:bg-secondary/30 ${isExpanded ? 'bg-secondary/20' : ''}`}
                      style={{ borderColor: 'rgba(255,255,255,0.04)' }}
                      onClick={() => setExpandedAgent(prev => prev === row.travel_agent_name ? null : row.travel_agent_name)}
                    >
                      <td className="px-4 py-2 text-muted-foreground">
                        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      </td>
                      <td className="px-4 py-2 text-foreground font-medium truncate max-w-[200px]">{toTitleCase(row.travel_agent_name)}</td>
                      <td className="px-4 py-2 text-right font-mono text-foreground">{formatRevenueTable(row.revenue_current)}</td>
                      <td className="px-4 py-2 text-right font-mono text-muted-foreground">{formatRevenueTable(row.revenue_previous)}</td>
                      <td className={`px-4 py-2 text-right font-mono ${(row.absolute_change || 0) >= 0 ? 'var-positive' : 'var-negative'}`}>
                        {(row.absolute_change || 0) >= 0 ? '+' : ''}{formatRevenueTable(row.absolute_change)}
                      </td>
                      <td className={`px-4 py-2 text-right font-mono ${(row.pct_change || 0) >= 0 ? 'var-positive' : 'var-negative'}`}>
                        {formatPercent(row.pct_change)}
                      </td>
                    </tr>
                    {isExpanded && (
                      companiesLoading ? (
                        <tr><td colSpan={6} className="px-8 py-4 text-center text-xs text-muted-foreground">Carregando...</td></tr>
                      ) : companiesData && companiesData.length > 0 ? (
                        companiesData.map((sub, j) => (
                          <tr key={j} className="border-b bg-secondary/10" style={{ borderColor: 'rgba(255,255,255,0.02)' }}>
                            <td className="px-4 py-1.5"></td>
                            <td className="px-4 py-1.5 pl-8 text-xs text-foreground/80">{toTitleCase(sub.company_name)}</td>
                            <td className="px-4 py-1.5 text-right font-mono text-xs text-foreground/80">{formatRevenueTable(sub.revenue_current)}</td>
                            <td className="px-4 py-1.5 text-right font-mono text-xs text-muted-foreground">{formatRevenueTable(sub.revenue_previous)}</td>
                            <td className={`px-4 py-1.5 text-right font-mono text-xs ${(sub.absolute_change || 0) >= 0 ? 'var-positive' : 'var-negative'}`}>
                              {(sub.absolute_change || 0) >= 0 ? '+' : ''}{formatRevenueTable(sub.absolute_change)}
                            </td>
                            <td className={`px-4 py-1.5 text-right font-mono text-xs ${(sub.pct_change || 0) >= 0 ? 'var-positive' : 'var-negative'}`}>
                              {formatPercent(sub.pct_change)}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr><td colSpan={6} className="px-8 py-4 text-center text-xs text-muted-foreground">Sem empresas vinculadas</td></tr>
                      )
                    )}
                  </React.Fragment>
                );
              })
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Sem dados</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AgentAnalysis;
