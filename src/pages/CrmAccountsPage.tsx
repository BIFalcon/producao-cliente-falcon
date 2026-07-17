import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import AppHeader from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search } from 'lucide-react';
import AccountFormDialog from '@/components/crm/AccountFormDialog';
import { STAGE_COLORS, STAGE_LABELS, STAGE_ORDER, ACCOUNT_TYPE_LABELS, CrmAccountStage, formatDateBR } from '@/lib/crm';

const CrmAccountsPage = () => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['crm-accounts-list', tenantId, stageFilter],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = (supabase.from('crm_accounts') as any)
        .select('id, account_type, company_name, travel_agent_name, city, segment, stage, updated_at, crm_visits(visit_date)')
        .eq('tenant_id', tenantId!)
        .order('updated_at', { ascending: false });
      if (stageFilter !== 'all') q = q.eq('stage', stageFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data as any[];
    },
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const s = search.trim().toLowerCase();
    if (!s) return data;
    return data.filter((a) => {
      const name = (a.company_name || '') + ' ' + (a.travel_agent_name || '') + ' ' + (a.city || '');
      return name.toLowerCase().includes(s);
    });
  }, [data, search]);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="space-y-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Contas Comerciais</h1>
            <p className="text-xs text-muted-foreground">Empresas e agências em relacionamento comercial</p>
          </div>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Nova Conta
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome, cidade..." className="pl-8 h-9" />
          </div>
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Estágios</SelectItem>
              {STAGE_ORDER.map((s) => (
                <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
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
                  <th className="px-4 py-3 text-left">Estágio</th>
                  <th className="px-4 py-3 text-left">Última Interação</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-xs">Carregando...</td></tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-xs">Nenhuma conta encontrada</td></tr>
                )}
                {filtered.map((a: any) => {
                  const name = a.account_type === 'agencia' ? a.travel_agent_name : a.company_name;
                  const lastVisit = (a.crm_visits || [])
                    .map((v: any) => v.visit_date)
                    .sort()
                    .pop();
                  return (
                    <tr key={a.id}
                        onClick={() => navigate(`/comercial/contas/${a.id}`)}
                        className="cursor-pointer border-t border-border/40 hover:bg-secondary/40 transition">
                      <td className="px-4 py-3 font-medium text-foreground">{name || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{ACCOUNT_TYPE_LABELS[a.account_type as 'empresa' | 'agencia']}</td>
                      <td className="px-4 py-3 text-muted-foreground">{a.city || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{a.segment || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs"
                              style={{ background: STAGE_COLORS[a.stage as CrmAccountStage] + '22', color: STAGE_COLORS[a.stage as CrmAccountStage] }}>
                          {STAGE_LABELS[a.stage as CrmAccountStage]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs font-mono">{lastVisit ? formatDateBR(lastVisit) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <AccountFormDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
};

export default CrmAccountsPage;
