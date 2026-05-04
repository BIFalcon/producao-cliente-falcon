import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FiltersContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatRevenue, MONTH_NAMES } from '@/lib/formatters';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

const MonthlyChart = () => {
  const { filters } = useFilters();
  const { tenantId } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['monthly', tenantId, filters],
    enabled: !!tenantId,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_monthly_revenue', {
        p_tenant_id: tenantId,
        p_property: filters.property,
        p_year: null,
        p_channel: filters.channel,
      });
      if (error) throw error;
      return data || [];
    },
  });

  if (isLoading) {
    return <div className="surface-card animate-pulse h-64 p-6" />;
  }

  // Group by month, separate years
  const years: number[] = Array.from(new Set<number>(((data ?? []) as any[]).map((d) => d.year as number))).sort();
  const chartData = MONTH_NAMES.map((name, idx) => {
    const entry: any = { month: name };
    years.forEach(y => {
      const row = data?.find(d => d.month === idx + 1 && d.year === y);
      entry[`rev_${y}`] = row?.revenue || 0;
    });
    return entry;
  });

  const yearColors = ['hsl(200, 80%, 55%)', 'hsl(270, 60%, 50%)', 'hsl(150, 60%, 45%)'];

  return (
    <div className="surface-card p-6">
      <h3 className="mb-4 text-sm font-semibold text-foreground">Comparação Mensal de Receita</h3>
      {data && data.length > 0 ? (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="month" tick={{ fill: 'hsl(220, 10%, 50%)', fontSize: 11 }} />
            <YAxis tickFormatter={(v) => formatRevenue(v)} tick={{ fill: 'hsl(220, 10%, 50%)', fontSize: 11 }} />
            <Tooltip
              formatter={(value: number, name: string) => [formatRevenue(value), name.replace('rev_', '')]}
              contentStyle={{ background: 'hsl(230, 18%, 14%)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
              labelStyle={{ color: 'hsl(220, 15%, 85%)' }}
            />
            <Legend formatter={(value) => value.replace('rev_', '')} />
            {years.map((y, i) => (
              <Bar key={y} dataKey={`rev_${y}`} fill={yearColors[i % yearColors.length]} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          Sem dados disponíveis
        </div>
      )}
    </div>
  );
};

export default MonthlyChart;
