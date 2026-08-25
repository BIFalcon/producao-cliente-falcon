import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useFilters } from '@/contexts/FiltersContext';
import AppHeader from '@/components/AppHeader';
import CrmNav from '@/components/crm/CrmNav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Check, Download, Plus, Search, Upload, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import AccountFormDialog from '@/components/crm/AccountFormDialog';
import AccountImportDialog from '@/components/crm/AccountImportDialog';
import { useCrmUsers, accountMatchesExecutive, accountMatchesHotels } from '@/hooks/useCrmUsers';
import { useCrmProduction } from '@/hooks/useCrmProduction';
import { useTableSort, SortableTh } from '@/hooks/useTableSort';
import { formatRevenue } from '@/lib/formatters';
import { exportAccountsToExcel } from '@/lib/crm-export';
import {
  STAGE_COLORS,
  STAGE_LABELS,
  STAGE_DESCRIPTIONS,
  STAGE_ORDER,
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_STATUS_LABELS,
  ACCOUNT_STATUS_COLORS,
  SUB_SEGMENT_LABELS,
  CrmAccountStage,
  CrmAccountStatus,
  CrmAccountSubSegment,
  formatDateBR,
  formatTimeBR,
  formatMoneyBR,
  todayLocalISO,
} from '@/lib/crm';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Próximo follow-up pendente da conta */
const nextFollowUp = (a: any) => {
  const pending = (a.crm_visits || [])
    .filter((v: any) => v.next_follow_up_date && !v.follow_up_done)
    .sort((x: any, y: any) => String(x.next_follow_up_date).localeCompare(String(y.next_follow_up_date)));
  return pending[0] || null;
};

