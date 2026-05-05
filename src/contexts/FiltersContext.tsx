import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface Filters {
  property: string | null;
  year: number | null;
  month: number | null;
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
  refreshOptions: () => Promise<void>;
  currentYear: number;
  previousYear: number;
}

const FiltersContext = createContext<FiltersContextType | undefined>(undefined);

export const FiltersProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { tenantId } = useAuth();
  const [filters, setFilters] = useState<Filters>({ property: null, year: null, month: null, channel: null });
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

  const currentYear = filters.year || new Date().getFullYear();
  const previousYear = currentYear - 1;

  return (
    <FiltersContext.Provider value={{ filters, options, setFilter, refreshOptions, currentYear, previousYear }}>
      {children}
    </FiltersContext.Provider>
  );
};

export const useFilters = () => {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error('useFilters must be used within FiltersProvider');
  return ctx;
};
