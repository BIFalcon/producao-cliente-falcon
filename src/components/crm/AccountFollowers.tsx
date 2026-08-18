import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Eye, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  accountId: string;
  /** Only the responsible executive / admins may manage the follower list */
  canManage: boolean;
}

export const useAccountFollowers = (accountId?: string) => {
  const { tenantId } = useAuth();
  return useQuery({
    queryKey: ['crm-account-followers', accountId, tenantId],
    enabled: !!accountId && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from('crm_account_followers') as any)
        .select('id, user_id, created_by, created_at')
        .eq('account_id', accountId!);
      if (error) throw error;
      return (data || []) as { id: string; user_id: string; created_by: string | null }[];
    },
  });
};

const AccountFollowers: React.FC<Props> = ({ accountId, canManage }) => {
  const { tenantId } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string>('');

  const { data: followers } = useAccountFollowers(accountId);

  const { data: tenantUsers } = useQuery({
    queryKey: ['crm-tenant-users', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await (supabase.rpc as any)('get_tenant_users_basic', { p_tenant_id: tenantId });
      return (data || []) as { user_id: string; full_name: string }[];
    },
  });

  const nameOf = (userId: string) =>
    tenantUsers?.find((u) => u.user_id === userId)?.full_name || 'Usuário';

  const addFollower = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await (supabase.from('crm_account_followers') as any)
        .insert({ account_id: accountId, user_id: userId, tenant_id: tenantId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Seguidor adicionado');
      setSelected('');
      qc.invalidateQueries({ queryKey: ['crm-account-followers'] });
    },
    onError: (e: any) => toast.error(e.message || 'Erro ao adicionar seguidor'),
  });

  const removeFollower = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('crm_account_followers') as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Seguidor removido');
      qc.invalidateQueries({ queryKey: ['crm-account-followers'] });
    },
    onError: (e: any) => toast.error(e.message || 'Erro ao remover seguidor'),
  });

  const available = (tenantUsers || []).filter(
    (u) => !(followers || []).some((f) => f.user_id === u.user_id),
  );

  return (
    <div className="surface-card p-6">
      <div className="mb-1 flex items-center gap-2">
        <Eye className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Seguidores</h3>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Comerciais que acompanham esta conta e suas interações — apenas visualização, sem permissão de edição.
      </p>

      {followers && followers.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {followers.map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs text-foreground">
              {nameOf(f.user_id)}
              {canManage && (
                <button
                  type="button"
                  onClick={() => removeFollower.mutate(f.id)}
                  className="text-muted-foreground transition hover:text-destructive"
                  aria-label={`Remover ${nameOf(f.user_id)}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhum seguidor nesta conta.</p>
      )}

      {canManage && (
        <div className="mt-4 flex items-center gap-2">
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="Adicionar seguidor" /></SelectTrigger>
            <SelectContent>
              {available.length === 0 && <SelectItem value="none" disabled>Nenhum usuário disponível</SelectItem>}
              {available.map((u) => (
                <SelectItem key={u.user_id} value={u.user_id}>{u.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={!selected || addFollower.isPending} onClick={() => addFollower.mutate(selected)}>
            <UserPlus className="mr-1 h-4 w-4" /> Adicionar
          </Button>
        </div>
      )}
    </div>
  );
};

export default AccountFollowers;
