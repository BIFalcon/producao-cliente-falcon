import React, { useState } from 'react';
import AppHeader from '@/components/AppHeader';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { KeyRound, Loader2 } from 'lucide-react';

const ProfilePage = () => {
  const { user, role } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error('A senha deve ter no mínimo 6 caracteres');
      return;
    }
    if (password !== confirm) {
      toast.error('As senhas não coincidem');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success('Senha alterada com sucesso');
      setPassword('');
      setConfirm('');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao alterar senha');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="p-4 lg:p-6 space-y-4">
        <div className="surface-card p-6 max-w-xl">
          <h1 className="text-lg font-semibold text-foreground mb-4">Meu perfil</h1>
          <div className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">E-mail: </span><span className="text-foreground">{user?.email}</span></div>
            <div><span className="text-muted-foreground">Função: </span><span className="text-foreground">{role || '—'}</span></div>
          </div>
        </div>

        <div className="surface-card p-6 max-w-xl">
          <h2 className="text-base font-semibold text-foreground mb-1 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            Alterar senha
          </h2>
          <p className="text-xs text-muted-foreground mb-4">Defina uma nova senha para sua conta.</p>
          <form onSubmit={handleChangePassword} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="new-password">Nova senha</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                minLength={6}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirmar nova senha</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repita a nova senha"
                minLength={6}
                required
              />
            </div>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar nova senha
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
