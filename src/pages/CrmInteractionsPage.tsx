import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { Download, Plus, Search } from 'lucide-react';
import VisitFormDialog from '@/components/crm/VisitFormDialog';
import { AttachmentLink } from '@/components/crm/CrmAttachmentField';
import { useCrmUsers, accountMatchesExecutive, accountMatchesHotels } from '@/hooks/useCrmUsers';
import { useTableSort, SortableTh } from '@/hooks/useTableSort';
import { exportVisitsToExcel } from '@/lib/crm-export';
import {
  VISIT_TYPE_LABELS,
  STAGE_LABELS,
  STAGE_COLORS,
  SUB_SEGMENT_LABELS,
  CrmAccountStage,
  CrmAccountSubSegment,
  CrmVisitType,
  accountLabel,
  formatDateBR,
  formatTimeBR,
  todayLocalISO,
} from '@/lib/crm';

const iso = (d: Date) => d.toISOString().slice(0, 10);

const presetRange = (preset: string): { from: string; to: string } | null => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case 'mes_atual':
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case 'mes_anterior':
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case 'ultimos_7':
      return { from: iso(new Date(Date.now() - 6 * 864e5)), to: iso(now) };
    case 'ultimos_30':
      return { from: iso(new Date(Date.now() - 29 * 864e5)), to: iso(now) };
    case 'ano_atual':
      return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
    default:
      return null;
  }
};

