import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

export type SortDir = 'asc' | 'desc';

export type Accessors<T> = Record<string, (row: T) => string | number | null | undefined>;

/** Ordenação clicável genérica para as tabelas do CRM */
export function useTableSort<T>(rows: T[], accessors: Accessors<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey || !accessors[sortKey]) return rows;
    const get = accessors[sortKey];
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      const ea = va === null || va === undefined || va === '';
      const eb = vb === null || vb === undefined || vb === '';
      if (ea && eb) return 0;
      if (ea) return 1;
      if (eb) return -1;
      let cmp: number;
      if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb), 'pt-BR', { sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, toggleSort };
}

interface SortableThProps {
  label: string;
  sortKey?: string;
  activeKey?: string | null;
  dir?: SortDir;
  onSort?: (key: string) => void;
  className?: string;
}

export const SortableTh: React.FC<SortableThProps> = ({ label, sortKey, activeKey, dir, onSort, className }) => {
  if (!sortKey || !onSort) {
    return <th className={`px-4 py-3 text-left ${className || ''}`}>{label}</th>;
  }
  const active = activeKey === sortKey;
  return (
    <th className={`px-4 py-3 text-left ${className || ''}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-foreground ${active ? 'text-foreground' : ''}`}
      >
        {label}
        {active ? (
          dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  );
};
