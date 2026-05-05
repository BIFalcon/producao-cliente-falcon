import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FiltersContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatRevenueTable, formatPercent, formatNumber, toTitleCase, MONTH_NAMES } from '@/lib/formatters';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

const AgentAnalysis = () => {
  const { filters, currentYear, previousYear } = useFilters();
  const { tenantId } = useAuth();
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['agent-comparison', tenantId, filters.property, currentYear, previousYear, filters.month],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_agent_comparison', {
        p_tenant_id: tenantId,
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
        roomnights_current: number;
      }>;
    },
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!search.trim()) return data.slice(0, 50);
    const q = search.toLowerCase();
    return data.filter(r => r.travel_agent_name?.toLowerCase().includes(q)).slice(0, 50);
  }, [data, search]);

  const { data: companiesData, isLoading: companiesLoading } = useQuery({
    queryKey: ['agent-companies', tenantId, expandedAgent, filters.property, currentYear, previousYear, filters.month],
    enabled: !!tenantId && !!expandedAgent,
    queryFn: async () => {
      if (!expandedAgent) return [];
      const { data, error } = await (supabase.rpc as any)('get_agent_companies', {
        p_tenant_id: tenantId,
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
        roomnights_current: number;
      }>;
    },
  });

  const currentLabel = filters.month
    ? `${MONTH_NAMES[(filters.month || 1) - 1]} ${currentYear}`
    : `${currentYear}`;
  const previousLabel = filters.month
    ? `${MONTH_NAMES[(filters.month || 1) - 1]} ${previousYear}`
    : `${previousYear}`;

  const periodLabel = `${currentLabel} vs ${previousLabel}`;

  if (isLoading) {
    return <div className="surface-card animate-pulse h-48 p-6" />;
  }

  return (
    <div className="surface-card overflow-hidden">
      <div className="p-4 pb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Agências de Viagem</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {filtered.length}{search ? ` de ${data?.length || 0}` : ''} agências · {periodLabel}
          </p>
        </div>
        <div className="relative w-full sm:w-56">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar agência..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>
      <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
        <table className="w-full text-sm table-compact">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground w-8"></th>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Agência</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Roomnights</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Receita {currentLabel}</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Receita {previousLabel}</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Var. %</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length > 0 ? (
              filtered.map((row) => {
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
                      <td className="px-4 py-2 text-right font-mono text-muted-foreground">{formatNumber(Math.round(row.roomnights_current || 0))}</td>
                      <td className="px-4 py-2 text-right font-mono text-foreground">{formatRevenueTable(row.revenue_current)}</td>
                      <td className="px-4 py-2 text-right font-mono text-muted-foreground">{formatRevenueTable(row.revenue_previous)}</td>
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
                            <td className="px-4 py-1.5 text-right font-mono text-xs text-muted-foreground">{formatNumber(Math.round(sub.roomnights_current || 0))}</td>
                            <td className="px-4 py-1.5 text-right font-mono text-xs text-foreground/80">{formatRevenueTable(sub.revenue_current)}</td>
                            <td className="px-4 py-1.5 text-right font-mono text-xs text-muted-foreground">{formatRevenueTable(sub.revenue_previous)}</td>
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
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {search ? 'Nenhuma agência encontrada' : 'Sem dados'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AgentAnalysis;
