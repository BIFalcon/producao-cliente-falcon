import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import AppHeader from '@/components/AppHeader';
import { FiltersProvider } from '@/contexts/FiltersContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { UserPlus, Shield, Edit2, UserX, UserCheck, ArrowLeft, Loader2, Hotel, Trash2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type UserRow = {
  user_id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
  hotel_permissions: string[];
};

const ROLE_LABELS: Record<string, string> = {
  master_admin: 'Master Admin',
  editor: 'Editor',
  viewer: 'Comercial',
  gerente_geral: 'Gerente Geral',
};

const ROLE_COLORS: Record<string, string> = {
  master_admin: 'bg-primary/20 text-primary border-primary/30',
  editor: 'bg-accent/20 text-accent-foreground border-accent/30',
  viewer: 'bg-muted text-muted-foreground border-border',
  gerente_geral: 'bg-secondary text-secondary-foreground border-border',
};

const UsersPage = () => {
  const { role, user, loading: authLoading, roleLoading, isSuperAdmin, tenantId } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [hotelEditUser, setHotelEditUser] = useState<UserRow | null>(null);
  const [deleteUser, setDeleteUser] = useState<UserRow | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState('viewer');
  const [formHotels, setFormHotels] = useState<string[]>([]);

  // Available properties from database
  const { data: allProperties } = useQuery({
    queryKey: ['all-properties', tenantId],
    queryFn: async () => {
      const { data } = await (supabase.rpc as any)('get_filter_options', { p_tenant_id: tenantId });
      return data?.[0]?.properties || [];
    },
    enabled: (role === 'master_admin' || isSuperAdmin) && !!tenantId,
  });

  const { data: users, isLoading } = useQuery({
    queryKey: ['all-users', tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_all_users', { p_tenant_id: tenantId });
      if (error) throw error;
      return (data || []) as UserRow[];
    },
    enabled: (role === 'master_admin' || isSuperAdmin) && !!tenantId,
  });

  const resetForm = () => {
    setFormName('');
    setFormEmail('');
    setFormPassword('');
    setFormRole('viewer');
    setFormHotels([]);
  };

  const callManageUsers = async (body: any) => {
    const { data, error } = await supabase.functions.invoke('manage-users', {
      body: isSuperAdmin ? { ...body, target_tenant_id: tenantId } : body,
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const createMutation = useMutation({
    mutationFn: (params: { email: string; password: string; full_name: string; role: string; hotel_permissions: string[] }) =>
      callManageUsers({ action: 'create', ...params }),
    onSuccess: () => {
      toast.success('Usuário criado com sucesso');
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
      setCreateOpen(false);
      resetForm();
    },
    onError: (err: any) => toast.error(err.message || 'Erro ao criar usuário'),
  });

  const updateRoleMutation = useMutation({
    mutationFn: (params: { target_user_id: string; role: string }) =>
      callManageUsers({ action: 'update_role', ...params }),
    onSuccess: () => {
      toast.success('Função atualizada');
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
      setEditUser(null);
    },
    onError: (err: any) => toast.error(err.message || 'Erro ao atualizar'),
  });

  const updateHotelsMutation = useMutation({
    mutationFn: (params: { target_user_id: string; hotel_permissions: string[] }) =>
      callManageUsers({ action: 'update_hotel_permissions', ...params }),
    onSuccess: () => {
      toast.success('Permissões de hotel atualizadas');
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
      setHotelEditUser(null);
    },
    onError: (err: any) => toast.error(err.message || 'Erro ao atualizar permissões'),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (params: { target_user_id: string; is_active: boolean }) =>
      callManageUsers({ action: 'toggle_active', ...params }),
    onSuccess: () => {
      toast.success('Status atualizado');
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
    },
    onError: (err: any) => toast.error(err.message || 'Erro ao atualizar status'),
  });

  const deleteMutation = useMutation({
    mutationFn: (params: { target_user_id: string }) =>
      callManageUsers({ action: 'delete', ...params }),
    onSuccess: () => {
      toast.success('Usuário excluído');
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
      setDeleteUser(null);
    },
    onError: (err: any) => toast.error(err.message || 'Erro ao excluir usuário'),
  });

  const toggleHotel = (hotel: string) => {
    setFormHotels(prev => prev.includes(hotel) ? prev.filter(h => h !== hotel) : [...prev, hotel]);
  };

  if (authLoading || roleLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
      </div>
    );
  }

  if (!isSuperAdmin && role !== 'master_admin') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <p className="text-destructive text-sm">Acesso restrito a Master Admin.</p>
          <Button variant="outline" size="sm" onClick={() => navigate('/')}>Voltar</Button>
        </div>
      </div>
    );
  }

  return (
    <FiltersProvider>
      <div className="min-h-screen bg-background pl-14">
        <AppHeader />
        <div className="p-4 lg:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  Gestão de Usuários
                </h1>
                <p className="text-xs text-muted-foreground">{users?.length || 0} usuários cadastrados</p>
              </div>
            </div>

            <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetForm(); }}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2">
                  <UserPlus className="h-4 w-4" />
                  Criar Usuário
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Criar Novo Usuário</DialogTitle>
                </DialogHeader>
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    createMutation.mutate({ email: formEmail, password: formPassword, full_name: formName, role: formRole, hotel_permissions: formHotels });
                  }}
                >
                  <div className="space-y-2">
                    <Label>Nome</Label>
                    <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Nome completo" required />
                  </div>
                  <div className="space-y-2">
                    <Label>E-mail</Label>
                    <Input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} placeholder="email@exemplo.com" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Senha</Label>
                    <Input type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} placeholder="Mínimo 6 caracteres" required minLength={6} />
                  </div>
                  <div className="space-y-2">
                    <Label>Função</Label>
                    <Select value={formRole} onValueChange={setFormRole}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="master_admin">Master Admin</SelectItem>
                        <SelectItem value="editor">Editor</SelectItem>
                        <SelectItem value="viewer">Comercial</SelectItem>
                        <SelectItem value="gerente_geral">Gerente Geral</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {formRole !== 'master_admin' && allProperties && allProperties.length > 0 && (
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <Hotel className="h-4 w-4" />
                        Hotéis Permitidos
                      </Label>
                      <p className="text-xs text-muted-foreground">Selecione os hotéis que o usuário poderá acessar. Sem seleção = nenhum acesso.</p>
                      <div className="space-y-2 max-h-40 overflow-y-auto border rounded-md p-3" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                        {allProperties.map((prop: string) => (
                          <label key={prop} className="flex items-center gap-2 cursor-pointer text-sm">
                            <Checkbox
                              checked={formHotels.includes(prop)}
                              onCheckedChange={() => toggleHotel(prop)}
                            />
                            <span className="text-foreground">{prop}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                    {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Criar Usuário
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          {/* Edit Role Dialog */}
          <Dialog open={!!editUser} onOpenChange={(o) => { if (!o) setEditUser(null); }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Editar Função — {editUser?.full_name || editUser?.email}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Nova Função</Label>
                  <Select value={formRole} onValueChange={setFormRole}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="master_admin">Master Admin</SelectItem>
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="viewer">Comercial</SelectItem>
                      <SelectItem value="gerente_geral">Gerente Geral</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full"
                  disabled={updateRoleMutation.isPending}
                  onClick={() => {
                    if (editUser) {
                      updateRoleMutation.mutate({ target_user_id: editUser.user_id, role: formRole });
                    }
                  }}
                >
                  {updateRoleMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Edit Hotel Permissions Dialog */}
          <Dialog open={!!hotelEditUser} onOpenChange={(o) => { if (!o) setHotelEditUser(null); }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Permissões de Hotel — {hotelEditUser?.full_name || hotelEditUser?.email}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">Selecione os hotéis que o usuário poderá visualizar.</p>
                {allProperties && allProperties.length > 0 ? (
                  <div className="space-y-2 max-h-60 overflow-y-auto border rounded-md p-3" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                    {allProperties.map((prop: string) => (
                      <label key={prop} className="flex items-center gap-2 cursor-pointer text-sm">
                        <Checkbox
                          checked={formHotels.includes(prop)}
                          onCheckedChange={() => toggleHotel(prop)}
                        />
                        <span className="text-foreground">{prop}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Nenhum hotel disponível. Importe dados primeiro.</p>
                )}
                <Button
                  className="w-full"
                  disabled={updateHotelsMutation.isPending}
                  onClick={() => {
                    if (hotelEditUser) {
                      updateHotelsMutation.mutate({ target_user_id: hotelEditUser.user_id, hotel_permissions: formHotels });
                    }
                  }}
                >
                  {updateHotelsMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar Permissões
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Delete User Dialog */}
          <AlertDialog open={!!deleteUser} onOpenChange={(o) => { if (!o) setDeleteUser(null); }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
                <AlertDialogDescription>
                  O usuário <strong>{deleteUser?.full_name || deleteUser?.email}</strong> será removido permanentemente,
                  junto com suas funções e permissões de hotel. Esta ação não pode ser desfeita.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={deleteMutation.isPending}
                  onClick={(e) => {
                    e.preventDefault();
                    if (deleteUser) deleteMutation.mutate({ target_user_id: deleteUser.user_id });
                  }}
                >
                  {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Excluir
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Users Table */}
          <div className="surface-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Nome</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">E-mail</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Função</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Hotéis</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></td></tr>
                  ) : users && users.length > 0 ? (
                    users.map((u) => (
                      <tr key={u.user_id} className="border-b transition-colors hover:bg-secondary/20" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                        <td className="px-4 py-3 text-foreground font-medium">{u.full_name || '—'}</td>
                        <td className="px-4 py-3 text-foreground/80">{u.email}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`text-[10px] ${ROLE_COLORS[u.role] || ROLE_COLORS.viewer}`}>
                            {ROLE_LABELS[u.role] || u.role}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          {u.role === 'master_admin' ? (
                            <span className="text-xs text-muted-foreground">Todos</span>
                          ) : u.hotel_permissions && u.hotel_permissions.length > 0 ? (
                            <span className="text-xs text-muted-foreground">{u.hotel_permissions.length} hotel(is)</span>
                          ) : (
                            <span className="text-xs text-destructive">Nenhum</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={u.is_active ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-destructive/30 bg-destructive/10 text-destructive'}>
                            {u.is_active ? 'Ativo' : 'Inativo'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              title="Editar função"
                              onClick={() => { setEditUser(u); setFormRole(u.role); }}
                            >
                              <Edit2 className="h-3 w-3" />
                            </Button>
                            {u.role !== 'master_admin' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                title="Permissões de hotel"
                                onClick={() => { setHotelEditUser(u); setFormHotels(u.hotel_permissions || []); }}
                              >
                                <Hotel className="h-3 w-3" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className={`h-7 w-7 p-0 ${u.is_active ? 'text-destructive' : 'text-emerald-400'}`}
                              title={u.is_active ? 'Desativar' : 'Ativar'}
                              disabled={u.user_id === user?.id}
                              onClick={() => toggleActiveMutation.mutate({ target_user_id: u.user_id, is_active: !u.is_active })}
                            >
                              {u.is_active ? <UserX className="h-3 w-3" /> : <UserCheck className="h-3 w-3" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive"
                              title="Excluir usuário"
                              disabled={u.user_id === user?.id}
                              onClick={() => setDeleteUser(u)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Nenhum usuário encontrado</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </FiltersProvider>
  );
};

export default UsersPage;
