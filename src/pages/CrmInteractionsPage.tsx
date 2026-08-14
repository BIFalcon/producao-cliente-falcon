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
import { Download, Search } from 'lucide-react';
import { useCrmUsers, accountMatchesExecutive, accountMatchesHotels } from '@/hooks/useCrmUsers';
import { exportVisitsToExcel } from '@/lib/crm-export';
import {
  VISIT_TYPE_LABELS,
  STAGE_LABELS,
  STAGE_COLORS,
  CrmAccountStage,
  CrmVisitType,
  formatDateBR,
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
  const [search, setSearch] = useState('');

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
        .select('id, visit_type, visit_date, summary, next_follow_up_date, created_by, account_id, crm_accounts(id, account_type, company_name, travel_agent_name, city, stage, properties, responsible_user_id)')
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
      if (!s) return true;
      const name = (acc.company_name || '') + ' ' + (acc.travel_agent_name || '') + ' ' + (v.summary || '');
      return name.toLowerCase().includes(s);
    });
  }, [data, search, filters.property, execFilter, executive]);

  const byType = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((v) => { map[v.visit_type] = (map[v.visit_type] || 0) + 1; });
    return map;
  }, [filtered]);

  const uniqueAccounts = useMemo(
    () => new Set(filtered.map((v) => v.account_id)).size,
    [filtered],
  );

  return (
    <div className="min-h-screen bg-background pl-14">
      <AppHeader />
      <div className="space-y-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Interações Comerciais</h1>
            <p className="text-xs text-muted-foreground">Todas as interações registradas, com filtro por período</p>
          </div>
          <div className="flex items-center gap-2">
            <CrmNav />
            <Button size="sm" variant="outline" onClick={() => exportVisitsToExcel(filtered, userName)}>
              <Download className="mr-1 h-4 w-4" /> Exportar Excel
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
            <Label className="text-xs text-muted-foreground">Tipo</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-9 w-[170px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Tipos</SelectItem>
                {(Object.keys(VISIT_TYPE_LABELS) as CrmVisitType[]).map((t) => (
                  <SelectItem key={t} value={t}>{VISIT_TYPE_LABELS[t]}</SelectItem>
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
                  <th className="px-4 py-3 text-left">Data</th>
                  <th className="px-4 py-3 text-left">Tipo</th>
                  <th className="px-4 py-3 text-left">Conta</th>
                  <th className="px-4 py-3 text-left">Estágio</th>
                  <th className="px-4 py-3 text-left">Resumo</th>
                  <th className="px-4 py-3 text-left">Follow-up</th>
                  <th className="px-4 py-3 text-left">Registrado por</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-muted-foreground">Carregando...</td></tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-muted-foreground">Nenhuma interação no período</td></tr>
                )}
                {filtered.map((v) => {
                  const acc = v.crm_accounts || {};
                  const name = acc.account_type === 'agencia' ? acc.travel_agent_name : acc.company_name;
                  const stage = acc.stage as CrmAccountStage | undefined;
                  return (
                    <tr key={v.id} className="border-t border-border/40 align-top transition hover:bg-secondary/40">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">{formatDateBR(v.visit_date)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs">{VISIT_TYPE_LABELS[v.visit_type as CrmVisitType]}</td>
                      <td className="px-4 py-3">
                        <Link to={`/comercial/contas/${v.account_id}`} className="font-medium text-primary hover:underline">
                          {name || '—'}
                        </Link>
                        {acc.city && <div className="text-xs text-muted-foreground">{acc.city}</div>}
                      </td>
                      <td className="px-4 py-3">
                        {stage && (
                          <span className="inline-flex rounded-full px-2 py-0.5 text-xs"
                                style={{ background: STAGE_COLORS[stage] + '22', color: STAGE_COLORS[stage] }}>
                            {STAGE_LABELS[stage]}
                          </span>
                        )}
                      </td>
                      <td className="max-w-[420px] px-4 py-3 text-xs text-foreground/85">
                        <span className="line-clamp-3 whitespace-pre-wrap">{v.summary}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                        {v.next_follow_up_date ? formatDateBR(v.next_follow_up_date) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{userName(v.created_by) || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CrmInteractionsPage;