const CrmAccountsPage = () => {
  const { tenantId } = useAuth();
  const { filters } = useFilters();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: users } = useCrmUsers();
  const { data: productionMap } = useCrmProduction();

  const [stageFilter, setStageFilter] = useState<string>(searchParams.get('stage') || 'all');
  const [statusFilter, setStatusFilter] = useState<string>(searchParams.get('status') || 'all');
  const [subFilter, setSubFilter] = useState<string>(searchParams.get('sub') || 'all');
  const [execFilter, setExecFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  useEffect(() => {
    setStageFilter(searchParams.get('stage') || 'all');
    setStatusFilter(searchParams.get('status') || 'all');
    setSubFilter(searchParams.get('sub') || 'all');
  }, [searchParams]);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === 'all') next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const { data, isLoading } = useQuery({
    queryKey: ['crm-accounts-list', tenantId, stageFilter, statusFilter, subFilter],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = (supabase.from('crm_accounts') as any)
        .select('id, account_type, company_name, travel_agent_name, city, segment, sub_segment, stage, account_status, properties, notes, contact_name, contact_email, contact_phone, responsible_user_id, agreed_rate, agreed_roomnights, agreement_start, agreement_end, projected_revenue, attachment_path, attachment_name, closed_at, updated_at, crm_visits(visit_date, next_follow_up_date, follow_up_time, follow_up_done)')
        .eq('tenant_id', tenantId!)
        .order('updated_at', { ascending: false });
      if (stageFilter !== 'all') q = q.eq('stage', stageFilter);
      if (statusFilter !== 'all') q = q.eq('account_status', statusFilter);
      if (subFilter !== 'all') q = q.eq('sub_segment', subFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data as any[];
    },
  });

  const executive = users?.find((u) => u.user_id === execFilter);
  const userName = (userId: string | null) =>
    (userId && users?.find((u) => u.user_id === userId)?.full_name) || '';

  const filtered = useMemo(() => {
    if (!data) return [];
    const s = search.trim().toLowerCase();
    return data.filter((a) => {
      if (!accountMatchesHotels(a, filters.property)) return false;
      if (execFilter !== 'all' && !accountMatchesExecutive(a, executive)) return false;
      if (!s) return true;
      const name = (a.company_name || '') + ' ' + (a.travel_agent_name || '') + ' ' + (a.city || '');
      return name.toLowerCase().includes(s);
    });
  }, [data, search, filters.property, execFilter, executive]);

  const { sorted, sortKey, sortDir, toggleSort } = useTableSort(filtered, {
    name: (a: any) => (a.account_type === 'agencia' ? a.travel_agent_name : a.company_name),
    type: (a: any) => ACCOUNT_TYPE_LABELS[a.account_type as 'empresa' | 'agencia'],
    city: (a: any) => a.city,
    segment: (a: any) => a.segment,
    sub: (a: any) => (a.sub_segment ? SUB_SEGMENT_LABELS[a.sub_segment as CrmAccountSubSegment] : null),
    hotels: (a: any) => (a.properties || []).join(', '),
    exec: (a: any) => userName(a.responsible_user_id),
    stage: (a: any) => STAGE_ORDER.indexOf(a.stage),
    status: (a: any) => a.account_status,
    lastVisit: (a: any) => (a.crm_visits || []).map((v: any) => v.visit_date).sort().pop(),
    followUp: (a: any) => nextFollowUp(a)?.next_follow_up_date,
    projected: (a: any) => (a.projected_revenue != null ? Number(a.projected_revenue) : null),
    rn: (a: any) => (a.agreed_roomnights != null ? Number(a.agreed_roomnights) : null),
    production: (a: any) => productionMap?.get(a.id)?.revenue ?? null,
  });

  const deleteAccount = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('crm_accounts') as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Conta excluída');
      qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith('crm-') });
      setDeleteTarget(null);
    },
    onError: (err: any) => toast.error(err.message || 'Erro ao excluir conta'),
  });

  const today = todayLocalISO();
  const th = { activeKey: sortKey, dir: sortDir, onSort: toggleSort };

  return (
    <div className="min-h-screen bg-background pl-14">
      <AppHeader />
      <div className="space-y-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Contas Comerciais</h1>
            <p className="text-xs text-muted-foreground">Empresas e agências em relacionamento comercial</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CrmNav />
            <Button size="sm" variant="outline" onClick={() => exportAccountsToExcel(sorted, userName)}>
              <Download className="mr-1 h-4 w-4" /> Exportar Excel
            </Button>
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-1 h-4 w-4" /> Importar Planilha
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> Nova Conta
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[240px] max-w-md flex-1">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome, cidade..." className="h-9 pl-8" />
          </div>
          <Select value={stageFilter} onValueChange={(v) => { setStageFilter(v); updateParam('stage', v); }}>
            <SelectTrigger className="h-9 w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Estágios</SelectItem>
              {STAGE_ORDER.map((s) => (
                <SelectItem key={s} value={s}>
                  <span className="flex flex-col">
                    <span>{STAGE_LABELS[s]}</span>
                    <span className="text-xs text-muted-foreground">{STAGE_DESCRIPTIONS[s]}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); updateParam('status', v); }}>
            <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Status</SelectItem>
              <SelectItem value="ativo">Ativo</SelectItem>
              <SelectItem value="inativo">Inativo</SelectItem>
            </SelectContent>
          </Select>
          <Select value={subFilter} onValueChange={(v) => { setSubFilter(v); updateParam('sub', v); }}>
            <SelectTrigger className="h-9 w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toda Subsegmentação</SelectItem>
              {(Object.keys(SUB_SEGMENT_LABELS) as CrmAccountSubSegment[]).map((s) => (
                <SelectItem key={s} value={s}>{SUB_SEGMENT_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={execFilter} onValueChange={setExecFilter}>
            <SelectTrigger className="h-9 w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Executivos</SelectItem>
              {(users || []).map((u) => (
                <SelectItem key={u.user_id} value={u.user_id}>
                  <span className="flex flex-col">
                    <span>{u.full_name}</span>
                    {u.hotels.length > 0 && (
                      <span className="text-xs text-muted-foreground">{u.hotels.join(', ')}</span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <SortableTh label="Nome" sortKey="name" {...th} />
                  <SortableTh label="Tipo" sortKey="type" {...th} />
                  <SortableTh label="Cidade" sortKey="city" {...th} />
                  <SortableTh label="Segmento" sortKey="segment" {...th} />
                  <SortableTh label="Subsegmentação" sortKey="sub" {...th} />
                  <SortableTh label="Hotéis" sortKey="hotels" {...th} />
                  <SortableTh label="Executivo" sortKey="exec" {...th} />
                  <SortableTh label="Estágio do Funil" sortKey="stage" {...th} />
                  <SortableTh label="Status da Conta" sortKey="status" {...th} />
                  <SortableTh label="RN Acordo" sortKey="rn" {...th} />
                  <SortableTh label="Receita Projetada" sortKey="projected" {...th} />
                  <SortableTh label="Última Interação" sortKey="lastVisit" {...th} />
                  <SortableTh label="Próximo Follow-up" sortKey="followUp" {...th} />
                  <SortableTh label="Produção pós-fechamento" sortKey="production" {...th} />
                  <th className="px-4 py-3 text-left">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={15} className="px-4 py-8 text-center text-xs text-muted-foreground">Carregando...</td></tr>
                )}
                {!isLoading && sorted.length === 0 && (
                  <tr><td colSpan={15} className="px-4 py-8 text-center text-xs text-muted-foreground">Nenhuma conta encontrada</td></tr>
                )}
                {sorted.map((a: any) => {
                  const name = a.account_type === 'agencia' ? a.travel_agent_name : a.company_name;
                  const stage = a.stage as CrmAccountStage;
                  const status = a.account_status as CrmAccountStatus | null;
                  const lastVisit = (a.crm_visits || []).map((v: any) => v.visit_date).sort().pop();
                  const follow = nextFollowUp(a);
                  const late = follow && follow.next_follow_up_date < today;
                  return (
                    <tr key={a.id}
                        onClick={() => navigate(`/comercial/contas/${a.id}`)}
                        className="cursor-pointer border-t border-border/40 transition hover:bg-secondary/40">
                      <td className="px-4 py-3 font-medium text-foreground">{name || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{ACCOUNT_TYPE_LABELS[a.account_type as 'empresa' | 'agencia']}</td>
                      <td className="px-4 py-3 text-muted-foreground">{a.city || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{a.segment || '—'}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {a.sub_segment ? (SUB_SEGMENT_LABELS[a.sub_segment as CrmAccountSubSegment] || a.sub_segment) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {a.properties && a.properties.length > 0 ? a.properties.join(', ') : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{userName(a.responsible_user_id) || '—'}</td>
                      <td className="px-4 py-3">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs"
                                  style={{ background: STAGE_COLORS[stage] + '22', color: STAGE_COLORS[stage] }}>
                              {STAGE_LABELS[stage]}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{STAGE_DESCRIPTIONS[stage]}</TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="px-4 py-3">
                        {status ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs"
                                style={{ background: ACCOUNT_STATUS_COLORS[status] + '22', color: ACCOUNT_STATUS_COLORS[status] }}>
                            {ACCOUNT_STATUS_LABELS[status]}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {a.agreed_roomnights != null ? Number(a.agreed_roomnights).toLocaleString('pt-BR') : '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{formatMoneyBR(a.projected_revenue)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{lastVisit ? formatDateBR(lastVisit) : '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                        {follow ? (
                          <span className={late ? 'text-destructive' : 'text-muted-foreground'}>
                            {formatDateBR(follow.next_follow_up_date)} {formatTimeBR(follow.follow_up_time)}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {(() => {
                          const prod = productionMap?.get(a.id);
                          if (!prod?.closed_at) return <span className="text-muted-foreground">—</span>;
                          if (prod.reservations > 0) {
                            return (
                              <span className="inline-flex items-center gap-1.5 text-accent">
                                <Check className="h-3.5 w-3.5" />
                                <span className="font-mono">{formatRevenue(prod.revenue)}</span>
                              </span>
                            );
                          }
                          return <span className="text-muted-foreground">Sem produção</span>;
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive"
                                onClick={(e) => { e.stopPropagation(); setDeleteTarget(a); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <AccountFormDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <AccountImportDialog open={importOpen} onOpenChange={setImportOpen} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta conta comercial?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (deleteTarget.account_type === 'agencia' ? deleteTarget.travel_agent_name : deleteTarget.company_name)} —
              todas as interações e seguidores vinculados também serão removidos. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && deleteAccount.mutate(deleteTarget.id)}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default CrmAccountsPage;
