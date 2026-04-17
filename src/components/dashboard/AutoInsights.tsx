import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FiltersContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatRevenue, formatPercent, toTitleCase } from '@/lib/formatters';
import { Lightbulb, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

const AutoInsights = () => {
  const [open, setOpen] = useState(false);
  const { filters, currentYear, previousYear } = useFilters();
  const { tenantId } = useAuth();

  const { data: companyData } = useQuery({
    queryKey: ['insights-companies', tenantId, filters, currentYear],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_company_table', {
        p_tenant_id: tenantId,
        p_property: filters.property,
        p_current_year: currentYear,
        p_previous_year: previousYear,
        p_channel: filters.channel,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: open && !!tenantId,
  });

  const { data: channelData } = useQuery({
    queryKey: ['insights-channels', tenantId, filters, currentYear],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_channel_comparison', {
        p_tenant_id: tenantId,
        p_property: filters.property,
        p_current_year: currentYear,
        p_previous_year: previousYear,
        p_month: filters.month,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: open && !!tenantId,
  });

  const { data: cityData } = useQuery({
    queryKey: ['insights-cities', tenantId, filters, currentYear],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_guest_city_analytics', {
        p_tenant_id: tenantId,
        p_property: filters.property,
        p_year: currentYear,
        p_month: filters.month,
        p_channel: filters.channel,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: open && !!tenantId,
  });

  const { data: prevCityData } = useQuery({
    queryKey: ['insights-cities-prev', tenantId, filters, previousYear],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_guest_city_analytics', {
        p_tenant_id: tenantId,
        p_property: filters.property,
        p_year: previousYear,
        p_month: filters.month,
        p_channel: filters.channel,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: open && !!tenantId,
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
          `<strong>${toTitleCase(c.company_name)}</strong> (${formatPercent(c.pct_change)}, ${formatRevenue(c.absolute_change)})`
        ).join(', ');
        insights.push(`📈 <strong>Empresas com maior crescimento:</strong> ${items}`);
      }

      if (topDecline.length > 0 && topDecline[0].pct_change < 0) {
        const items = topDecline.filter((c: any) => c.pct_change < 0).map((c: any) =>
          `<strong>${toTitleCase(c.company_name)}</strong> (${formatPercent(c.pct_change)}, ${formatRevenue(c.absolute_change)})`
        ).join(', ');
        if (items) insights.push(`📉 <strong>Empresas com maior queda:</strong> ${items}`);
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
          `<strong>${toTitleCase(c.city)}</strong> (${c.pct > 0 ? '+' : ''}${c.pct.toFixed(1)}%, receita ${formatRevenue(c.revenue)})`
        ).join(', ');
        insights.push(`🏙️ <strong>Cidades com maior crescimento:</strong> ${items}`);
      }
    }

    if (channelData && channelData.length > 0) {
      const totalCurrent = channelData.reduce((s: number, c: any) => s + (c.revenue_current || 0), 0);
      if (totalCurrent > 0) {
        const channelShares = channelData.map((c: any) => {
          const share = ((c.revenue_current || 0) / totalCurrent * 100).toFixed(1);
          const change = c.pct_change !== null ? ` (var. ${formatPercent(c.pct_change)})` : '';
          return `<strong>${c.sales_channel}</strong>: ${share}%${change}`;
        }).join(' · ');
        insights.push(`📊 <strong>Distribuição por canal:</strong> ${channelShares}`);
      }
    }

    return insights.length > 0 ? insights : ['Sem dados suficientes para gerar insights.'];
  };

  return (
    <div>
      <Button variant="outline" size="sm" className="gap-2" onClick={() => setOpen(!open)}>
        <Lightbulb className="h-4 w-4" />
        Ver Insights Automáticos
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </Button>
      {open && (
        <div className="surface-card mt-3 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-primary" />
            Insights Automáticos — {currentYear} vs {previousYear}
          </h3>
          <div className="space-y-2">
            {generateInsights().map((insight, i) => (
              <p key={i} className="text-xs leading-relaxed text-foreground/90"
                 dangerouslySetInnerHTML={{ __html: insight }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AutoInsights;
