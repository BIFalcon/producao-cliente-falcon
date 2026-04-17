import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Building2, Plus, ArrowLeft, Loader2, Power } from 'lucide-react';
import falconLogo from '@/assets/falcon-logo.png';

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  user_count: number;
};

const TenantsPage = () => {
  const { isSuperAdmin, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');

  const { data: tenants, isLoading } = useQuery({
    queryKey: ['all-tenants'],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_all_tenants');
      if (error) throw error;
      return (data || []) as TenantRow[];
    },
    enabled: isSuperAdmin,
  });

  const callManageTenants = async (body: any) => {
    const { data, error } = await supabase.functions.invoke('manage-tenants', { body });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const createMutation = useMutation({
    mutationFn: (params: { name: string; slug: string }) =>
      callManageTenants({ action: 'create', ...params }),
    onSuccess: () => {
      toast.success('Tenant criado');
      queryClient.invalidateQueries({ queryKey: ['all-tenants'] });
      setCreateOpen(false);
      setFormName('');
      setFormSlug('');
    },
    onError: (err: any) => toast.error(err.message || 'Erro ao criar tenant'),
  });

  const toggleMutation = useMutation({
    mutationFn: (params: { tenant_id: string; is_active: boolean }) =>
      callManageTenants({ action: 'toggle_active', ...params }),
    onSuccess: () => {
      toast.success('Status atualizado');
      queryClient.invalidateQueries({ queryKey: ['all-tenants'] });
    },
    onError: (err: any) => toast.error(err.message || 'Erro ao atualizar status'),
  });

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <p className="text-destructive text-sm">Acesso restrito a Super Admin.</p>
          <Button variant="outline" size="sm" onClick={() => navigate('/')}>Voltar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <div className="flex h-14 items-center justify-between px-4 lg:px-6">
          <img src={falconLogo} alt="Falcon" className="h-8 w-auto" />
          <Button variant="ghost" size="sm" onClick={signOut} className="h-8 text-xs text-muted-foreground">Sair</Button>
        </div>
      </header>

      <div className="p-4 lg:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                Gestão de Tenants
              </h1>
              <p className="text-xs text-muted-foreground">{tenants?.length || 0} tenants cadastrados</p>
            </div>
          </div>

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Novo Tenant
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Criar Novo Tenant</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  createMutation.mutate({ name: formName, slug: formSlug });
                }}
              >
                <div className="space-y-2">
                  <Label>Nome</Label>
                  <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Ex: Falcon - Sudeste" required />
                </div>
                <div className="space-y-2">
                  <Label>Slug</Label>
                  <Input
                    value={formSlug}
                    onChange={(e) => setFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                    placeholder="falcon-sudeste"
                    required
                  />
                  <p className="text-xs text-muted-foreground">Identificador único, apenas letras minúsculas, números e hífens.</p>
                </div>
                <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                  {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Criar Tenant
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Nome</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Slug</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Usuários</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></td></tr>
                ) : tenants && tenants.length > 0 ? (
                  tenants.map((t) => (
                    <tr key={t.id} className="border-b hover:bg-secondary/20" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                      <td className="px-4 py-3 text-foreground font-medium">{t.name}</td>
                      <td className="px-4 py-3 text-foreground/70 font-mono text-xs">{t.slug}</td>
                      <td className="px-4 py-3 text-foreground/80">{t.user_count}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={t.is_active ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-destructive/30 bg-destructive/10 text-destructive'}>
                          {t.is_active ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`h-7 gap-1 text-xs ${t.is_active ? 'text-destructive' : 'text-emerald-400'}`}
                          onClick={() => toggleMutation.mutate({ tenant_id: t.id, is_active: !t.is_active })}
                        >
                          <Power className="h-3 w-3" />
                          {t.is_active ? 'Desativar' : 'Ativar'}
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Nenhum tenant cadastrado</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TenantsPage;
