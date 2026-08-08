import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useFilters } from '@/contexts/FiltersContext';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import MultiSelectFilter from '@/components/MultiSelectFilter';
import AppSidebar from '@/components/AppSidebar';
import { Building2 } from 'lucide-react';
import { MONTH_NAMES_FULL } from '@/lib/formatters';

const AppHeader = () => {
  const { isSuperAdmin, tenantId, setActiveTenantId } = useAuth();
  const { filters, options, setFilter, toggleMulti } = useFilters();

  const { data: tenants } = useQuery({
    queryKey: ['all-tenants-header'],
    queryFn: async () => {
      const { data } = await (supabase.rpc as any)('get_all_tenants');
      return (data || []) as { id: string; name: string; is_active: boolean }[];
    },
    enabled: isSuperAdmin,
  });

  return (
    <>
      <AppSidebar />
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex min-h-14 flex-wrap items-center gap-2 px-4 py-2 lg:px-6">
          <span className="mr-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Filtros
          </span>

          {isSuperAdmin && (
            <Select value={tenantId || ''} onValueChange={(v) => setActiveTenantId(v || null)}>
              <SelectTrigger className="h-9 w-[220px] border-primary/30 bg-primary/10 text-xs">
                <Building2 className="mr-1 h-3.5 w-3.5 text-primary" />
                <SelectValue placeholder="Selecionar Tenant" />
              </SelectTrigger>
              <SelectContent>
                {(tenants || []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <MultiSelectFilter
            label="Hotéis"
            allLabel="Todos os Hotéis"
            className="w-[220px]"
            options={options.properties.map((p) => ({ value: p, label: p }))}
            selected={filters.property}
            onToggle={(v) => toggleMulti('property', v)}
            onClear={() => setFilter('property', [])}
          />

          <Select
            value={filters.year?.toString() || 'all'}
            onValueChange={(v) => setFilter('year', v === 'all' ? null : parseInt(v))}
          >
            <SelectTrigger className="h-9 w-[130px] bg-secondary text-xs">
              <SelectValue placeholder="Ano" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Anos</SelectItem>
              {options.years.map((y) => (
                <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <MultiSelectFilter
            label="Meses"
            allLabel="Todos os Meses"
            className="w-[190px]"
            options={MONTH_NAMES_FULL.map((m, i) => ({ value: i + 1, label: m }))}
            selected={filters.month}
            onToggle={(v) => toggleMulti('month', v)}
            onClear={() => setFilter('month', [])}
          />

          <Select
            value={filters.channel || 'all'}
            onValueChange={(v) => setFilter('channel', v === 'all' ? null : v)}
          >
            <SelectTrigger className="h-9 w-[190px] bg-secondary text-xs">
              <SelectValue placeholder="Canal" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Canais</SelectItem>
              {options.channels.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>
    </>
  );
};

export default AppHeader;
