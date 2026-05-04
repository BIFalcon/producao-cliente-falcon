import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FiltersContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatRevenue, formatPercent, toTitleCase } from '@/lib/formatters';
import { Lightbulb, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Render text with **bold** markers as JSX (no dangerouslySetInnerHTML)
const renderRichText = (text: string): React.ReactNode => {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
};

const InsightLine: React.FC<{ text: string }> = ({ text }) => (
  <p className="text-xs leading-relaxed text-foreground/90">{renderRichText(text)}</p>
);

const InsightSkeleton: React.FC = () => (
  <div className="h-3 rounded bg-muted/40 animate-pulse" />
);

const InsightUnavailable: React.FC<{ label: string }> = ({ label }) => (
  <p className="text-xs leading-relaxed text-muted-foreground/70 italic">
    {label}: Dados indisponíveis
  </p>
);

const AutoInsights = () => {
  const [open, setOpen] = useState(false);
  const { filters, currentYear, previousYear } = useFilters();
  const { tenantId } = useAuth();

  // ── Companies (growth/decline) ─────────────────────────────
  const companiesQ = useQuery({
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
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 5 * 60 * 1000,
  });

  // ── Channel distribution ──────────────────────────────────
  const channelQ = useQuery({
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
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 5 * 60 * 1000,
  });

  // ── City current ──────────────────────────────────────────
  const cityQ = useQuery({
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
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 5 * 60 * 1000,
  });

  // ── City previous ─────────────────────────────────────────
  const prevCityQ = useQuery({
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
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 5 * 60 * 1000,
  });

  // ─── Builders for each insight (return array of plain strings using **bold**) ───
  const buildCompanyInsights = (companyData: any[]): string[] => {
    const insights: string[] = [];
    if (!companyData || companyData.length === 0) return insights;
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
    return insights;
  };

  const buildCityInsights = (cityData: any[], prevCityData: any[]): string[] => {
    if (!cityData || !prevCityData) return [];
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
    if (cityGrowth.length === 0) return [];
    const items = cityGrowth.map((c: any) =>
      `**${toTitleCase(c.city)}** (${c.pct > 0 ? '+' : ''}${c.pct.toFixed(1)}%, receita ${formatRevenue(c.revenue)})`
    ).join(', ');
    return [`🏙️ **Cidades com maior crescimento:** ${items}`];
  };

  const buildChannelInsights = (channelData: any[]): string[] => {
    if (!channelData || channelData.length === 0) return [];
    const totalCurrent = channelData.reduce((s: number, c: any) => s + (c.revenue_current || 0), 0);
    if (totalCurrent <= 0) return [];
    const channelShares = channelData.map((c: any) => {
      const share = ((c.revenue_current || 0) / totalCurrent * 100).toFixed(1);
      const change = c.pct_change !== null ? ` (var. ${formatPercent(c.pct_change)})` : '';
      return `**${c.sales_channel}**: ${share}%${change}`;
    }).join(' · ');
    return [`📊 **Distribuição por canal:** ${channelShares}`];
  };

  // City insights need both queries successful
  const cityReady = cityQ.isSuccess && prevCityQ.isSuccess;
  const cityFailed = cityQ.isError || prevCityQ.isError;
  const cityLoading = !cityReady && !cityFailed;

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
            {/* Companies */}
            {companiesQ.isLoading ? (
              <InsightSkeleton />
            ) : companiesQ.isError ? (
              <InsightUnavailable label="Empresas" />
            ) : (
              buildCompanyInsights(companiesQ.data).map((t, i) => <InsightLine key={`co-${i}`} text={t} />)
            )}

            {/* Cities (depends on 2 queries) */}
            {cityLoading ? (
              <InsightSkeleton />
            ) : cityFailed ? (
              <InsightUnavailable label="Cidades" />
            ) : (
              buildCityInsights(cityQ.data, prevCityQ.data).map((t, i) => <InsightLine key={`ci-${i}`} text={t} />)
            )}

            {/* Channels */}
            {channelQ.isLoading ? (
              <InsightSkeleton />
            ) : channelQ.isError ? (
              <InsightUnavailable label="Canais" />
            ) : (
              buildChannelInsights(channelQ.data).map((t, i) => <InsightLine key={`ch-${i}`} text={t} />)
            )}

            {/* No insights at all */}
            {!companiesQ.isLoading && !cityLoading && !channelQ.isLoading &&
              !companiesQ.isError && !cityFailed && !channelQ.isError &&
              buildCompanyInsights(companiesQ.data).length === 0 &&
              buildCityInsights(cityQ.data || [], prevCityQ.data || []).length === 0 &&
              buildChannelInsights(channelQ.data).length === 0 && (
                <p className="text-xs text-muted-foreground">Sem dados suficientes para gerar insights.</p>
              )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AutoInsights;
