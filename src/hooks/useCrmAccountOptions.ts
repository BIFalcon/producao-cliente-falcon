import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface CrmAccountOption {
  id: string;
  account_type: string;
  company_name: string | null;
  travel_agent_name: string | null;
  properties: string[] | null;
}

/** Lista enxuta de contas do tenant para vincular atividades */
export const useCrmAccountOptions = () => {
  const { tenantId } = useAuth();
  return useQuery({
    queryKey: ['crm-account-options', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from('crm_accounts') as any)
        .select('id, account_type, company_name, travel_agent_name, properties')
        .eq('tenant_id', tenantId!)
        .order('company_name', { ascending: true });
      if (error) throw error;
      return (data || []) as CrmAccountOption[];
    },
  });
};
