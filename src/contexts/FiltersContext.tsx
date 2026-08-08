import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface Filters {
  property: string[];
  year: number | null;
  month: number[];
  channel: string | null;
}

interface FilterOptions {
  properties: string[];
  years: number[];
  channels: string[];
}

interface FiltersContextType {
  filters: Filters;
  options: FilterOptions;
  setFilter: (key: keyof Filters, value: any) => void;
  toggleMulti: (key: 'property' | 'month', value: string | number) => void;
  refreshOptions: () => Promise<void>;
  currentYear: number;
  previousYear: number;
}

const FiltersContext = createContext<FiltersContextType | undefined>(undefined);

export const FiltersProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { tenantId } = useAuth();
  const [filters, setFilters] = useState<Filters>({ property: [], year: null, month: [], channel: null });
  const [options, setOptions] = useState<FilterOptions>({ properties: [], years: [], channels: [] });

  const refreshOptions = useCallback(async () => {
    if (!tenantId) return;
    const { data } = await (supabase.rpc as any)('get_filter_options', { p_tenant_id: tenantId });

    if (data && data[0]) {
      setOptions({
        properties: data[0].properties || [],
        years: data[0].years || [],
        channels: data[0].channels || [],
      });
    }
  }, [tenantId]);

  useEffect(() => {
    refreshOptions();
  }, [refreshOptions]);

  const setFilter = (key: keyof Filters, value: any) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const toggleMulti = (key: 'property' | 'month', value: string | number) => {
    setFilters(prev => {
      const list = prev[key] as (string | number)[];
      const next = list.includes(value) ? list.filter(v => v !== value) : [...list, value];
      return { ...prev, [key]: next } as Filters;
    });
  };

  const currentYear = filters.year || new Date().getFullYear();
  const previousYear = currentYear - 1;

  return (
    <FiltersContext.Provider value={{ filters, options, setFilter, toggleMulti, refreshOptions, currentYear, previousYear }}>
      {children}
    </FiltersContext.Provider>
  );
};

export const useFilters = () => {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error('useFilters must be used within FiltersProvider');
  return ctx;
};
