import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useFilters } from '@/contexts/FiltersContext';
import AppHeader from '@/components/AppHeader';
import CrmNav from '@/components/crm/CrmNav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, Search, Plus } from 'lucide-react';
import { toast } from 'sonner';
import VisitFormDialog from '@/components/crm/VisitFormDialog';
import { AttachmentLink } from '@/components/crm/CrmAttachmentField';
import { useCrmUsers, accountMatchesExecutive, accountMatchesHotels } from '@/hooks/useCrmUsers';
import { useTableSort, SortableTh } from '@/hooks/useTableSort';
import {
  VISIT_TYPE_LABELS,
  SUB_SEGMENT_LABELS,
  CrmVisitType,
  CrmAccountSubSegment,
  accountLabel,
  formatDateBR,
  formatTimeBR,
  todayLocalISO,
  daysBetween,
} from '@/lib/crm';

const CrmTasksPage = () => {
  const { tenantId } = useAuth();
  const { filters } = useFilters();
  const { data: users } = useCrmUsers();
  const qc = useQueryClient();

  const [range, setRange] = useState('pendentes');
  const [execFilter, setExecFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editVisit, setEditVisit] = useState<any | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['crm-tasks', tenantId, showDone],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = (supabase.from('crm_visits') as any)
        .select('id, visit_type, visit_date, summary, account_id, created_by, next_follow_up_date, follow_up_time, follow_up_type, follow_up_notes, follow_up_done, attachment_path, attachment_name, crm_accounts(id, account_type, company_name, travel_agent_name, city, sub_segment, properties, responsible_user_id)')
        .eq('tenant_id', tenantId!)
        .not('next_follow_up_date', 'is', null)
        .order('next_follow_up_date', { ascending: true })
        .limit(2000);
      if (!showDone) q = q.eq('follow_up_done', false);
      const { data, error } = await q;
      if (error) throw error;
      return data as any[];
    },
  });

  const executive = users?.find((u) => u.user_id === execFilter);
  const userName = (userId: string | null) =>
    (userId && users?.find((u) => u.user_id === userId)?.full_name) || '';

  const today = todayLocalISO();

  const filtered = useMemo(() => {
    if (!data) return [];
    const s = search.trim().toLowerCase();
    return data.filter((t) => {
      const acc = t.crm_accounts || {};
      if (!accountMatchesHotels(acc, filters.property)) return false;
      if (execFilter !== 'all' && !(t.created_by === execFilter || accountMatchesExecutive(acc, executive))) return false;
      const d = t.next_follow_up_date as string;
      if (range === 'atrasadas' && !(d < today)) return false;
      if (range === 'hoje' && d !== today) return false;
      if (range === 'proximos_7' && !(d >= today && d <= new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10))) return false;
      if (range === 'proximos_30' && !(d >= today && d <= new Date(Date.now() + 29 * 864e5).toISOString().slice(0, 10))) return false;
      if (!s) return true;
      const hay = `${acc.company_name || ''} ${acc.travel_agent_name || ''} ${t.follow_up_notes || ''} ${t.summary || ''}`;
      return hay.toLowerCase().includes(s);
    });
  }, [data, search, filters.property, execFilter, executive, range, today]);

  const { sorted, sortKey, sortDir, toggleSort } = useTableSort(filtered, {
    date: (t: any) => t.next_follow_up_date,
    account: (t: any) => accountLabel(t.crm_accounts),
    type: (t: any) => VISIT_TYPE_LABELS[(t.follow_up_type || t.visit_type) as CrmVisitType],
    sub: (t: any) => t.crm_accounts?.sub_segment,
    hotels: (t: any) => (t.crm_accounts?.properties || []).join(', '),
    exec: (t: any) => userName(t.created_by),
  });

  const complete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('crm_visits') as any)
        .update({ follow_up_done: true, follow_up_completed_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Tarefa concluída');
      qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith('crm-') });
    },
    onError: (err: any) => toast.error(err.message || 'Erro ao concluir'),
  });

  const overdue = sorted.filter((t: any) => !t.follow_up_done && t.next_follow_up_date < today).length;
  const dueToday = sorted.filter((t: any) => !t.follow_up_done && t.next_follow_up_date === today).length;

  return (
    <div className="min-h-screen bg-background pl-14">
      <AppHeader />
      <div className="space-y-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Tarefas Futuras</h1>
            <p className="text-xs text-muted-foreground">Follow-ups agendados nas interações — conclua ou reagende</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CrmNav />
            <Button size="sm" onClick={() => { setEditVisit(null); setDialogOpen(true); }}>
              <Plus className="mr-1 h-4 w-4" /> Nova Atividade
            </Button>
          </div>
        </div>

        <div className="surface-card flex flex-wrap items-end gap-3 p-4">
          <div>
            <Label className="text-xs text-muted-foreground">Prazo</Label>
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="h-9 w-[170px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pendentes">Todas</SelectItem>
                <SelectItem value="atrasadas">Atrasadas</SelectItem>
                <SelectItem value="hoje">Hoje</SelectItem>
                <SelectItem value="proximos_7">Próximos 7 dias</SelectItem>
                <SelectItem value="proximos_30">Próximos 30 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Executivo</Label>
            <Select value={execFilter} onValueChange={setExecFilter}>
              <SelectTrigger className="h-9 w-[200px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Executivos</SelectItem>
                {(users || []).map((u) => (
                  <SelectItem key={u.user_id} value={u.user_id}>{u.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Concluídas</Label>
            <Select value={showDone ? 'sim' : 'nao'} onValueChange={(v) => setShowDone(v === 'sim')}>
              <SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nao">Ocultar</SelectItem>
                <SelectItem value="sim">Mostrar</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
                   placeholder="Buscar por conta ou observação..." className="h-9 pl-8 text-xs" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="surface-card px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Tarefas</div>
            <div className="font-mono text-2xl font-bold">{sorted.length}</div>
          </div>
          <div className="surface-card px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Atrasadas</div>
            <div className="font-mono text-2xl font-bold text-destructive">{overdue}</div>
          </div>
          <div className="surface-card px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Para hoje</div>
            <div className="font-mono text-2xl font-bold text-primary">{dueToday}</div>
          </div>
        </div>

        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <SortableTh label="Data / Hora" sortKey="date" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Conta" sortKey="account" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Subsegmentação" sortKey="sub" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Hotéis" sortKey="hotels" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Tipo de Atividade" sortKey="type" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <th className="px-4 py-3 text-left">Observações</th>
                  <SortableTh label="Responsável" sortKey="exec" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <th className="px-4 py-3 text-left">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-xs text-muted-foreground">Carregando...</td></tr>
                )}
                {!isLoading && sorted.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-xs text-muted-foreground">Nenhuma tarefa futura 🎉</td></tr>
                )}
                {sorted.map((t: any) => {
                  const acc = t.crm_accounts || {};
                  const late = !t.follow_up_done && t.next_follow_up_date < today;
                  const days = daysBetween(t.next_follow_up_date) || 0;
                  return (
                    <tr key={t.id} className="border-t border-border/40 align-top transition hover:bg-secondary/40">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                        <span className={late ? 'text-destructive' : 'text-muted-foreground'}>
                          {formatDateBR(t.next_follow_up_date)} {formatTimeBR(t.follow_up_time)}
                        </span>
                        {late && <div className="text-[11px] text-destructive">{days}d atrasado</div>}
                        {t.follow_up_done && <div className="text-[11px] text-accent">concluída</div>}
                      </td>
                      <td className="px-4 py-3">
                        <Link to={`/comercial/contas/${t.account_id}`} className="font-medium text-primary hover:underline">
                          {accountLabel(acc)}
                        </Link>
                        {acc.city && <div className="text-xs text-muted-foreground">{acc.city}</div>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {acc.sub_segment ? (SUB_SEGMENT_LABELS[acc.sub_segment as CrmAccountSubSegment] || acc.sub_segment) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {(acc.properties || []).length ? acc.properties.join(', ') : '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs">
                        {VISIT_TYPE_LABELS[(t.follow_up_type || t.visit_type) as CrmVisitType]}
                      </td>
                      <td className="max-w-[360px] px-4 py-3 text-xs text-foreground/85">
                        <span className="line-clamp-3 whitespace-pre-wrap">{t.follow_up_notes || t.summary}</span>
                        <div className="mt-1"><AttachmentLink path={t.attachment_path} name={t.attachment_name} /></div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{userName(t.created_by) || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex gap-1">
                          {!t.follow_up_done && (
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                                    onClick={() => complete.mutate(t.id)} disabled={complete.isPending}>
                              <Check className="mr-1 h-3.5 w-3.5" /> Concluir
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                                  onClick={() => { setEditVisit(t); setDialogOpen(true); }}>
                            Editar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <VisitFormDialog open={dialogOpen} onOpenChange={setDialogOpen} visit={editVisit} />
    </div>
  );
};

export default CrmTasksPage;
