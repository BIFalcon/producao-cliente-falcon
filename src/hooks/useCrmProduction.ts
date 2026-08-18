import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface CrmAccountProduction {
  account_id: string;
  closed_at: string | null;
  first_checkin: string | null;
  last_checkin: string | null;
  reservations: number;
  revenue: number;
  roomnights: number;
}

/**
 * Cruzamento entre contas comerciais e produção real (processed_reservations).
 * Considera apenas check-ins a partir da data de fechamento da conta.
 */
export const useCrmProduction = () => {
  const { tenantId } = useAuth();
  return useQuery({
    queryKey: ['crm-production-map', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_crm_production', { p_tenant_id: tenantId });
      if (error) throw error;
      const map = new Map<string, CrmAccountProduction>();
      (data || []).forEach((r: any) => {
        map.set(r.account_id, {
          account_id: r.account_id,
          closed_at: r.closed_at,
          first_checkin: r.first_checkin,
          last_checkin: r.last_checkin,
          reservations: Number(r.reservations || 0),
          revenue: Number(r.revenue || 0),
          roomnights: Number(r.roomnights || 0),
        });
      });
      return map;
    },
  });
};
