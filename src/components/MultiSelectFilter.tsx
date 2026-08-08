import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { ChevronDown, Check } from 'lucide-react';

interface MultiSelectFilterProps<T extends string | number> {
  label: string;
  allLabel: string;
  options: { value: T; label: string }[];
  selected: T[];
  onToggle: (value: T) => void;
  onClear: () => void;
  className?: string;
}

function MultiSelectFilter<T extends string | number>({
  label,
  allLabel,
  options,
  selected,
  onToggle,
  onClear,
  className,
}: MultiSelectFilterProps<T>) {
  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label ?? `1 ${label}`
        : `${selected.length} selecionados`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex h-9 items-center justify-between gap-2 rounded-md border border-border bg-secondary px-3 text-xs text-secondary-foreground transition-colors hover:bg-secondary/70 ${className ?? ''}`}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onClear}>
            Limpar
          </Button>
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {options.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Nenhuma opção</p>
          )}
          {options.map((o) => {
            const checked = selected.includes(o.value);
            return (
              <button
                key={String(o.value)}
                type="button"
                onClick={() => onToggle(o.value)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-secondary/60"
              >
                <Checkbox checked={checked} className="pointer-events-none" />
                <span className="flex-1 truncate text-foreground">{o.label}</span>
                {checked && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default MultiSelectFilter;
