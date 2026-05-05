import React from 'react';
import AppHeader from '@/components/AppHeader';
import { useAuth } from '@/contexts/AuthContext';

const ProfilePage = () => {
  const { user, role } = useAuth();
  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="p-4 lg:p-6">
        <div className="surface-card p-6 max-w-xl">
          <h1 className="text-lg font-semibold text-foreground mb-4">Meu perfil</h1>
          <div className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">E-mail: </span><span className="text-foreground">{user?.email}</span></div>
            <div><span className="text-muted-foreground">Função: </span><span className="text-foreground">{role || '—'}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
