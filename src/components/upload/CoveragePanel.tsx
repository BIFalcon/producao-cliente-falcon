import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

const fmt = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—');

export const CoveragePanel: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['upload-coverage', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_upload_coverage', { p_tenant_id: tenantId });
      if (error) throw error;
      return (data || []) as Array<{
        property_name: string; reservas_mes_atual: number; reservas_mes_anterior: number;
        primeira_saida: string | null; ultima_saida: string | null;
        dias_sem_saida_mes_atual: number[]; dias_sem_saida_mes_anterior: number[];
      }>;
    },
  });

  const days = (arr: number[]) => (arr && arr.length ? arr.join(', ') : 'nenhum');

  return (
    <div>
      <h2 className="mb-3 text-sm font-medium text-foreground flex items-center gap-2">
        <CalendarCheck className="h-4 w-4 text-primary" /> Cobertura da base por hotel
      </h2>
      <div className="surface-card overflow-hidden">
        <div className="overflow-auto" style={{ maxHeight: 320 }}>
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background z-10">
              <tr className="text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Hotel</th>
                <th className="px-3 py-2 text-right font-medium">Reservas mês atual</th>
                <th className="px-3 py-2 text-right font-medium">Reservas mês anterior</th>
                <th className="px-3 py-2 text-left font-medium">1ª saída</th>
                <th className="px-3 py-2 text-left font-medium">Última saída</th>
                <th className="px-3 py-2 text-left font-medium">Dias sem saída (mês atual, até ontem)</th>
                <th className="px-3 py-2 text-left font-medium">Dias sem saída (mês anterior)</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="px-3 py-6 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" /></td></tr>
              ) : error ? (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-destructive">Não foi possível carregar a cobertura.</td></tr>
              ) : data && data.length ? data.map((r) => (
                <tr key={r.property_name} className="border-t border-border/40">
                  <td className="px-3 py-2 text-foreground capitalize">{r.property_name}</td>
                  <td className="px-3 py-2 text-right font-mono">{Number(r.reservas_mes_atual).toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-2 text-right font-mono">{Number(r.reservas_mes_anterior).toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-2">{fmt(r.primeira_saida)}</td>
                  <td className="px-3 py-2">{fmt(r.ultima_saida)}</td>
                  <td className={`px-3 py-2 ${r.dias_sem_saida_mes_atual?.length ? 'text-destructive' : 'text-muted-foreground'}`}>{days(r.dias_sem_saida_mes_atual)}</td>
                  <td className={`px-3 py-2 ${r.dias_sem_saida_mes_anterior?.length ? 'text-destructive' : 'text-muted-foreground'}`}>{days(r.dias_sem_saida_mes_anterior)}</td>
                </tr>
              )) : (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Sem dados processados</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
