import React, { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import AppHeader from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Pencil, Plus, CalendarClock, TrendingUp, MapPin, Phone, Mail, MessageCircle, Building2, Eye, CheckCircle2, CircleDashed } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import AccountFormDialog from '@/components/crm/AccountFormDialog';
import VisitFormDialog from '@/components/crm/VisitFormDialog';
import AccountFollowers, { useAccountFollowers } from '@/components/crm/AccountFollowers';
import { useCrmProduction } from '@/hooks/useCrmProduction';
import { SUB_SEGMENT_LABELS, CrmAccountSubSegment } from '@/lib/crm';
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_STATUS_LABELS,
  ACCOUNT_STATUS_COLORS,
  STAGE_COLORS,
  STAGE_LABELS,
  STAGE_DESCRIPTIONS,
  VISIT_TYPE_LABELS,
  CrmAccountStage,
  CrmAccountStatus,
  CrmVisitType,
  formatDateBR,
  daysBetween,
} from '@/lib/crm';
import { formatRevenue, MONTH_NAMES } from '@/lib/formatters';

const visitIcon = (type: CrmVisitType) => {
  const cls = 'h-4 w-4';
  switch (type) {
    case 'visita_presencial': return <Building2 className={cls} />;
    case 'ligacao': return <Phone className={cls} />;
    case 'email': return <Mail className={cls} />;
    case 'whatsapp': return <MessageCircle className={cls} />;
    default: return <CalendarClock className={cls} />;
  }
};

