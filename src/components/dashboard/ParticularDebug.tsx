import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FiltersContext';
import { formatRevenueTable } from '@/lib/formatters';
import { Bug, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';

interface DebugData {
  total_reservations: number;
  total_revenue: number;
  with_company: number;
  with_agent: number;
  with_source: number;
  mixed_classification_count: number;
  pure_particular_count: number;
  sample: {
    confirmation_number: string;
    property_name: string;
    company_name: string | null;
    travel_agent_name: string | null;
    source_name: string | null;
    room_type: string | null;
    total_revenue: number | null;
  }[];
}

const ParticularDebug = () => {
  const { filters } = useFilters();
  const currentYear = filters.year || new Date().getFullYear();
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['particular-debug', filters.property, currentYear, filters.month],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_particular_debug', {
        p_property: filters.property,
        p_year: currentYear,
        p_month: filters.month,
      });
      if (error) throw error;
      return data as unknown as DebugData;
    },
    enabled: open,
  });

  return (
    <Card className="border-dashed border-yellow-500/30 bg-yellow-500/5">
      <CardHeader className="pb-2">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 p-0 h-auto hover:bg-transparent"
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown className="h-4 w-4 text-yellow-500" /> : <ChevronRight className="h-4 w-4 text-yellow-500" />}
          <Bug className="h-4 w-4 text-yellow-500" />
          <CardTitle className="text-sm font-semibold text-yellow-500">
            Diagnóstico de Classificação — Particular
          </CardTitle>
        </Button>
      </CardHeader>

      {open && (
          <CardContent className="space-y-4">
            {isLoading ? (
              <p className="text-xs text-muted-foreground">Carregando diagnóstico...</p>
            ) : !data ? (
              <p className="text-xs text-muted-foreground">Sem dados disponíveis.</p>
            ) : (
              <>
                {/* Summary */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatBox label="Reservas Particular" value={data.total_reservations} />
                  <StatBox label="Receita Total" value={`R$ ${formatRevenueTable(data.total_revenue)}`} />
                  <StatBox label="Puramente Particular" value={data.pure_particular_count} />
                  <StatBox label="Classificação Mista" value={data.mixed_classification_count} alert={data.mixed_classification_count > 0} />
                </div>

                {/* Validation */}
                <div className="rounded-md border border-dashed p-3 space-y-1" style={{ borderColor: 'hsl(var(--border))' }}>
                  <p className="text-xs font-semibold text-foreground mb-2">Validação de Campos Preenchidos</p>
                  <ValidationRow label="Com Nome de Empresa" count={data.with_company} total={data.total_reservations} />
                  <ValidationRow label="Com Agente de Viagem" count={data.with_agent} total={data.total_reservations} />
                  <ValidationRow label="Com Source Name" count={data.with_source} total={data.total_reservations} />
                </div>

                {/* Sample table */}
                <div>
                  <p className="text-xs font-semibold text-foreground mb-2">
                    Amostra de {data.sample?.length || 0} reservas (por receita desc.)
                  </p>
                  <div className="overflow-x-auto rounded border" style={{ borderColor: 'hsl(var(--border))' }}>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Confirmação</TableHead>
                          <TableHead className="text-xs">Empresa</TableHead>
                          <TableHead className="text-xs">Agente</TableHead>
                          <TableHead className="text-xs">Source</TableHead>
                          <TableHead className="text-xs">Room Type</TableHead>
                          <TableHead className="text-xs text-right">Receita</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.sample?.map((row, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-xs font-mono">{row.confirmation_number}</TableCell>
                            <TableCell className="text-xs">{row.company_name || <span className="text-muted-foreground">—</span>}</TableCell>
                            <TableCell className="text-xs">{row.travel_agent_name || <span className="text-muted-foreground">—</span>}</TableCell>
                            <TableCell className="text-xs">{row.source_name || <span className="text-muted-foreground">—</span>}</TableCell>
                            <TableCell className="text-xs">{row.room_type || <span className="text-muted-foreground">—</span>}</TableCell>
                            <TableCell className="text-xs text-right font-mono">{formatRevenueTable(row.total_revenue)}</TableCell>
                          </TableRow>
                        ))}
                        {(!data.sample || data.sample.length === 0) && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-4">
                              Nenhuma reserva Particular encontrada
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </>
            )}
          </CardContent>
      )}
    </Card>
  );
};

const StatBox = ({ label, value, alert }: { label: string; value: number | string; alert?: boolean }) => (
  <div className="rounded-md border p-2" style={{ borderColor: alert ? 'hsl(var(--destructive))' : 'hsl(var(--border))' }}>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className={`text-sm font-bold ${alert ? 'text-destructive' : 'text-foreground'}`}>{value}</p>
  </div>
);

const ValidationRow = ({ label, count, total }: { label: string; count: number; total: number }) => {
  const isClean = count === 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      {isClean ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
      )}
      <span className="text-foreground">{label}:</span>
      <span className={isClean ? 'text-green-500' : 'text-destructive'}>
        {count} de {total}
      </span>
      {!isClean && <span className="text-destructive font-semibold">(inconsistência!)</span>}
    </div>
  );
};

export default ParticularDebug;
