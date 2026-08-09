import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import AppHeader from '@/components/AppHeader';
import { STAGE_COLORS, STAGE_LABELS, STAGE_DESCRIPTIONS, STAGE_ORDER, CrmAccountStage, formatDateBR, daysBetween } from '@/lib/crm';
import { Users, CalendarClock, TrendingUp, AlertTriangle } from 'lucide-react';

const CrmDashboardPage = () => {
  const { tenantId } = useAuth();

  const { data: accounts } = useQuery({
    queryKey: ['crm-accounts-dash', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from('crm_accounts') as any)
        .select('id, stage, account_status, account_type, company_name, travel_agent_name')
        .eq('tenant_id', tenantId!);
      if (error) throw error;
      return data as any[];
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const { data: pending } = useQuery({
    queryKey: ['crm-follow-ups-dash', tenantId, today],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from('crm_visits') as any)
        .select('id, next_follow_up_date, account_id, crm_accounts(company_name, travel_agent_name, account_type)')
        .eq('tenant_id', tenantId!)
        .not('next_follow_up_date', 'is', null)
        .lte('next_follow_up_date', today)
        .order('next_follow_up_date', { ascending: true })
        .limit(50);
      if (error) throw error;
      return data as any[];
    },
  });

  const byStage = (accounts ?? []).reduce<Record<string, number>>((acc, a) => {
    acc[a.stage] = (acc[a.stage] ?? 0) + 1;
    return acc;
  }, {});
  const total = accounts?.length || 0;
  const ativos = (accounts ?? []).filter((a) => a.account_status === 'ativo').length;
  const negociando = byStage['negociacao'] || 0;

  return (
    <div className="min-h-screen bg-background pl-14">
      <AppHeader />
      <div className="space-y-4 p-4 lg:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Dashboard Comercial</h1>
            <p className="text-xs text-muted-foreground">Visão geral do funil e follow-ups pendentes</p>
          </div>
          <Link to="/comercial/contas" className="text-xs text-primary hover:underline">Ver todas as contas →</Link>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="surface-card px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Total de Contas</span>
            </div>
            <div className="text-2xl font-bold font-mono">{total}</div>
          </div>
          <div className="surface-card px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-accent" />
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Clientes Ativos</span>
            </div>
            <div className="text-2xl font-bold font-mono">{ativos}</div>
          </div>
          <div className="surface-card px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <CalendarClock className="h-4 w-4 text-primary" />
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Em Negociação</span>
            </div>
            <div className="text-2xl font-bold font-mono">{negociando}</div>
          </div>
          <div className="surface-card px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Follow-ups Atrasados</span>
            </div>
            <div className="text-2xl font-bold font-mono">{pending?.length || 0}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="surface-card p-6">
            <h3 className="mb-4 text-sm font-semibold">Funil por Estágio</h3>
            <div className="space-y-2">
              {STAGE_ORDER.map((s) => {
                const count = byStage[s] || 0;
                const pct = total > 0 ? (count / total) * 100 : 0;
                return (
                  <div key={s}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-foreground">{STAGE_LABELS[s as CrmAccountStage]}</span>
                      <span className="text-muted-foreground font-mono">{count} ({pct.toFixed(0)}%)</span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary overflow-hidden">
                      <div className="h-full rounded-full transition-all"
                           style={{ width: `${pct}%`, background: STAGE_COLORS[s as CrmAccountStage] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="surface-card p-6">
            <h3 className="mb-4 text-sm font-semibold">Follow-ups Pendentes</h3>
            {pending && pending.length > 0 ? (
              <div className="space-y-2 max-h-[280px] overflow-y-auto">
                {pending.map((f: any) => {
                  const name = f.crm_accounts?.account_type === 'agencia'
                    ? f.crm_accounts?.travel_agent_name
                    : f.crm_accounts?.company_name;
                  const overdue = daysBetween(f.next_follow_up_date) || 0;
                  return (
                    <Link to={`/comercial/contas/${f.account_id}`} key={f.id}
                          className="flex items-center justify-between rounded-md border border-border/40 px-3 py-2 hover:bg-secondary/50 transition">
                      <div className="min-w-0">
                        <div className="text-sm text-foreground truncate">{name || 'Sem nome'}</div>
                        <div className="text-xs text-muted-foreground">Previsto: {formatDateBR(f.next_follow_up_date)}</div>
                      </div>
                      <span className={`text-xs font-mono ${overdue > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {overdue > 0 ? `${overdue}d atrasado` : 'hoje'}
                      </span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum follow-up pendente 🎉</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CrmDashboardPage;
