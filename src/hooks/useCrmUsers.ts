import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface CrmUser {
  user_id: string;
  full_name: string;
  role: string | null;
  hotels: string[];
}

/** Tenant users + their hotel permissions (used for the "Executivo" filter) */
export const useCrmUsers = () => {
  const { tenantId } = useAuth();
  return useQuery({
    queryKey: ['crm-users-hotels', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_tenant_users_with_hotels', {
        p_tenant_id: tenantId,
      });
      if (error) throw error;
      return (data || []) as CrmUser[];
    },
  });
};

/** An account belongs to an executive when explicitly assigned OR when it serves one of the executive's hotels */
export const accountMatchesExecutive = (
  account: { responsible_user_id?: string | null; properties?: string[] | null },
  executive: CrmUser | undefined,
) => {
  if (!executive) return true;
  if (account.responsible_user_id === executive.user_id) return true;
  const props = account.properties || [];
  return executive.hotels.some((h) => props.includes(h));
};

/** Header hotel filter applied to CRM accounts */
export const accountMatchesHotels = (
  account: { properties?: string[] | null },
  selectedHotels: string[],
) => {
  if (!selectedHotels || selectedHotels.length === 0) return true;
  const props = account.properties || [];
  return props.some((p) => selectedHotels.includes(p));
};
