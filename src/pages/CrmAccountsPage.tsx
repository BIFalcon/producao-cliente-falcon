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
  accountLabel,
} from '@/lib/crm';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Columns3 } from 'lucide-react';

const COLUMNS = [
  { key: 'type', label: 'Tipo' },
  { key: 'city', label: 'Cidade' },
  { key: 'segment', label: 'Segmento' },
  { key: 'sub', label: 'Subsegmentação' },
  { key: 'hotels', label: 'Hotéis' },
  { key: 'exec', label: 'Executivo' },
  { key: 'stage', label: 'Estágio do Funil' },
  { key: 'status', label: 'Status da Conta' },
  { key: 'rn', label: 'RN Acordo' },
  { key: 'projected', label: 'Receita Projetada' },
  { key: 'lastVisit', label: 'Última Interação' },
  { key: 'followUp', label: 'Próximo Follow-up' },
  { key: 'production', label: 'Produção pós-fechamento' },
];
const DEFAULT_COLS = ['type', 'hotels', 'exec', 'stage', 'status', 'projected', 'lastVisit', 'followUp', 'production'];
const COLS_STORAGE = 'crm-accounts-visible-columns';

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
  const [visibleCols, setVisibleCols] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLS_STORAGE) || 'null');
      if (Array.isArray(saved)) return new Set(saved);
    } catch { /* ignore */ }
    return new Set(DEFAULT_COLS);
  });
  useEffect(() => {
    localStorage.setItem(COLS_STORAGE, JSON.stringify([...visibleCols]));
  }, [visibleCols]);
  const show = (k: string) => visibleCols.has(k);
  const toggleCol = (k: string) => setVisibleCols((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

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
        .select('id, account_type, company_name, travel_agent_name, city, segment, sub_segment, stage, account_status, properties, created_at, notes, contact_name, contact_email, contact_phone, responsible_user_id, agreed_rate, agreed_roomnights, agreement_start, agreement_end, projected_revenue, attachment_path, attachment_name, closed_at, updated_at, crm_visits(visit_date, next_follow_up_date, follow_up_time, follow_up_done)')
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

  // Drill-down vindo do Dashboard Comercial
  const hotelParam = searchParams.get('hotel');
  const execParam = searchParams.get('exec');
  const urlYear = searchParams.get('year') ? Number(searchParams.get('year')) : null;
  const urlMonths = (searchParams.get('months') || '').split(',').filter(Boolean).map(Number);
  // Período: vem do clique no Dashboard ou, se não houver, do filtro Ano/Mês do topo
  const yearParam = urlYear ?? filters.year ?? null;
  const monthsParam = urlMonths.length ? urlMonths : (filters.month || []);
  const metricParam = searchParams.get('metric'); // closed | interactions | activity
  const drillActive = !!(hotelParam || execParam || urlYear || urlMonths.length || metricParam);
  const periodOn = !!yearParam || monthsParam.length > 0;
  const inP = (d: string | null | undefined) => {
    if (!d) return false;
    let y: number, m: number;
    if (d.length > 10) { const dt = new Date(d); y = dt.getFullYear(); m = dt.getMonth() + 1; }
    else { y = Number(d.slice(0, 4)); m = Number(d.slice(5, 7)); }
    if (yearParam && y !== yearParam) return false;
    if (monthsParam.length && !monthsParam.includes(m)) return false;
    return true;
  };
  const clearDrill = () => {
    const next = new URLSearchParams(searchParams);
    ['hotel', 'exec', 'year', 'months', 'metric'].forEach((k) => next.delete(k));
    setSearchParams(next, { replace: true });
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    const s = search.trim().toLowerCase();
    return data.filter((a) => {
      if (!accountMatchesHotels(a, filters.property)) return false;
      if (hotelParam) {
        const props: string[] = a.properties || [];
        if (hotelParam === '__none__' ? props.length > 0 : !props.includes(hotelParam)) return false;
      }
      if (execParam && (execParam === '__none__' ? !!a.responsible_user_id : a.responsible_user_id !== execParam)) return false;
      const visitsIn = () => (a.crm_visits || []).some((v: any) => inP(v.visit_date));
      if (metricParam === 'closed' || (periodOn && stageFilter === 'fechamento')) {
        if (periodOn ? !inP(a.closed_at) : a.stage !== 'fechamento') return false;
      } else if (metricParam === 'interactions') {
        if (periodOn ? !visitsIn() : !(a.crm_visits || []).length) return false;
      } else if (periodOn) {
        if (!(inP(a.created_at) || inP(a.closed_at) || visitsIn())) return false;
      }
      if (execFilter !== 'all' && !accountMatchesExecutive(a, executive)) return false;
      if (!s) return true;
      const name = (a.company_name || '') + ' ' + (a.travel_agent_name || '') + ' ' + (a.city || '');
      return name.toLowerCase().includes(s);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, search, filters.property, execFilter, executive, searchParams]);

  const { sorted, sortKey, sortDir, toggleSort } = useTableSort(filtered, {
    name: (a: any) => accountLabel(a),
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
            {drillActive && (
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-primary">
                Filtro do Dashboard:
                {hotelParam && <span>hotel {hotelParam === '__none__' ? 'sem hotel' : hotelParam}</span>}
                {execParam && <span>· executivo {execParam === '__none__' ? 'não vinculado' : userName(execParam)}</span>}
                {metricParam === 'closed' && <span>· fechadas{periodOn ? ' no período' : ''}</span>}
                {metricParam === 'interactions' && <span>· com interação{periodOn ? ' no período' : ''}</span>}
                {periodOn && <span>· período {monthsParam.length ? monthsParam.join(',') + '/' : ''}{yearParam ?? ''}</span>}
                <button type="button" onClick={clearDrill} className="underline">limpar</button>
              </p>
            )}
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

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{sorted.length} conta(s)</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5">
                <Columns3 className="h-3.5 w-3.5" /> Colunas ({visibleCols.size}/{COLUMNS.length})
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Mostrar colunas</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {COLUMNS.map((c) => (
                <DropdownMenuCheckboxItem key={c.key} checked={visibleCols.has(c.key)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => toggleCol(c.key)}>
                  {c.label}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setVisibleCols(new Set(DEFAULT_COLS))}>Restaurar padrão</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="surface-card overflow-hidden">
          <div className="max-h-[calc(100vh-280px)] overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <SortableTh label="Nome" sortKey="name" {...th} className="left-0 !z-[3] min-w-[220px] max-w-[280px] shadow-[1px_0_0_hsl(var(--border))]" />
                  {show('type') && <SortableTh label="Tipo" sortKey="type" {...th} />}
                  {show('city') && <SortableTh label="Cidade" sortKey="city" {...th} />}
                  {show('segment') && <SortableTh label="Segmento" sortKey="segment" {...th} />}
                  {show('sub') && <SortableTh label="Subsegmentação" sortKey="sub" {...th} />}
                  {show('hotels') && <SortableTh label="Hotéis" sortKey="hotels" {...th} />}
                  {show('exec') && <SortableTh label="Executivo" sortKey="exec" {...th} />}
                  {show('stage') && <SortableTh label="Estágio do Funil" sortKey="stage" {...th} />}
                  {show('status') && <SortableTh label="Status da Conta" sortKey="status" {...th} />}
                  {show('rn') && <SortableTh label="RN Acordo" sortKey="rn" {...th} />}
                  {show('projected') && <SortableTh label="Receita Projetada" sortKey="projected" {...th} />}
                  {show('lastVisit') && <SortableTh label="Última Interação" sortKey="lastVisit" {...th} />}
                  {show('followUp') && <SortableTh label="Próximo Follow-up" sortKey="followUp" {...th} />}
                  {show('production') && <SortableTh label="Produção pós-fechamento" sortKey="production" {...th} />}
                  <th className="px-3 py-2 text-left">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={16} className="px-4 py-8 text-center text-xs text-muted-foreground">Carregando...</td></tr>
                )}
                {!isLoading && sorted.length === 0 && (
                  <tr><td colSpan={16} className="px-4 py-8 text-center text-xs text-muted-foreground">Nenhuma conta encontrada</td></tr>
                )}
                {sorted.map((a: any) => {
                  const name = accountLabel(a);
                  const stage = a.stage as CrmAccountStage;
                  const status = a.account_status as CrmAccountStatus | null;
                  const lastVisit = (a.crm_visits || []).map((v: any) => v.visit_date).sort().pop();
                  const follow = nextFollowUp(a);
                  const late = follow && follow.next_follow_up_date < today;
                  const cell = 'px-3 py-2';
                  return (
                    <tr key={a.id}
                        onClick={() => navigate(`/comercial/contas/${a.id}`)}
                        className="group cursor-pointer border-t border-border/40 transition">
                      <td className={`${cell} sticky left-0 z-[1] max-w-[280px] truncate bg-card font-medium text-foreground shadow-[1px_0_0_hsl(var(--border))] group-hover:bg-secondary`}
                          title={name || ''}>{name || '—'}</td>
                      {show('type') && <td className={`${cell} text-muted-foreground`}>{ACCOUNT_TYPE_LABELS[a.account_type as 'empresa' | 'agencia']}</td>}
                      {show('city') && <td className={`${cell} text-muted-foreground`}>{a.city || '—'}</td>}
                      {show('segment') && <td className={`${cell} text-muted-foreground`}>{a.segment || '—'}</td>}
                      {show('sub') && (
                        <td className={`${cell} text-xs text-muted-foreground`}>
                          {a.sub_segment ? (SUB_SEGMENT_LABELS[a.sub_segment as CrmAccountSubSegment] || a.sub_segment) : '—'}
                        </td>
                      )}
                      {show('hotels') && (
                        <td className={`${cell} max-w-[240px] truncate text-xs text-muted-foreground`}
                            title={(a.properties || []).join(', ')}>
                          {a.properties && a.properties.length > 0 ? a.properties.join(', ') : '—'}
                        </td>
                      )}
                      {show('exec') && <td className={`${cell} text-xs text-muted-foreground`}>{userName(a.responsible_user_id) || '—'}</td>}
                      {show('stage') && (
                        <td className={cell}>
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
                      )}
                      {show('status') && (
                        <td className={cell}>
                          {status ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs"
                                  style={{ background: ACCOUNT_STATUS_COLORS[status] + '22', color: ACCOUNT_STATUS_COLORS[status] }}>
                              {ACCOUNT_STATUS_LABELS[status]}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      )}
                      {show('rn') && (
                        <td className={`${cell} font-mono text-xs text-muted-foreground`}>
                          {a.agreed_roomnights != null ? Number(a.agreed_roomnights).toLocaleString('pt-BR') : '—'}
                        </td>
                      )}
                      {show('projected') && <td className={`${cell} font-mono text-xs text-muted-foreground`}>{formatMoneyBR(a.projected_revenue)}</td>}
                      {show('lastVisit') && <td className={`${cell} font-mono text-xs text-muted-foreground`}>{lastVisit ? formatDateBR(lastVisit) : '—'}</td>}
                      {show('followUp') && (
                        <td className={`${cell} font-mono text-xs`}>
                          {follow ? (
                            <span className={late ? 'text-destructive' : 'text-muted-foreground'}>
                              {formatDateBR(follow.next_follow_up_date)} {formatTimeBR(follow.follow_up_time)}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                      )}
                      {show('production') && (
                        <td className={`${cell} text-xs`}>
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
                      )}
                      <td className={cell}>
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
              {deleteTarget && accountLabel(deleteTarget)} —
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
