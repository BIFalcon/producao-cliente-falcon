import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import AppHeader from '@/components/AppHeader';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

const TenantsPage = () => {
  const { isSuperAdmin, loading } = useAuth();

  const { data: tenants, isLoading } = useQuery({
    queryKey: ['all-tenants'],
    enabled: isSuperAdmin,
    queryFn: async () => {
      const { data } = await (supabase.rpc as any)('get_all_tenants');
      return (data || []) as { id: string; name: string; slug: string; is_active: boolean; created_at: string }[];
    },
  });

  if (loading) return null;
  if (!isSuperAdmin) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="p-4 lg:p-6">
        <div className="surface-card p-6">
          <h1 className="text-lg font-semibold text-foreground mb-4">Tenants</h1>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Nome</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Slug</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {(tenants || []).map((t) => (
                  <tr key={t.id} className="border-b" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                    <td className="px-3 py-2 text-foreground">{t.name}</td>
                    <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{t.slug}</td>
                    <td className="px-3 py-2 text-muted-foreground">{t.is_active ? 'Ativo' : 'Inativo'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default TenantsPage;
