import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FiltersContext';
import { formatRevenue, formatPercent, toTitleCase } from '@/lib/formatters';
import { Lightbulb, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const AutoInsights = () => {
  const [open, setOpen] = useState(false);
  const { filters, currentYear, previousYear } = useFilters();

  const { data: companyData } = useQuery({
    queryKey: ['insights-companies', filters, currentYear],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_company_table', {
        p_property: filters.property,
        p_current_year: currentYear,
        p_previous_year: previousYear,
        p_channel: filters.channel,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  const { data: channelData } = useQuery({
    queryKey: ['insights-channels', filters, currentYear],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_channel_comparison', {
        p_property: filters.property,
        p_current_year: currentYear,
        p_previous_year: previousYear,
        p_month: filters.month,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  const { data: cityData } = useQuery({
    queryKey: ['insights-cities', filters, currentYear],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_guest_city_analytics', {
        p_property: filters.property,
        p_year: currentYear,
        p_month: filters.month,
        p_channel: filters.channel,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  const { data: prevCityData } = useQuery({
    queryKey: ['insights-cities-prev', filters, previousYear],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_guest_city_analytics', {
        p_property: filters.property,
        p_year: previousYear,
        p_month: filters.month,
        p_channel: filters.channel,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  const generateInsights = () => {
    const insights: string[] = [];

    if (companyData && companyData.length > 0) {
      const threshold = 5000;
      const significant = companyData.filter(
        (d: any) => (d.revenue_current || 0) > threshold || (d.revenue_previous || 0) > threshold
      );
      const withPct = significant.filter((d: any) => d.pct_change !== null && d.pct_change !== undefined);

      const topGrowth = [...withPct].sort((a: any, b: any) => (b.pct_change || 0) - (a.pct_change || 0)).slice(0, 3);
      const topDecline = [...withPct].sort((a: any, b: any) => (a.pct_change || 0) - (b.pct_change || 0)).slice(0, 3);

      if (topGrowth.length > 0) {
        const items = topGrowth.map((c: any) =>
          `**${toTitleCase(c.company_name)}** (${formatPercent(c.pct_change)}, ${formatRevenue(c.absolute_change)})`
        ).join(', ');
        insights.push(`📈 **Empresas com maior crescimento:** ${items}`);
      }

      if (topDecline.length > 0 && topDecline[0].pct_change < 0) {
        const items = topDecline.filter((c: any) => c.pct_change < 0).map((c: any) =>
          `**${toTitleCase(c.company_name)}** (${formatPercent(c.pct_change)}, ${formatRevenue(c.absolute_change)})`
        ).join(', ');
        if (items) insights.push(`📉 **Empresas com maior queda:** ${items}`);
      }
    }

    if (cityData && prevCityData) {
      const prevMap = new Map(prevCityData.map((c: any) => [c.city, c.revenue || 0]));
      const cityGrowth = cityData
        .filter((c: any) => c.revenue > 5000 && prevMap.has(c.city) && (prevMap.get(c.city) as number) > 0)
        .map((c: any) => {
          const prev = prevMap.get(c.city) as number;
          const pct = ((c.revenue - prev) / prev) * 100;
          return { ...c, prev, pct };
        })
        .sort((a: any, b: any) => b.pct - a.pct)
        .slice(0, 3);

      if (cityGrowth.length > 0) {
        const items = cityGrowth.map((c: any) =>
          `**${toTitleCase(c.city)}** (${c.pct > 0 ? '+' : ''}${c.pct.toFixed(1)}%, receita ${formatRevenue(c.revenue)})`
        ).join(', ');
        insights.push(`🏙️ **Cidades com maior crescimento:** ${items}`);
      }
    }

    if (channelData && channelData.length > 0) {
      const totalCurrent = channelData.reduce((s: number, c: any) => s + (c.revenue_current || 0), 0);
      if (totalCurrent > 0) {
        const channelShares = channelData.map((c: any) => {
          const share = ((c.revenue_current || 0) / totalCurrent * 100).toFixed(1);
          const change = c.pct_change !== null ? ` (var. ${formatPercent(c.pct_change)})` : '';
          return `**${c.sales_channel}**: ${share}%${change}`;
        }).join(' · ');
        insights.push(`📊 **Distribuição por canal:** ${channelShares}`);
      }
    }

    return insights.length > 0 ? insights : ['Sem dados suficientes para gerar insights.'];
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Lightbulb className="h-4 w-4" />
          Ver Insights Automáticos
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="surface-card mt-3 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-primary" />
            Insights Automáticos — {currentYear} vs {previousYear}
          </h3>
          <div className="space-y-2">
            {generateInsights().map((insight, i) => (
              <p key={i} className="text-xs leading-relaxed text-foreground/90"
                 dangerouslySetInnerHTML={{ __html: insight.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default AutoInsights;
