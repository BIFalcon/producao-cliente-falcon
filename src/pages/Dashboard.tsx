import React, { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import AppHeader from '@/components/AppHeader';
import KPICards from '@/components/dashboard/KPICards';

import ChannelComparison from '@/components/dashboard/ChannelComparison';
import CompanyTable from '@/components/dashboard/CompanyTable';
import AgentAnalysis from '@/components/dashboard/AgentAnalysis';
import GuestCityAnalysis from '@/components/dashboard/GuestCityAnalysis';
import CompanyCityAnalysis from '@/components/dashboard/CompanyCityAnalysis';
import AutoInsights from '@/components/dashboard/AutoInsights';

import { Button } from '@/components/ui/button';
import { Database } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const DashboardContent = () => {
  const { role, tenantId } = useAuth();
  const queryClient = useQueryClient();

  const { data: hasData, isLoading: hasDataLoading } = useQuery({
    queryKey: ['has-data', tenantId],
    enabled: !!tenantId,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('processed_reservations')
        .select('id')
        .eq('tenant_id', tenantId!)
        .limit(1);
      if (error) throw error;
      return (data?.length || 0) > 0;
    },
  });

  useEffect(() => {
    if (!tenantId) return;

    const channel = supabase
      .channel(`dashboard-upload-batches-${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'upload_batches',
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          const status = (payload.new as { status?: string } | null)?.status;
          if (status === 'completed') {
            queryClient.setQueryData(['has-data', tenantId], true);
            queryClient.invalidateQueries({
              predicate: (query) => query.queryKey.includes(tenantId),
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, tenantId]);

  // Enquanto carrega ou tenant não selecionado: silêncio total
  if (!tenantId || hasDataLoading || hasData === undefined) {
    return null;
  }

  if (hasData === false) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <Database className="h-12 w-12 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Nenhum dado importado</p>
        {(role === 'master_admin' || role === 'editor') && (
          <Button asChild>
            <a href="/upload">Importar Base de Dados</a>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <KPICards />

      

      <AutoInsights />

      <ChannelComparison />

      <CompanyTable />

      <AgentAnalysis />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GuestCityAnalysis />
        <CompanyCityAnalysis />
      </div>


    </div>
  );
};

const Dashboard = () => {
  return (
    <div className="min-h-screen bg-background pl-14">
      <AppHeader />
      <DashboardContent />
    </div>
  );
};

export default Dashboard;
