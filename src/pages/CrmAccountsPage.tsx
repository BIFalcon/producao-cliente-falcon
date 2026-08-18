import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useFilters } from '@/contexts/FiltersContext';
import AppHeader from '@/components/AppHeader';
import CrmNav from '@/components/crm/CrmNav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Plus, Search, Upload } from 'lucide-react';
import AccountFormDialog from '@/components/crm/AccountFormDialog';
import AccountImportDialog from '@/components/crm/AccountImportDialog';
import { useCrmUsers, accountMatchesExecutive, accountMatchesHotels } from '@/hooks/useCrmUsers';
import { useCrmProduction } from '@/hooks/useCrmProduction';
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
  CrmAccountStage,
  CrmAccountStatus,
  formatDateBR,
} from '@/lib/crm';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const CrmAccountsPage = () => {
  const { tenantId } = useAuth();
  const { filters } = useFilters();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: users } = useCrmUsers();
  const { data: productionMap } = useCrmProduction();

  const [stageFilter, setStageFilter] = useState<string>(searchParams.get('stage') || 'all');
  const [statusFilter, setStatusFilter] = useState<string>(searchParams.get('status') || 'all');
  const [execFilter, setExecFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    setStageFilter(searchParams.get('stage') || 'all');
    setStatusFilter(searchParams.get('status') || 'all');
  }, [searchParams]);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === 'all') next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const { data, isLoading } = useQuery({
    queryKey: ['crm-accounts-list', tenantId, stageFilter, statusFilter],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = (supabase.from('crm_accounts') as any)
        .select('id, account_type, company_name, travel_agent_name, city, segment, stage, account_status, properties, notes, contact_name, contact_email, contact_phone, responsible_user_id, updated_at, crm_visits(visit_date)')
        .eq('tenant_id', tenantId!)
        .order('updated_at', { ascending: false });
      if (stageFilter !== 'all') q = q.eq('stage', stageFilter);
      if (statusFilter !== 'all') q = q.eq('account_status', statusFilter);
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
            <Button size="sm" variant="outline" onClick={() => exportAccountsToExcel(filtered, userName)}>
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
            <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Status</SelectItem>
              <SelectItem value="ativo">Ativo</SelectItem>
              <SelectItem value="inativo">Inativo</SelectItem>
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
                  <th className="px-4 py-3 text-left">Nome</th>
                  <th className="px-4 py-3 text-left">Tipo</th>
                  <th className="px-4 py-3 text-left">Cidade</th>
                  <th className="px-4 py-3 text-left">Segmento</th>
                  <th className="px-4 py-3 text-left">Hotéis</th>
                  <th className="px-4 py-3 text-left">Executivo</th>
                  <th className="px-4 py-3 text-left">Estágio do Funil</th>
                  <th className="px-4 py-3 text-left">Status da Conta</th>
                  <th className="px-4 py-3 text-left">Última Interação</th>
                  <th className="px-4 py-3 text-left">Produção pós-fechamento</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-xs text-muted-foreground">Carregando...</td></tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-xs text-muted-foreground">Nenhuma conta encontrada</td></tr>
                )}
                {filtered.map((a: any) => {
                  const name = a.account_type === 'agencia' ? a.travel_agent_name : a.company_name;
                  const stage = a.stage as CrmAccountStage;
                  const status = a.account_status as CrmAccountStatus | null;
                  const lastVisit = (a.crm_visits || [])
                    .map((v: any) => v.visit_date)
                    .sort()
                    .pop();
                  return (
                    <tr key={a.id}
                        onClick={() => navigate(`/comercial/contas/${a.id}`)}
                        className="cursor-pointer border-t border-border/40 transition hover:bg-secondary/40">
                      <td className="px-4 py-3 font-medium text-foreground">{name || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{ACCOUNT_TYPE_LABELS[a.account_type as 'empresa' | 'agencia']}</td>
                      <td className="px-4 py-3 text-muted-foreground">{a.city || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{a.segment || '—'}</td>
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
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{lastVisit ? formatDateBR(lastVisit) : '—'}</td>
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
    </div>
  );
};

export default CrmAccountsPage;