const CrmAccountDetailPage = () => {
  const { id } = useParams();
  const { tenantId, user, role, isSuperAdmin } = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const [visitOpen, setVisitOpen] = useState(false);
  const [editVisit, setEditVisit] = useState<any | null>(null);

  const { data: account } = useQuery({
    queryKey: ['crm-account', id, tenantId],
    enabled: !!id && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from('crm_accounts') as any)
        .select('*')
        .eq('id', id!)
        .eq('tenant_id', tenantId!)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: tenantUsers } = useQuery({
    queryKey: ['crm-tenant-users', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await (supabase.rpc as any)('get_tenant_users_basic', { p_tenant_id: tenantId });
      return (data || []) as { user_id: string; full_name: string }[];
    },
  });

  const { data: visits } = useQuery({
    queryKey: ['crm-account-visits', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase.from('crm_visits') as any)
        .select('*')
        .eq('account_id', id!)
        .order('visit_date', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: production } = useQuery({
    queryKey: ['crm-account-production', account?.id, tenantId],
    enabled: !!account && !!tenantId,
    queryFn: async () => {
      const nameColumn = account!.account_type === 'empresa' ? 'company_name' : 'travel_agent_name';
      const nameValue = account!.account_type === 'empresa' ? account!.company_name : account!.travel_agent_name;
      if (!nameValue) return [];
      const { data, error } = await supabase
        .from('processed_reservations')
        .select('arrival_date, departure_date, total_revenue, room_revenue, sales_channel, lead_time_days, roomnights')
        .eq('tenant_id', tenantId!)
        .eq(nameColumn, nameValue)
        .order('arrival_date', { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: followers } = useAccountFollowers(id);
  const { data: productionMap } = useCrmProduction();
  const postClosing = id ? productionMap?.get(id) : undefined;

  const isFollower = !!followers?.some((f) => f.user_id === user?.id);
  const isResponsible = !!account && account.responsible_user_id === user?.id;
  const isAdmin = isSuperAdmin || role === 'master_admin' || role === 'editor';
  const canEdit = isAdmin || isResponsible || !isFollower;

  const productionSummary = useMemo(() => {
    if (!production || production.length === 0) return null;
    const now = Date.now();
    const ninetyDays = now - 90 * 24 * 60 * 60 * 1000;
    const rev90 = production.filter((r) => new Date(r.arrival_date).getTime() >= ninetyDays)
      .reduce((s, r) => s + Number(r.total_revenue || 0), 0);
    const totalRev = production.reduce((s, r) => s + Number(r.total_revenue || 0), 0);
    const totalRn = production.reduce((s, r) => s + Number(r.roomnights || 0), 0);
    const leadTimes = production.map((r) => Number(r.lead_time_days || 0)).filter((v) => v > 0);
    const avgLead = leadTimes.length > 0 ? leadTimes.reduce((s, v) => s + v, 0) / leadTimes.length : null;
    const channelCounts: Record<string, number> = {};
    production.forEach((r) => { channelCounts[r.sales_channel] = (channelCounts[r.sales_channel] || 0) + 1; });
    const topChannel = Object.entries(channelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    return { rev90, totalRev, totalRn, avgLead, topChannel, count: production.length };
  }, [production]);

  const monthlyChart = useMemo(() => {
    if (!production) return [];
    const map = new Map<string, number>();
    production.forEach((r) => {
      const d = new Date(r.arrival_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      map.set(key, (map.get(key) || 0) + Number(r.total_revenue || 0));
    });
    const sorted = [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12);
    return sorted.map(([key, revenue]) => {
      const [y, m] = key.split('-');
      return { label: `${MONTH_NAMES[parseInt(m) - 1]}/${y.slice(2)}`, revenue };
    });
  }, [production]);

  if (!account) {
    return (
      <div className="min-h-screen bg-background pl-14">
        <AppHeader />
        <div className="p-6 text-sm text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  const name = account.account_type === 'agencia' ? account.travel_agent_name : account.company_name;
  const lastVisitDays = daysBetween(visits?.[0]?.visit_date);

  return (
    <div className="min-h-screen bg-background pl-14">
      <AppHeader />
      <div className="space-y-4 p-4 lg:p-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="h-8 px-2">
            <Link to="/comercial/contas"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <span className="text-xs text-muted-foreground">Contas Comerciais</span>
        </div>

        <div className="surface-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="text-2xl font-semibold text-foreground">{name}</h1>
                <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs"
                      style={{ background: STAGE_COLORS[account.stage as CrmAccountStage] + '22', color: STAGE_COLORS[account.stage as CrmAccountStage] }}>
                  {STAGE_LABELS[account.stage as CrmAccountStage]}
                </span>
                {account.account_status && (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs"
                        style={{
                          background: ACCOUNT_STATUS_COLORS[account.account_status as CrmAccountStatus] + '22',
                          color: ACCOUNT_STATUS_COLORS[account.account_status as CrmAccountStatus],
                        }}>
                    Conta {ACCOUNT_STATUS_LABELS[account.account_status as CrmAccountStatus]}
                  </span>
                )}
              </div>
              <p className="mb-1 text-xs text-muted-foreground">
                {STAGE_DESCRIPTIONS[account.stage as CrmAccountStage]}
              </p>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>{ACCOUNT_TYPE_LABELS[account.account_type as 'empresa' | 'agencia']}</span>
                {account.city && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {account.city}</span>}
                {account.segment && <span>· {account.segment}</span>}
                {account.sub_segment && <span>· {SUB_SEGMENT_LABELS[account.sub_segment as CrmAccountSubSegment] || account.sub_segment}</span>}
                {account.closed_at && <span>· Fechamento: {formatDateBR(account.closed_at)}</span>}
                {account.contact_name && <span>· Contato: {account.contact_name}</span>}
                {account.contact_email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {account.contact_email}</span>}
                {account.contact_phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {account.contact_phone}</span>}
                <span>· Executivo: {tenantUsers?.find((u) => u.user_id === account.responsible_user_id)?.full_name || '—'}</span>
                {account.agreed_rate != null && (
                  <span>· Tarifa acordo: R$ {Number(account.agreed_rate).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                )}
              </div>
              {account.notes && (
                <p className="mt-3 max-w-2xl text-sm text-foreground/80 whitespace-pre-wrap">{account.notes}</p>
              )}
            </div>
            {canEdit ? (
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="mr-1 h-3 w-3" /> Editar
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
                <Eye className="h-3 w-3" /> Você segue esta conta (somente leitura)
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="surface-card px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Última Visita</div>
            <div className="text-xl font-bold font-mono">
              {lastVisitDays === null ? '—' : lastVisitDays === 0 ? 'Hoje' : `${lastVisitDays}d atrás`}
            </div>
          </div>
          <div className="surface-card px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Produção 90d</div>
            <div className="text-xl font-bold font-mono text-primary">{formatRevenue(productionSummary?.rev90 || 0)}</div>
          </div>
          <div className="surface-card px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Canal Principal</div>
            <div className="text-lg font-semibold">{productionSummary?.topChannel || '—'}</div>
          </div>
          <div className="surface-card px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Antecedência Média</div>
            <div className="text-xl font-bold font-mono">
              {productionSummary?.avgLead ? `${Math.round(productionSummary.avgLead)}d` : '—'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="surface-card p-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Timeline de Interações</h3>
              <Button size="sm" onClick={() => { setEditVisit(null); setVisitOpen(true); }}>
                <Plus className="mr-1 h-4 w-4" /> Nova
              </Button>
            </div>
            {visits && visits.length > 0 ? (
              <div className="space-y-3 max-h-[420px] overflow-y-auto pr-2">
                {visits.map((v: any) => (
                  <div key={v.id} className="flex gap-3 rounded-md border border-border/40 p-3 hover:bg-secondary/30 cursor-pointer"
                       onClick={() => { setEditVisit(v); setVisitOpen(true); }}>
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                      {visitIcon(v.visit_type as CrmVisitType)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-foreground">{VISIT_TYPE_LABELS[v.visit_type as CrmVisitType]}</span>
                        <span className="text-muted-foreground font-mono">{formatDateBR(v.visit_date)}</span>
                      </div>
                      <p className="mt-1 text-sm text-foreground/85 whitespace-pre-wrap">{v.summary}</p>
                      {v.next_follow_up_date && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-primary">
                          <CalendarClock className="h-3 w-3" /> Follow-up: {formatDateBR(v.next_follow_up_date)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma interação registrada.</p>
            )}
          </div>

          <div className="surface-card p-6">
            <div className="mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Produção Mensal (últimos 12m)</h3>
            </div>
            {monthlyChart.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={monthlyChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="label" tick={{ fill: 'hsl(220, 10%, 50%)', fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => formatRevenue(v)} tick={{ fill: 'hsl(220, 10%, 50%)', fontSize: 11 }} />
                    <Tooltip
                      formatter={(value: number) => [formatRevenue(value), 'Receita']}
                      contentStyle={{ background: 'hsl(230, 18%, 14%)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                      labelStyle={{ color: 'hsl(220, 15%, 85%)' }}
                    />
                    <Bar dataKey="revenue" fill="hsl(200, 80%, 55%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-xs text-muted-foreground">Total</div>
                    <div className="text-sm font-mono font-semibold text-primary">{formatRevenue(productionSummary?.totalRev || 0)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Reservas</div>
                    <div className="text-sm font-mono font-semibold">{productionSummary?.count || 0}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Roomnights</div>
                    <div className="text-sm font-mono font-semibold">{Math.round(productionSummary?.totalRn || 0)}</div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-40 items-center justify-center text-xs text-muted-foreground text-center">
                Nenhuma produção real cruzada com este nome.<br />
                Verifique se o nome bate exatamente com o registrado em processed_reservations.
              </div>
            )}
          </div>
        </div>
      </div>

      <AccountFormDialog open={editOpen} onOpenChange={setEditOpen} account={account} />
      {id && <VisitFormDialog open={visitOpen} onOpenChange={setVisitOpen} accountId={id} visit={editVisit} />}
    </div>
  );
};

export default CrmAccountDetailPage;
