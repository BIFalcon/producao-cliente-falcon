import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FiltersContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatRevenueTable, formatPercent, formatNumber, MONTH_NAMES } from '@/lib/formatters';
import { monthsLabel } from '@/lib/formatters';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';

const CompanyTable = () => {
  const { filters, currentYear, previousYear } = useFilters();
  const { tenantId } = useAuth();
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['companies', tenantId, filters, currentYear],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_company_table', {
        p_tenant_id: tenantId,
        p_property: filters.property,
        p_current_year: currentYear,
        p_previous_year: previousYear,
        p_channel: filters.channel,
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

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!search.trim()) return data.slice(0, 50);
    const q = search.toLowerCase();
    return data.filter(r => r.company_name?.toLowerCase().includes(q)).slice(0, 50);
  }, [data, search]);

  const monthPart = monthsLabel(filters.month);
  const currentLabel = monthPart ? `${monthPart} ${currentYear}` : `${currentYear}`;
  const previousLabel = monthPart ? `${monthPart} ${previousYear}` : `${previousYear}`;

  if (isLoading) {
    return (
      <div className="surface-card p-6">
        <div className="h-4 w-32 rounded bg-muted mb-4" />
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-9 w-full rounded bg-muted mb-1" />
        ))}
      </div>
    );
  }

  return (
    <div className="surface-card overflow-hidden">
      <div className="p-4 pb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Tabela de Empresas</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {filtered.length}{search ? ` de ${data?.length || 0}` : ''} empresas · Ordenado por receita {currentLabel}
          </p>
        </div>
        <div className="relative w-full sm:w-56">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar empresa..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm table-compact">
          <thead>
            <tr className="border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Empresa</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Roomnights</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Receita {currentLabel}</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Receita {previousLabel}</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Var. %</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length > 0 ? (
              filtered.map((row, i) => (
                <tr key={i} className="border-b transition-colors hover:bg-secondary/30" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                  <td className="px-4 py-2 text-foreground font-medium truncate max-w-[200px]">{row.company_name}</td>
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">{formatNumber(Math.round(row.roomnights_current || 0))}</td>
                  <td className="px-4 py-2 text-right font-mono text-foreground">{formatRevenueTable(row.revenue_current)}</td>
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">{formatRevenueTable(row.revenue_previous)}</td>
                  <td className={`px-4 py-2 text-right font-mono ${(row.pct_change || 0) >= 0 ? 'var-positive' : 'var-negative'}`}>
                    {row.pct_change !== null ? formatPercent(row.pct_change) : '—'}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  {search ? 'Nenhuma empresa encontrada' : 'Sem dados de empresas disponíveis'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CompanyTable;
