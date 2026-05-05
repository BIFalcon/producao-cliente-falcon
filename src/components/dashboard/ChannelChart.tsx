import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FiltersContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatRevenue } from '@/lib/formatters';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const ChannelChart = () => {
  const { filters } = useFilters();
  const { tenantId } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['channels', tenantId, filters],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_channel_analytics', {
        p_tenant_id: tenantId!,
        p_property: filters.property,
        p_year: filters.year,
      });
      if (error) throw error;
      return data || [];
    },
  });

  if (isLoading) {
    return <div className="surface-card animate-pulse h-64 p-6" />;
  }

  const channelColors: Record<string, string> = {
    'OTA': 'hsl(200, 80%, 55%)',
    'Operadoras': 'hsl(270, 60%, 50%)',
    'Empresas': 'hsl(150, 60%, 45%)',
    'Particular': 'hsl(40, 90%, 55%)',
    'Layover': 'hsl(350, 70%, 55%)',
    'Outros': 'hsl(220, 10%, 50%)',
  };

  return (
    <div className="surface-card p-6">
      <h3 className="mb-4 text-sm font-semibold text-foreground">Receita por Canal de Vendas</h3>
      {data && data.length > 0 ? (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} layout="vertical" margin={{ left: 80 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis type="number" tickFormatter={(v) => formatRevenue(v)} tick={{ fill: 'hsl(220, 10%, 50%)', fontSize: 11 }} />
            <YAxis type="category" dataKey="sales_channel" tick={{ fill: 'hsl(220, 15%, 75%)', fontSize: 12 }} width={80} />
            <Tooltip
              formatter={(value: number) => [formatRevenue(value), 'Receita']}
              contentStyle={{ background: 'hsl(230, 18%, 14%)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
              labelStyle={{ color: 'hsl(220, 15%, 85%)' }}
            />
            <Bar dataKey="revenue" radius={[0, 4, 4, 0]} fill="hsl(200, 80%, 55%)" />
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

export default ChannelChart;
