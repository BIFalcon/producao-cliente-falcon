import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFilters } from '@/contexts/FiltersContext';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LogOut, Database, BarChart3 } from 'lucide-react';

const AppHeader = () => {
  const { signOut, role } = useAuth();
  const { filters, options, setFilter } = useFilters();

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
      <div className="flex h-14 items-center justify-between px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold text-foreground">Performance Hoteleira</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
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

          {(role === 'master_admin' || role === 'editor') && (
            <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
              <a href="/upload"><Database className="mr-1 h-3 w-3" />Central de Dados</a>
            </Button>
          )}

          <Button variant="ghost" size="sm" onClick={signOut} className="h-8 text-xs text-muted-foreground">
            <LogOut className="mr-1 h-3 w-3" />Sair
          </Button>
        </div>
      </div>
    </header>
  );
};

export default AppHeader;
