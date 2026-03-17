import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FiltersContext';
import { formatRevenueTable, formatPercent } from '@/lib/formatters';

const CompanyTable = () => {
  const { filters } = useFilters();
  const currentYear = filters.year || new Date().getFullYear();
  const previousYear = currentYear - 1;

  const { data, isLoading } = useQuery({
    queryKey: ['companies', filters, currentYear],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_company_table', {
        p_property: filters.property,
        p_current_year: currentYear,
        p_previous_year: previousYear,
        p_channel: filters.channel,
      });
      if (error) throw error;
      return data || [];
    },
  });

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
      <div className="p-4 pb-2">
        <h3 className="text-sm font-semibold text-foreground">Tabela de Empresas</h3>
        <p className="text-xs text-muted-foreground mt-1">
          {data?.length || 0} empresas · Ordenado por receita {currentYear}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm table-compact">
          <thead>
            <tr className="border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Empresa</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Receita {currentYear} (R$)</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Receita {previousYear} (R$)</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Var. Absoluta (R$)</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Var. %</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Share %</th>
            </tr>
          </thead>
          <tbody>
            {data && data.length > 0 ? (
              data.slice(0, 50).map((row, i) => (
                <tr
                  key={i}
                  className="border-b transition-colors hover:bg-secondary/30"
                  style={{ borderColor: 'rgba(255,255,255,0.04)' }}
                >
                  <td className="px-4 py-2 text-foreground font-medium truncate max-w-[200px]">{row.company_name}</td>
                  <td className="px-4 py-2 text-right font-mono text-foreground">{formatRevenueTable(row.revenue_current)}</td>
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">{formatRevenueTable(row.revenue_previous)}</td>
                  <td className={`px-4 py-2 text-right font-mono ${(row.absolute_change || 0) >= 0 ? 'var-positive' : 'var-negative'}`}>
                    {(row.absolute_change || 0) >= 0 ? '+' : ''}{formatRevenueTable(row.absolute_change)}
                  </td>
                  <td className={`px-4 py-2 text-right font-mono ${(row.pct_change || 0) >= 0 ? 'var-positive' : 'var-negative'}`}>
                    {row.pct_change !== null ? formatPercent(row.pct_change) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">{row.revenue_share?.toFixed(1)}%</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Sem dados de empresas disponíveis
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
