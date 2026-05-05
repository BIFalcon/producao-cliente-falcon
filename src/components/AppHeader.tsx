import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useFilters } from '@/contexts/FiltersContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LogOut, Database, Users, Building2, User } from 'lucide-react';
import falconLogo from '@/assets/falcon-logo.png';
import { MONTH_NAMES_FULL } from '@/lib/formatters';

const AppHeader = () => {
  const { signOut, role, isSuperAdmin, tenantId, setActiveTenantId } = useAuth();
  const { filters, options, setFilter } = useFilters();

  const { data: tenants } = useQuery({
    queryKey: ['all-tenants-header'],
    queryFn: async () => {
      const { data } = await (supabase.rpc as any)('get_all_tenants');
      return (data || []) as { id: string; name: string; is_active: boolean }[];
    },
    enabled: isSuperAdmin,
  });

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
      <div className="flex h-14 items-center justify-between px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <img src={falconLogo} alt="Falcon" className="h-8 w-auto" />
        </div>

        <div className="flex items-center gap-2">
          {isSuperAdmin && (
            <Select
              value={tenantId || ''}
              onValueChange={(v) => setActiveTenantId(v || null)}
            >
              <SelectTrigger className="h-8 w-[180px] bg-primary/10 border-primary/30 text-xs">
                <Building2 className="h-3 w-3 mr-1 text-primary" />
                <SelectValue placeholder="Selecionar Tenant" />
              </SelectTrigger>
              <SelectContent>
                {(tenants || []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select
            value={filters.property || 'all'}
            onValueChange={(v) => setFilter('property', v === 'all' ? null : v)}
          >
            <SelectTrigger className="h-8 w-[160px] bg-secondary text-xs">
              <SelectValue placeholder="Hotel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Hotéis</SelectItem>
              {options.properties.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.year?.toString() || 'all'}
            onValueChange={(v) => setFilter('year', v === 'all' ? null : parseInt(v))}
          >
            <SelectTrigger className="h-8 w-[100px] bg-secondary text-xs">
              <SelectValue placeholder="Ano" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {options.years.map((y) => (
                <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.month?.toString() || 'all'}
            onValueChange={(v) => setFilter('month', v === 'all' ? null : parseInt(v))}
          >
            <SelectTrigger className="h-8 w-[120px] bg-secondary text-xs">
              <SelectValue placeholder="Mês" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Meses</SelectItem>
              {MONTH_NAMES_FULL.map((m, i) => (
                <SelectItem key={i + 1} value={(i + 1).toString()}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.channel || 'all'}
            onValueChange={(v) => setFilter('channel', v === 'all' ? null : v)}
          >
            <SelectTrigger className="h-8 w-[140px] bg-secondary text-xs">
              <SelectValue placeholder="Canal" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Canais</SelectItem>
              {options.channels.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {(isSuperAdmin || role === 'master_admin' || role === 'editor') && (
            <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
              <Link to="/upload"><Database className="mr-1 h-3 w-3" />Central de Dados</Link>
            </Button>
          )}

          {(isSuperAdmin || role === 'master_admin') && (
            <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
              <Link to="/users"><Users className="mr-1 h-3 w-3" />Usuários</Link>
            </Button>
          )}

          {isSuperAdmin && (
            <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
              <Link to="/tenants"><Building2 className="mr-1 h-3 w-3" />Tenants</Link>
            </Button>
          )}

          <Button variant="ghost" size="sm" asChild className="h-8 w-8 p-0 text-muted-foreground" title="Meu perfil">
            <Link to="/profile"><User className="h-4 w-4" /></Link>
          </Button>

          <Button variant="ghost" size="sm" onClick={signOut} className="h-8 text-xs text-muted-foreground">
            <LogOut className="mr-1 h-3 w-3" />Sair
          </Button>
        </div>
      </div>
    </header>
  );
};

export default AppHeader;
