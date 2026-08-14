import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useFilters } from '@/contexts/FiltersContext';
import AppHeader from '@/components/AppHeader';
import CrmNav from '@/components/crm/CrmNav';
import { STAGE_COLORS, STAGE_LABELS, STAGE_DESCRIPTIONS, STAGE_ORDER, CrmAccountStage, formatDateBR, daysBetween } from '@/lib/crm';
import { accountMatchesHotels } from '@/hooks/useCrmUsers';
import { Users, CalendarClock, TrendingUp, AlertTriangle, MessageSquare, ChevronRight } from 'lucide-react';

const CrmDashboardPage = () => {
  const { tenantId } = useAuth();
  const { filters } = useFilters();
  const navigate = useNavigate();

  const { data: accountsRaw } = useQuery({
    queryKey: ['crm-accounts-dash', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from('crm_accounts') as any)
        .select('id, stage, account_status, account_type, company_name, travel_agent_name, properties')
        .eq('tenant_id', tenantId!);
      if (error) throw error;
      return data as any[];
    },
  });

  const accounts = useMemo(
    () => (accountsRaw ?? []).filter((a) => accountMatchesHotels(a, filters.property)),
    [accountsRaw, filters.property],
  );
  const accountIds = useMemo(() => new Set(accounts.map((a) => a.id)), [accounts]);

  const today = new Date().toISOString().slice(0, 10);
  const { data: pendingRaw } = useQuery({
    queryKey: ['crm-follow-ups-dash', tenantId, today],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from('crm_visits') as any)
        .select('id, next_follow_up_date, account_id, crm_accounts(company_name, travel_agent_name, account_type, properties)')
        .eq('tenant_id', tenantId!)
        .not('next_follow_up_date', 'is', null)
        .lte('next_follow_up_date', today)
        .order('next_follow_up_date', { ascending: true })
        .limit(50);
      if (error) throw error;
      return data as any[];
    },
  });

  const pending = useMemo(
    () => (pendingRaw ?? []).filter((f) => accountMatchesHotels(f.crm_accounts || {}, filters.property)),
    [pendingRaw, filters.property],
  );

  const { data: visits } = useQuery({
    queryKey: ['crm-visits-count-dash', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from('crm_visits') as any)
        .select('id, account_id')
        .eq('tenant_id', tenantId!)
        .limit(5000);
      if (error) throw error;
      return data as any[];
    },
  });

  const totalVisits = useMemo(() => {
    if (!visits) return 0;
    if (filters.property.length === 0) return visits.length;
    return visits.filter((v) => accountIds.has(v.account_id)).length;
  }, [visits, filters.property, accountIds]);

  const byStage = accounts.reduce<Record<string, number>>((acc, a) => {
    acc[a.stage] = (acc[a.stage] ?? 0) + 1;
    return acc;
  }, {});
  const total = accounts.length;
  const ativos = accounts.filter((a) => a.account_status === 'ativo').length;
  const negociando = byStage['negociacao'] || 0;

  const cards = [
    { label: 'Total de Contas', value: total, icon: Users, color: 'text-primary', to: '/comercial/contas', hint: 'Ver todas as contas' },
    { label: 'Clientes Ativos', value: ativos, icon: TrendingUp, color: 'text-accent', to: '/comercial/contas?status=ativo', hint: 'Status da Conta = Ativo' },
    { label: 'Em Negociação', value: negociando, icon: CalendarClock, color: 'text-primary', to: '/comercial/contas?stage=negociacao', hint: 'Ver contas em negociação' },
    { label: 'Total de Interações', value: totalVisits, icon: MessageSquare, color: 'text-accent', to: '/comercial/interacoes', hint: 'Ver todas as interações' },
    { label: 'Follow-ups Atrasados', value: pending?.length || 0, icon: AlertTriangle, color: 'text-destructive', to: '/comercial/interacoes', hint: 'Ver interações com follow-up' },
  ];

  return (
    <div className="min-h-screen bg-background pl-14">
      <AppHeader />
      <div className="space-y-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Dashboard Comercial</h1>
            <p className="text-xs text-muted-foreground">Visão geral do funil e follow-ups pendentes</p>
          </div>
          <CrmNav />
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {cards.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => navigate(c.to)}
              title={c.hint}
              className="surface-card group px-4 py-3 text-left transition hover:border-primary/40 hover:bg-secondary/30"
            >
              <div className="mb-1 flex items-center gap-2">
                <c.icon className={`h-4 w-4 ${c.color}`} />
                <span className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</span>
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
              </div>
              <div className="font-mono text-2xl font-bold">{c.value}</div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{c.hint}</p>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="surface-card p-6">
            <h3 className="text-sm font-semibold">Funil de Conquista</h3>
            <p className="mb-4 text-xs text-muted-foreground">7 etapas, da prospecção ao fechamento — clique para ver as contas</p>
            <div className="space-y-3">
              {STAGE_ORDER.map((s, idx) => {
                const count = byStage[s] || 0;
                const pct = total > 0 ? (count / total) * 100 : 0;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => navigate(`/comercial/contas?stage=${s}`)}
                    className="w-full rounded-md p-1 text-left transition hover:bg-secondary/40"
                  >
                    <div className="mb-1 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono text-[10px] text-muted-foreground">{idx + 1}</span>
                          <span className="font-medium text-foreground">{STAGE_LABELS[s]}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground">{STAGE_DESCRIPTIONS[s]}</p>
                      </div>
                      <span className="shrink-0 font-mono text-xs text-foreground/70">{count} ({pct.toFixed(0)}%)</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full transition-all"
                           style={{ width: `${pct}%`, background: STAGE_COLORS[s] }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="surface-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Follow-ups Pendentes</h3>
              <Link to="/comercial/interacoes" className="text-xs text-primary hover:underline">Ver interações →</Link>
            </div>
            {pending && pending.length > 0 ? (
              <div className="max-h-[280px] space-y-2 overflow-y-auto">
                {pending.map((f: any) => {
                  const name = f.crm_accounts?.account_type === 'agencia'
                    ? f.crm_accounts?.travel_agent_name
                    : f.crm_accounts?.company_name;
                  const overdue = daysBetween(f.next_follow_up_date) || 0;
                  return (
                    <Link to={`/comercial/contas/${f.account_id}`} key={f.id}
                          className="flex items-center justify-between rounded-md border border-border/40 px-3 py-2 transition hover:bg-secondary/50">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-foreground">{name || 'Sem nome'}</div>
                        <div className="text-xs text-muted-foreground">Previsto: {formatDateBR(f.next_follow_up_date)}</div>
                      </div>
                      <span className={`font-mono text-xs ${overdue > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
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
