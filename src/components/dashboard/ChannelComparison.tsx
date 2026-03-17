import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FiltersContext';
import { formatRevenueTable, formatPercent, toTitleCase, MONTH_NAMES } from '@/lib/formatters';
import { ChevronDown, ChevronRight } from 'lucide-react';

const NON_DRILLDOWN_CHANNELS = ['Particular'];

const ChannelComparison = () => {
  const { filters, currentYear, previousYear } = useFilters();
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['channel-comparison', filters.property, currentYear, previousYear, filters.month],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_channel_comparison', {
        p_property: filters.property,
        p_current_year: currentYear,
        p_previous_year: previousYear,
        p_month: filters.month,
      });
      if (error) throw error;
      return (data || []) as Array<{
        sales_channel: string;
        revenue_current: number;
        revenue_previous: number;
        absolute_change: number;
        pct_change: number | null;
      }>;
    },
  });

  const { data: drilldownData, isLoading: drilldownLoading } = useQuery({
    queryKey: ['channel-drilldown', expandedChannel, filters.property, currentYear, previousYear, filters.month],
    queryFn: async () => {
      if (!expandedChannel) return [];
      const { data, error } = await (supabase.rpc as any)('get_channel_drilldown', {
        p_channel: expandedChannel,
        p_property: filters.property,
        p_current_year: currentYear,
        p_previous_year: previousYear,
        p_month: filters.month,
      });
      if (error) throw error;
      return (data || []) as Array<{
        item_name: string;
        revenue_current: number;
        revenue_previous: number;
        absolute_change: number;
        pct_change: number | null;
      }>;
    },
    enabled: !!expandedChannel,
  });

  const toggleChannel = (channel: string) => {
    if (NON_DRILLDOWN_CHANNELS.includes(channel)) return;
    setExpandedChannel(prev => prev === channel ? null : channel);
  };

  const periodLabel = filters.month
    ? `${MONTH_NAMES[(filters.month || 1) - 1]} ${currentYear} vs ${MONTH_NAMES[(filters.month || 1) - 1]} ${previousYear}`
    : `${currentYear} vs ${previousYear}`;

  if (isLoading) {
    return <div className="surface-card animate-pulse h-64 p-6" />;
  }

  return (
    <div className="surface-card overflow-hidden">
      <div className="p-4 pb-2">
        <h3 className="text-sm font-semibold text-foreground">Comparação por Canal de Vendas</h3>
        <p className="text-xs text-muted-foreground mt-1">{periodLabel}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm table-compact">
          <thead>
            <tr className="border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground w-8"></th>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Canal</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Receita {currentYear}</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Receita {previousYear}</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Var. Absoluta</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Var. %</th>
            </tr>
          </thead>
          <tbody>
            {data && data.length > 0 ? (
              data.map((row) => {
                const isExpandable = !NON_DRILLDOWN_CHANNELS.includes(row.sales_channel);
                const isExpanded = expandedChannel === row.sales_channel;
                return (
                  <React.Fragment key={row.sales_channel}>
                    <tr
                      className={`border-b transition-colors ${isExpandable ? 'cursor-pointer hover:bg-secondary/30' : ''} ${isExpanded ? 'bg-secondary/20' : ''}`}
                      style={{ borderColor: 'rgba(255,255,255,0.04)' }}
                      onClick={() => toggleChannel(row.sales_channel)}
                    >
                      <td className="px-4 py-2 text-muted-foreground">
                        {isExpandable && (isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
                      </td>
                      <td className="px-4 py-2 text-foreground font-medium">{row.sales_channel}</td>
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
                      drilldownLoading ? (
                        <tr><td colSpan={6} className="px-8 py-4 text-center text-xs text-muted-foreground">Carregando...</td></tr>
                      ) : (
                        drilldownData?.map((sub, j) => (
                          <tr key={j} className="border-b bg-secondary/10" style={{ borderColor: 'rgba(255,255,255,0.02)' }}>
                            <td className="px-4 py-1.5"></td>
                            <td className="px-4 py-1.5 pl-8 text-xs text-foreground/80">{toTitleCase(sub.item_name)}</td>
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
                      )
                    )}
                  </React.Fragment>
                );
              })
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Sem dados disponíveis</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ChannelComparison;
