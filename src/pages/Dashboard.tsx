import React from 'react';
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
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const DashboardContent = () => {
  const { role, tenantId } = useAuth();

  const { data: hasData } = useQuery({
    queryKey: ['has-data', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { count } = await supabase
        .from('processed_reservations')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId!);
      return (count || 0) > 0;
    },
  });

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
    <div className="min-h-screen bg-background">
      <AppHeader />
      <DashboardContent />
    </div>
  );
};

export default Dashboard;