const CrmInteractionsPage = () => {
  const { tenantId } = useAuth();
  const { filters } = useFilters();
  const { data: users } = useCrmUsers();

  const [preset, setPreset] = useState('todos');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [execFilter, setExecFilter] = useState('all');
  const [subFilter, setSubFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editVisit, setEditVisit] = useState<any | null>(null);

  const applyPreset = (value: string) => {
    setPreset(value);
    const range = presetRange(value);
    if (range) {
      setFrom(range.from);
      setTo(range.to);
    } else if (value === 'todos') {
      setFrom('');
      setTo('');
    }
  };

  const { data, isLoading } = useQuery({
    queryKey: ['crm-visits-all', tenantId, from, to, typeFilter],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = (supabase.from('crm_visits') as any)
        .select('id, visit_type, visit_date, summary, next_follow_up_date, follow_up_time, follow_up_type, follow_up_notes, follow_up_done, attachment_path, attachment_name, created_by, account_id, crm_accounts(id, account_type, company_name, travel_agent_name, city, stage, sub_segment, properties, responsible_user_id)')
        .eq('tenant_id', tenantId!)
        .order('visit_date', { ascending: false })
        .limit(2000);
      if (from) q = q.gte('visit_date', from);
      if (to) q = q.lte('visit_date', to);
      if (typeFilter !== 'all') q = q.eq('visit_type', typeFilter);
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
    return data.filter((v) => {
      const acc = v.crm_accounts || {};
      if (!accountMatchesHotels(acc, filters.property)) return false;
      if (execFilter !== 'all' && !(v.created_by === execFilter || accountMatchesExecutive(acc, executive))) return false;
      if (subFilter !== 'all' && acc.sub_segment !== subFilter) return false;
      if (!s) return true;
      const name = (acc.company_name || '') + ' ' + (acc.travel_agent_name || '') + ' ' + (v.summary || '');
      return name.toLowerCase().includes(s);
    });
  }, [data, search, filters.property, execFilter, executive, subFilter]);

  const { sorted, sortKey, sortDir, toggleSort } = useTableSort(filtered, {
    date: (v: any) => v.visit_date,
    type: (v: any) => VISIT_TYPE_LABELS[v.visit_type as CrmVisitType],
    account: (v: any) => accountLabel(v.crm_accounts),
    sub: (v: any) => v.crm_accounts?.sub_segment,
    hotels: (v: any) => (v.crm_accounts?.properties || []).join(', '),
    stage: (v: any) => v.crm_accounts?.stage,
    followUp: (v: any) => v.next_follow_up_date,
    exec: (v: any) => userName(v.created_by),
  });

  const byType = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((v) => { map[v.visit_type] = (map[v.visit_type] || 0) + 1; });
    return map;
  }, [filtered]);

  const uniqueAccounts = useMemo(
    () => new Set(filtered.map((v) => v.account_id)).size,
    [filtered],
  );

  const today = todayLocalISO();
  const th = { activeKey: sortKey, dir: sortDir, onSort: toggleSort };

  return (
    <div className="min-h-screen bg-background pl-14">
      <AppHeader />
      <div className="space-y-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Interações Comerciais</h1>
            <p className="text-xs text-muted-foreground">Todas as interações registradas, com filtro por período</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CrmNav />
            <Button size="sm" variant="outline" onClick={() => exportVisitsToExcel(sorted, userName)}>
              <Download className="mr-1 h-4 w-4" /> Exportar Excel
            </Button>
            <Button size="sm" onClick={() => { setEditVisit(null); setDialogOpen(true); }}>
              <Plus className="mr-1 h-4 w-4" /> Nova Atividade
            </Button>
          </div>
        </div>

        <div className="surface-card flex flex-wrap items-end gap-3 p-4">
          <div>
            <Label className="text-xs text-muted-foreground">Período</Label>
            <Select value={preset} onValueChange={applyPreset}>
              <SelectTrigger className="h-9 w-[180px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todo o período</SelectItem>
                <SelectItem value="ultimos_7">Últimos 7 dias</SelectItem>
                <SelectItem value="ultimos_30">Últimos 30 dias</SelectItem>
                <SelectItem value="mes_atual">Mês atual</SelectItem>
                <SelectItem value="mes_anterior">Mês anterior</SelectItem>
                <SelectItem value="ano_atual">Ano atual</SelectItem>
                <SelectItem value="personalizado">Personalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">De</Label>
            <Input type="date" className="h-9 w-[150px] text-xs" value={from}
                   onChange={(e) => { setFrom(e.target.value); setPreset('personalizado'); }} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Até</Label>
            <Input type="date" className="h-9 w-[150px] text-xs" value={to}
                   onChange={(e) => { setTo(e.target.value); setPreset('personalizado'); }} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Tipo de Atividade</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-9 w-[190px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Tipos</SelectItem>
                {(Object.keys(VISIT_TYPE_LABELS) as CrmVisitType[]).map((t) => (
                  <SelectItem key={t} value={t}>{VISIT_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Subsegmentação</Label>
            <Select value={subFilter} onValueChange={setSubFilter}>
              <SelectTrigger className="h-9 w-[170px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {(Object.keys(SUB_SEGMENT_LABELS) as CrmAccountSubSegment[]).map((s) => (
                  <SelectItem key={s} value={s}>{SUB_SEGMENT_LABELS[s]}</SelectItem>
                ))}
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
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
                   placeholder="Buscar por conta ou resumo..." className="h-9 pl-8 text-xs" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="surface-card px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Total de Interações</div>
            <div className="text-2xl font-bold font-mono">{filtered.length}</div>
          </div>
          <div className="surface-card px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Contas Tocadas</div>
            <div className="text-2xl font-bold font-mono">{uniqueAccounts}</div>
          </div>
          <div className="surface-card px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Visitas Presenciais</div>
            <div className="text-2xl font-bold font-mono">{byType['visita_presencial'] || 0}</div>
          </div>
          <div className="surface-card px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Ligações / WhatsApp</div>
            <div className="text-2xl font-bold font-mono">
              {(byType['ligacao'] || 0) + (byType['whatsapp'] || 0)}
            </div>
          </div>
        </div>

        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <SortableTh label="Data" sortKey="date" {...th} />
                  <SortableTh label="Tipo de Atividade" sortKey="type" {...th} />
                  <SortableTh label="Conta" sortKey="account" {...th} />
                  <SortableTh label="Subsegmentação" sortKey="sub" {...th} />
                  <SortableTh label="Hotéis" sortKey="hotels" {...th} />
                  <SortableTh label="Estágio" sortKey="stage" {...th} />
                  <th className="px-4 py-3 text-left">Resumo</th>
                  <SortableTh label="Próximo Follow-up" sortKey="followUp" {...th} />
                  <SortableTh label="Registrado por" sortKey="exec" {...th} />
                  <th className="px-4 py-3 text-left">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-xs text-muted-foreground">Carregando...</td></tr>
                )}
                {!isLoading && sorted.length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-xs text-muted-foreground">Nenhuma interação no período</td></tr>
                )}
                {sorted.map((v: any) => {
                  const acc = v.crm_accounts || {};
                  const stage = acc.stage as CrmAccountStage | undefined;
                  const late = v.next_follow_up_date && !v.follow_up_done && v.next_follow_up_date < today;
                  return (
                    <tr key={v.id} className="border-t border-border/40 align-top transition hover:bg-secondary/40">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">{formatDateBR(v.visit_date)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs">{VISIT_TYPE_LABELS[v.visit_type as CrmVisitType]}</td>
                      <td className="px-4 py-3">
                        <Link to={`/comercial/contas/${v.account_id}`} className="font-medium text-primary hover:underline">
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
                      <td className="px-4 py-3">
                        {stage && (
                          <span className="inline-flex rounded-full px-2 py-0.5 text-xs"
                                style={{ background: STAGE_COLORS[stage] + '22', color: STAGE_COLORS[stage] }}>
                            {STAGE_LABELS[stage]}
                          </span>
                        )}
                      </td>
                      <td className="max-w-[360px] px-4 py-3 text-xs text-foreground/85">
                        <span className="line-clamp-3 whitespace-pre-wrap">{v.summary}</span>
                        <div className="mt-1"><AttachmentLink path={v.attachment_path} name={v.attachment_name} /></div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                        {v.next_follow_up_date ? (
                          <span className={late ? 'text-destructive' : 'text-muted-foreground'}>
                            {formatDateBR(v.next_follow_up_date)} {formatTimeBR(v.follow_up_time)}
                            {v.follow_up_done && <span className="ml-1 text-accent">✓</span>}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{userName(v.created_by) || '—'}</td>
                      <td className="px-4 py-3">
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                                onClick={() => { setEditVisit(v); setDialogOpen(true); }}>
                          Editar
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

      <VisitFormDialog open={dialogOpen} onOpenChange={setDialogOpen} visit={editVisit} />
    </div>
  );
};

export default CrmInteractionsPage;
