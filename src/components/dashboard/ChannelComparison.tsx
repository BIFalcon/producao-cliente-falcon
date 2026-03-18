import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FiltersContext';
import { formatRevenueTable, toTitleCase } from '@/lib/formatters';
import { ChevronDown, ChevronRight } from 'lucide-react';

const NON_DRILLDOWN_CHANNELS = ['Particular'];

const ChannelComparison = () => {
  const { filters, currentYear, previousYear } = useFilters();
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);

  // Multi-year data
  const { data: multiyearData, isLoading } = useQuery({
    queryKey: ['channel-multiyear', filters.property, filters.month],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_channel_multiyear', {
        p_property: filters.property,
        p_month: filters.month,
      });
      if (error) throw error;
      return (data || []) as Array<{
        sales_channel: string;
        departure_year: number;
        revenue: number;
        roomnights: number;
        room_revenue: number;
      }>;
    },
  });

  // Drilldown data (still uses year comparison)
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
        roomnights_current: number;
        adr_current: number;
      }>;
    },
    enabled: !!expandedChannel,
  });

  // Derive years and pivot data
  const { years, channelRows } = useMemo(() => {
    if (!multiyearData || multiyearData.length === 0) return { years: [] as number[], channelRows: [] as any[] };

    const allYears = [...new Set(multiyearData.map(r => r.departure_year))].sort((a, b) => b - a);

    const channelMap = new Map<string, { revenues: Record<number, number>; maxRevenue: number }>();
    for (const row of multiyearData) {
      if (!channelMap.has(row.sales_channel)) {
        channelMap.set(row.sales_channel, { revenues: {}, maxRevenue: 0 });
      }
      const ch = channelMap.get(row.sales_channel)!;
      ch.revenues[row.departure_year] = row.revenue;
      if (allYears[0] === row.departure_year) {
        ch.maxRevenue = row.revenue;
      }
    }

    const rows = Array.from(channelMap.entries())
      .map(([channel, data]) => ({ channel, ...data }))
      .sort((a, b) => (b.revenues[allYears[0]] || 0) - (a.revenues[allYears[0]] || 0));

    return { years: allYears, channelRows: rows };
  }, [multiyearData]);

  const toggleChannel = (channel: string) => {
    if (NON_DRILLDOWN_CHANNELS.includes(channel)) return;
    setExpandedChannel(prev => prev === channel ? null : channel);
  };

  if (isLoading) {
    return <div className="surface-card animate-pulse h-64 p-6" />;
  }

  return (
    <div className="surface-card overflow-hidden">
      <div className="p-4 pb-2">
        <h3 className="text-sm font-semibold text-foreground">Comparação por Canal de Vendas</h3>
        <p className="text-xs text-muted-foreground mt-1">Receita por canal · Ordenado pelo ano mais recente</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm table-compact">
          <thead>
            <tr className="border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground w-8"></th>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Canal</th>
              {years.map(y => (
                <th key={y} className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Receita {y}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {channelRows.length > 0 ? (
              channelRows.map((row) => {
                const isExpandable = !NON_DRILLDOWN_CHANNELS.includes(row.channel);
                const isExpanded = expandedChannel === row.channel;
                return (
                  <React.Fragment key={row.channel}>
                    <tr
                      className={`border-b transition-colors ${isExpandable ? 'cursor-pointer hover:bg-secondary/30' : ''} ${isExpanded ? 'bg-secondary/20' : ''}`}
                      style={{ borderColor: 'rgba(255,255,255,0.04)' }}
                      onClick={() => toggleChannel(row.channel)}
                    >
                      <td className="px-4 py-2 text-muted-foreground">
                        {isExpandable && (isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
                      </td>
                      <td className="px-4 py-2 text-foreground font-medium">{row.channel}</td>
                      {years.map((y, i) => (
                        <td key={y} className={`px-4 py-2 text-right font-mono ${i === 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {formatRevenueTable(row.revenues[y] || 0)}
                        </td>
                      ))}
                    </tr>
                    {isExpanded && (
                      drilldownLoading ? (
                        <tr><td colSpan={2 + years.length} className="px-8 py-4 text-center text-xs text-muted-foreground">Carregando...</td></tr>
                      ) : (
                        drilldownData?.map((sub, j) => (
                          <tr key={j} className="border-b bg-secondary/10" style={{ borderColor: 'rgba(255,255,255,0.02)' }}>
                            <td className="px-4 py-1.5"></td>
                            <td className="px-4 py-1.5 pl-8 text-xs text-foreground/80">{toTitleCase(sub.item_name)}</td>
                            <td className="px-4 py-1.5 text-right font-mono text-xs text-foreground/80">{formatRevenueTable(sub.revenue_current)}</td>
                            {years.length > 1 && (
                              <td className="px-4 py-1.5 text-right font-mono text-xs text-muted-foreground">{formatRevenueTable(sub.revenue_previous)}</td>
                            )}
                            {years.slice(2).map(y => (
                              <td key={y} className="px-4 py-1.5 text-right font-mono text-xs text-muted-foreground">—</td>
                            ))}
                          </tr>
                        ))
                      )
                    )}
                  </React.Fragment>
                );
              })
            ) : (
              <tr>
                <td colSpan={2 + years.length} className="px-4 py-8 text-center text-muted-foreground">Sem dados disponíveis</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ChannelComparison;
